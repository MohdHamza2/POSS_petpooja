import { Router } from "express";
import { prisma } from "../prisma";
import {
  PrismaAvailabilityRepository,
  PrismaMenuCatalogRepository,
  setAvailability,
  listAvailability,
} from "@kapmeta/menu";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/require-auth";

const router = Router();

router.get("/categories", requireAuth, requirePermission("menu.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const catalogRepository = new PrismaMenuCatalogRepository(prisma);
    const categories = await catalogRepository.listCategories(outletId);
    res.status(200).json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/items", requireAuth, requirePermission("menu.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const catalogRepository = new PrismaMenuCatalogRepository(prisma);
    const items = await catalogRepository.listAllItems(outletId);
    res.status(200).json(
      items.map((item) => ({ ...item, priceMinor: String(item.priceMinor) }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/categories", requireAuth, requirePermission("menu.category.manage"), async (req: AuthedRequest, res) => {
  try {
    const { name, description } = req.body;
    const outletId = req.auth!.outletId;

    const catalogRepository = new PrismaMenuCatalogRepository(prisma);
    const category = await catalogRepository.createCategory({ outletId, name, description });

    res.status(201).json(category);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/items", requireAuth, requirePermission("menu.item.manage"), async (req: AuthedRequest, res) => {
  try {
    const { categoryId, name, description, priceMinor, isVeg, taxRate } = req.body;
    const outletId = req.auth!.outletId;

    if (!categoryId || !name) {
      res.status(400).json({ error: "categoryId and name are required" });
      return;
    }

    const catalogRepository = new PrismaMenuCatalogRepository(prisma);
    const item = await catalogRepository.createMenuItem({
      outletId,
      categoryId,
      name: String(name).trim(),
      description: description ? String(description).trim() : undefined,
      priceMinor: BigInt(priceMinor || 0),
      isVeg: typeof isVeg === "boolean" ? isVeg : true,
      taxRate: typeof taxRate === "number" ? taxRate : Number(taxRate || 5),
    });

    res.status(201).json({ ...item, priceMinor: String(item.priceMinor) });
  } catch (err: any) {
    console.error("Error creating menu item:", err);
    res.status(500).json({ error: err.message || "Failed to create menu item" });
  }
});

router.post("/items/bulk-upload", requireAuth, requirePermission("menu.item.manage"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    let itemsInput: Array<{
      category: string;
      name: string;
      price: number | string;
      isVeg?: boolean | string;
      taxRate?: number | string;
      description?: string;
      code?: string;
    }> = [];

    if (Array.isArray(req.body.items)) {
      itemsInput = req.body.items;
    } else if (typeof req.body.csvText === "string") {
      const lines = req.body.csvText.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const header = lines[0].toLowerCase().split(",").map((h: string) => h.trim().replace(/^["']|["']$/g, ""));
        const catIdx = header.findIndex((h: string) => h.includes("cat"));
        const nameIdx = header.findIndex((h: string) => h === "name" || h.includes("item") || h.includes("dish"));
        const priceIdx = header.findIndex((h: string) => h.includes("price") || h.includes("rate") || h.includes("amount"));
        const vegIdx = header.findIndex((h: string) => h.includes("veg") || h.includes("type"));
        const taxIdx = header.findIndex((h: string) => h.includes("tax") || h.includes("gst"));
        const descIdx = header.findIndex((h: string) => h.includes("desc"));
        const codeIdx = header.findIndex((h: string) => h.includes("code") || h.includes("sku"));

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map((c: string) => c.trim().replace(/^["']|["']$/g, ""));
          if (cols.length < 2) continue;
          itemsInput.push({
            category: catIdx !== -1 ? cols[catIdx] : "General",
            name: nameIdx !== -1 ? cols[nameIdx] : cols[0],
            price: priceIdx !== -1 ? cols[priceIdx] : "0",
            isVeg: vegIdx !== -1 ? (cols[vegIdx].toLowerCase() === "true" || cols[vegIdx].toLowerCase() === "veg" || cols[vegIdx].toLowerCase() === "yes" || cols[vegIdx] === "1") : true,
            taxRate: taxIdx !== -1 ? parseFloat(cols[taxIdx]) || 5 : 5,
            description: descIdx !== -1 ? cols[descIdx] : undefined,
            code: codeIdx !== -1 ? cols[codeIdx] : undefined,
          });
        }
      }
    } else {
      res.status(400).json({ error: "Expected 'items' array or 'csvText' string in request body" });
      return;
    }

    if (itemsInput.length === 0) {
      res.status(400).json({ error: "No valid menu items found in payload" });
      return;
    }

    let categoriesCreated = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    const errors: string[] = [];

    const categoryCache = new Map<string, string>();
    const existingCategories = await prisma.menuCategory.findMany({
      where: { outletId },
    });
    existingCategories.forEach((c) => categoryCache.set(c.name.toLowerCase().trim(), c.id));

    for (const raw of itemsInput) {
      const catName = (raw.category || "General").trim();
      const itemName = (raw.name || "").trim();
      if (!itemName) {
        errors.push(`Row skipped: item name is empty`);
        continue;
      }

      const priceNum = parseFloat(String(raw.price).replace(/[^0-9.]/g, ""));
      if (isNaN(priceNum) || priceNum < 0) {
        errors.push(`Item "${itemName}": invalid price "${raw.price}"`);
        continue;
      }

      const isVeg = typeof raw.isVeg === "boolean"
        ? raw.isVeg
        : (String(raw.isVeg).toLowerCase() === "true" || String(raw.isVeg).toLowerCase() === "veg" || String(raw.isVeg).toLowerCase() === "yes");

      const taxRateNum = typeof raw.taxRate === "number" ? raw.taxRate : parseFloat(String(raw.taxRate || "5"));
      const taxRate = isNaN(taxRateNum) ? 5.0 : taxRateNum;

      // 1. Ensure category exists
      let categoryId = categoryCache.get(catName.toLowerCase());
      if (!categoryId) {
        const newCat = await prisma.menuCategory.create({
          data: {
            outletId,
            name: catName,
            sortOrder: existingCategories.length + categoriesCreated,
            isActive: true,
          },
        });
        categoryId = newCat.id;
        categoryCache.set(catName.toLowerCase(), categoryId);
        categoriesCreated += 1;
      }

      // 2. Check if item exists in this category
      const existingItem = await prisma.menuItem.findFirst({
        where: {
          outletId,
          categoryId,
          name: { equals: itemName, mode: "insensitive" },
        },
      });

      if (existingItem) {
        await prisma.menuItem.update({
          where: { id: existingItem.id },
          data: {
            price: priceNum,
            isVeg,
            taxRate,
            description: raw.description !== undefined ? raw.description : existingItem.description,
            code: raw.code || existingItem.code,
            isActive: true,
          },
        });
        itemsUpdated += 1;
      } else {
        await prisma.menuItem.create({
          data: {
            outletId,
            categoryId,
            name: itemName,
            description: raw.description || null,
            price: priceNum,
            taxRate,
            isVeg,
            code: raw.code || null,
            isActive: true,
          },
        });
        itemsCreated += 1;
      }
    }

    res.status(200).json({
      success: true,
      totalProcessed: itemsInput.length,
      categoriesCreated,
      itemsCreated,
      itemsUpdated,
      errors,
    });
  } catch (err: any) {
    console.error("Error in bulk menu upload:", err);
    res.status(500).json({ error: err.message || "Failed to bulk upload menu catalog" });
  }
});

router.post("/modifier-groups", requireAuth, requirePermission("menu.item.manage"), async (req: AuthedRequest, res) => {
  try {
    const { name, minSelect, maxSelect } = req.body;
    const outletId = req.auth!.outletId;

    const catalogRepository = new PrismaMenuCatalogRepository(prisma);
    const group = await catalogRepository.createModifierGroup(outletId, name, minSelect, maxSelect);

    res.status(201).json(group);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/modifier-options", requireAuth, requirePermission("menu.item.manage"), async (req: AuthedRequest, res) => {
  try {
    const { modifierGroupId, name, priceMinor } = req.body;
    const outletId = req.auth!.outletId;

    const catalogRepository = new PrismaMenuCatalogRepository(prisma);
    const option = await catalogRepository.createModifierOption(outletId, modifierGroupId, name, BigInt(priceMinor));

    res.status(201).json({
      id: option.id,
      name: option.name,
      priceMinor: option.price_delta_minor.toString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/items/:menuItemId/modifiers", requireAuth, requirePermission("menu.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const menuItemId = req.params.menuItemId;
    const links = await prisma.item_modifier_groups.findMany({
      where: { outlet_id: outletId, item_id: menuItemId },
      orderBy: { sort_order: "asc" },
    });
    const groupIds = links.map((l) => l.group_id);
    const groups = groupIds.length
      ? await prisma.modifierGroup.findMany({
          where: { id: { in: groupIds }, outletId, is_active: true },
        })
      : [];
    const options = groupIds.length
      ? await prisma.modifiers.findMany({
          where: { group_id: { in: groupIds }, outlet_id: outletId, is_active: true },
          orderBy: { name: "asc" },
        })
      : [];
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const payload = links
      .map((link) => {
        const group = groupById.get(link.group_id);
        if (!group) return null;
        return {
          id: group.id,
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          options: options
            .filter((o) => o.group_id === group.id)
            .map((o) => ({
              id: o.id,
              name: o.name,
              priceMinor: Number(o.price_delta_minor || 0),
            })),
        };
      })
      .filter(Boolean);
    res.status(200).json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/items/:menuItemId/modifiers/:modifierGroupId", requireAuth, requirePermission("menu.item.manage"), async (req: AuthedRequest, res) => {
  try {
    const catalogRepository = new PrismaMenuCatalogRepository(prisma);
    const link = await catalogRepository.linkModifierToItem(
      req.auth!.outletId,
      req.params.menuItemId,
      req.params.modifierGroupId
    );

    res.status(201).json(link);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/categories/:categoryId/items", requireAuth, requirePermission("menu.read"), async (_req: AuthedRequest, res) => {
  try {
    const catalogRepository = new PrismaMenuCatalogRepository(prisma);
    const items = await catalogRepository.listByCategory(_req.params.categoryId);

    res.status(200).json(
      items.map((item) => ({ ...item, priceMinor: String(item.priceMinor) }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/availability", requireAuth, requirePermission("menu.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const menuItems = await prisma.menuItem.findMany({
      where: { outletId },
      include: { category: true },
      orderBy: { name: "asc" },
    });

    const modifierLinks = await prisma.item_modifier_groups.findMany({
      where: { outlet_id: outletId },
      select: { item_id: true },
    });
    const itemsWithModifiers = new Set(modifierLinks.map((l) => l.item_id));

    const availabilityRows = await prisma.item_availability.findMany({
      where: { outlet_id: outletId },
    });
    const availByItem = new Map<string, { state: string; version: number }>();
    for (const row of availabilityRows) {
      const prev = availByItem.get(row.item_id);
      if (!prev || row.version >= prev.version) {
        availByItem.set(row.item_id, { state: row.state, version: row.version });
      }
    }

    res.status(200).json(
      menuItems.map((item) => {
        const avail = availByItem.get(item.id);
        const isStocked = avail ? avail.state !== "OFF" : item.isActive !== false;
        return {
          id: item.id,
          menuItemId: item.id,
          name: item.name,
          description: item.description || "",
          categoryName: item.category?.name || "General",
          category: item.category?.name || "General",
          isStocked,
          version: avail?.version ?? 1,
          priceMinor: Math.round(Number(item.price || 0) * 100).toString(),
          isVeg: item.isVeg,
          taxRate: Number(item.taxRate ?? 0),
          hasModifiers: itemsWithModifiers.has(item.id),
        };
      })
    );
  } catch (err: any) {
    console.error("Error fetching menu availability:", err);
    res.status(500).json({ error: err.message || "Failed to fetch menu availability" });
  }
});

router.patch("/items/:menuItemId/availability", requireAuth, requirePermission("menu.86.toggle"), async (req: AuthedRequest, res) => {
  try {
    const { isStocked, stockQty, expectedVersion } = req.body;
    const outletId = req.auth!.outletId;

    const item = await prisma.menuItem.findUnique({
      where: { id: req.params.menuItemId },
    });

    if (!item) {
      res.status(404).json({ error: "menu item not found" });
      return;
    }

    const nextState = typeof isStocked === "boolean" && isStocked === false ? "OFF" : "ON";
    const accounts = await prisma.channelAccount.findMany({
      where: { outletId },
      select: { id: true },
    });
    const channelIds = accounts.length > 0 ? accounts.map((a) => a.id) : [outletId];
    let newVersion = 1;
    for (const channelId of channelIds) {
      const existing = await prisma.item_availability.findFirst({
        where: { outlet_id: outletId, item_id: item.id, channel_id: channelId },
      });
      if (existing) {
        const updatedAvail = await prisma.item_availability.update({
          where: { id: existing.id },
          data: { state: nextState, version: { increment: 1 }, updated_at: new Date(), updated_by: req.auth!.userId },
        });
        newVersion = updatedAvail.version;
      } else {
        const created = await prisma.item_availability.create({
          data: {
            outlet_id: outletId,
            item_id: item.id,
            channel_id: channelId,
            state: nextState,
            version: (expectedVersion || 1) + 1,
            created_by: req.auth!.userId,
            updated_by: req.auth!.userId,
          },
        });
        newVersion = created.version;
      }
    }

    const updated = await prisma.menuItem.update({
      where: { id: req.params.menuItemId },
      data: { isActive: nextState !== "OFF" },
    });

    await prisma.auditLog.create({
      data: {
        outletId,
        actor_id: req.auth!.userId,
        action: "UPDATE",
        entityType: "MENU_ITEM_86",
        entityId: item.id,
        beforeState: { isStocked: item.isActive },
        afterState: { isStocked: nextState !== "OFF", version: newVersion },
      },
    }).catch(err => console.error('Background task error:', err?.message || err));

    res.status(200).json({ newVersion, isStocked: nextState !== "OFF" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export const menuRouter = router;
