import { Router } from "express";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/require-auth";
import { prisma } from "../prisma";

export const inventoryRouter = Router();

// List ingredients for active outlet
inventoryRouter.get("/ingredients", requireAuth, requirePermission("inventory.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const ingredients = await (prisma as any).ingredients.findMany({
      where: { outlet_id: outletId, is_active: true },
      orderBy: { name: "asc" },
    });

    res.status(200).json(ingredients.map((ing: any) => ({
      id: ing.id,
      name: ing.name,
      unitOfMeasure: ing.unit_of_measure,
      reorderLevel: ing.reorder_level,
      unitCost: Number(ing.unit_cost_minor) / 100,
      currentStock: Number(ing.current_stock_qty),
      createdAt: ing.created_at.toISOString(),
    })));
  } catch (error: any) {
    console.error("Error listing ingredients:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create an ingredient
inventoryRouter.post("/ingredients", requireAuth, requirePermission("inventory.write"), async (req: AuthedRequest, res) => {
  const name = req.body.name;
  const unitOfMeasure = req.body.unitOfMeasure || req.body.unit;
  const reorderLevel = req.body.reorderLevel !== undefined ? req.body.reorderLevel : req.body.minThreshold;
  const unitCost = req.body.unitCost !== undefined ? req.body.unitCost : (req.body.costPerUnitMinor !== undefined ? req.body.costPerUnitMinor / 100 : undefined);
  const currentStock = req.body.currentStock !== undefined ? Number(req.body.currentStock) : (req.body.initialStock !== undefined ? Number(req.body.initialStock) : (req.body.stock !== undefined ? Number(req.body.stock) : 0));

  if (!name || !unitOfMeasure || reorderLevel === undefined || unitCost === undefined) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;

    const ingredient = await (prisma as any).ingredients.create({
      data: {
        outlet_id: outletId,
        name: String(name).trim(),
        unit_of_measure: String(unitOfMeasure).trim(),
        reorder_level: Number(reorderLevel),
        unit_cost_minor: Math.round(Number(unitCost) * 100),
        current_stock_qty: Number(currentStock),
        created_by: userId,
        updated_by: userId,
      },
    });

    await prisma.auditLog.create({
      data: {
        outletId,
        actor_id: userId,
        action: "CREATE",
        entityType: "INVENTORY_INGREDIENT",
        entityId: ingredient.id,
        afterState: { name: ingredient.name, unitOfMeasure: ingredient.unit_of_measure },
        createdAt: new Date(),
      },
    });

    res.status(201).json({
      id: ingredient.id,
      name: ingredient.name,
      unitOfMeasure: ingredient.unit_of_measure,
      reorderLevel: ingredient.reorder_level,
      unitCost: Number(ingredient.unit_cost_minor) / 100,
      currentStock: Number(ingredient.current_stock_qty),
    });
  } catch (error: any) {
    console.error("Error creating ingredient:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update ingredient stock
inventoryRouter.patch("/ingredients/:id", requireAuth, requirePermission("inventory.write"), async (req: AuthedRequest, res) => {
  const ingredientId = req.params.id;
  const qty = Number(req.body.quantity || req.body.qty || 0);

  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;

    const existing = await (prisma as any).ingredients.findFirst({
      where: { id: ingredientId, outlet_id: outletId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Ingredient not found" });
    }

    const newStock = Number(existing.current_stock_qty) + qty;

    await (prisma as any).ingredients.update({
      where: { id: ingredientId },
      data: {
        current_stock_qty: newStock,
        updated_at: new Date(),
        updated_by: userId,
      },
    });

    await prisma.auditLog.create({
      data: {
        outletId,
        actor_id: userId,
        action: "UPDATE",
        entityType: "INVENTORY_INGREDIENT",
        entityId: ingredientId,
        beforeState: { currentStock: Number(existing.current_stock_qty) },
        afterState: { currentStock: newStock },
        createdAt: new Date(),
      },
    });

    res.status(200).json({ success: true, currentStock: newStock });
  } catch (error: any) {
    console.error("Error updating ingredient:", error);
    res.status(500).json({ error: error.message });
  }
});

// Deduct stock
inventoryRouter.post("/stock/deduct", requireAuth, requirePermission("inventory.stock.deduct"), async (req: AuthedRequest, res) => {
  const { ingredientId, quantity } = req.body;

  if (!ingredientId || quantity === undefined) {
    return res.status(400).json({ error: "Missing ingredientId or quantity" });
  }

  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;

    const existing = await (prisma as any).ingredients.findFirst({
      where: { id: ingredientId, outlet_id: outletId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Ingredient not found" });
    }

    const newStock = Number(existing.current_stock_qty) - Number(quantity);

    await (prisma as any).ingredients.update({
      where: { id: ingredientId },
      data: {
        current_stock_qty: newStock,
        updated_at: new Date(),
        updated_by: userId,
      },
    });

    await prisma.auditLog.create({
      data: {
        outletId,
        actor_id: userId,
        action: "UPDATE",
        entityType: "INVENTORY_INGREDIENT",
        entityId: ingredientId,
        beforeState: { currentStock: Number(existing.current_stock_qty) },
        afterState: { currentStock: newStock },
        createdAt: new Date(),
      },
    });

    res.status(200).json({ success: true, currentStock: newStock });
  } catch (error: any) {
    console.error("Error deducting stock:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /wastage
inventoryRouter.post("/wastage", requireAuth, requirePermission("inventory.stock.deduct"), async (req: AuthedRequest, res) => {
  try {
    const { items, reason, notes } = req.body;
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "items must be an array" });
    }

    for (const item of items) {
      const { ingredientId, quantityLost } = item;
      const ingredient = await (prisma as any).ingredients.findUnique({ where: { id: ingredientId } });
      if (ingredient) {
        const newStock = Number(ingredient.current_stock_qty) - Number(quantityLost);
        await (prisma as any).ingredients.update({
          where: { id: ingredientId },
          data: { current_stock_qty: newStock }
        });
        
        await prisma.inventoryWastageLog.create({
          data: {
            outletId,
            ingredientId,
            quantity: Number(quantityLost),
            reason: reason || "Unknown",
            loggedBy: userId
          }
        });
      }
    }
    res.status(201).json({ success: true });
  } catch (err: any) {
    console.error("Error in wastage:", err);
    res.status(500).json({ error: err.message });
  }
});

// List recipes
inventoryRouter.get("/recipes", requireAuth, requirePermission("inventory.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const recipes = await (prisma as any).recipes.findMany({
      where: { outlet_id: outletId, is_active: true },
      include: {
        recipe_ingredients: {
          include: {
            ingredients: true,
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    // Lookup menu items for names
    const menuItemIds = recipes.map((r: any) => r.menu_item_id).filter(Boolean);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds } },
    });
    const menuItemMap = new Map(menuItems.map((m) => [m.id, m]));

    res.status(200).json(recipes.map((rec: any) => {
      const mi = menuItemMap.get(rec.menu_item_id);
      const mappedIngredients = (rec.recipe_ingredients || []).map((ri: any) => ({
        id: ri.id,
        ingredientId: ri.ingredient_id,
        ingredientName: ri.ingredients?.name || "Ingredient",
        quantity: Number(ri.quantity),
        yieldPercent: 100,
        unit: ri.ingredients?.unit_of_measure || "g",
        ingredient: {
          id: ri.ingredient_id,
          name: ri.ingredients?.name || "Ingredient",
          unitOfMeasure: ri.ingredients?.unit_of_measure || "g",
          reorderLevel: Number(ri.ingredients?.reorder_level || 0),
          unitCost: Number(ri.ingredients?.unit_cost_minor || 0) / 100,
          currentStock: Number(ri.ingredients?.current_stock_qty || 0),
        },
      }));

      return {
        id: rec.id,
        name: rec.name || (mi?.name ? `${mi.name} Recipe` : "Dish Recipe"),
        menuItemId: rec.menu_item_id,
        version: rec.version ?? 1,
        isActive: rec.is_active ?? true,
        yieldPortions: Number(rec.yield_portions || 1),
        menuItem: mi ? {
          id: mi.id,
          name: mi.name,
          priceMinor: Math.round(Number(mi.price || 0) * 100).toString(),
          isVeg: mi.isVeg,
        } : { id: rec.menu_item_id, name: rec.name || "Dish", priceMinor: "0", isVeg: true },
        recipeIngredients: mappedIngredients,
        ingredients: mappedIngredients,
      };
    }));
  } catch (error: any) {
    console.error("Error listing recipes:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create a recipe / BOM
inventoryRouter.post("/recipes", requireAuth, requirePermission("inventory.write"), async (req: AuthedRequest, res) => {
  let { name, menuItemId, ingredients, yieldPortions } = req.body;

  if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: "Please provide at least one ingredient for the recipe BOM" });
  }

  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;

    if (!name && menuItemId) {
      const menuItem = await prisma.menuItem.findFirst({
        where: { id: menuItemId, outletId },
      });
      name = menuItem?.name || "Recipe BOM";
    } else if (!name) {
      name = "Recipe BOM";
    }

    let nextVersion = 1;
    if (menuItemId) {
      const latest = await (prisma as any).recipes.findFirst({
        where: { outlet_id: outletId, menu_item_id: menuItemId },
        orderBy: [{ version: "desc" }, { created_at: "desc" }],
      });
      nextVersion = Number(latest?.version || 0) + 1;
      await (prisma as any).recipes.updateMany({
        where: { outlet_id: outletId, menu_item_id: menuItemId, is_active: true },
        data: { is_active: false, updated_at: new Date(), updated_by: userId },
      });
    }

    const recipe = await (prisma as any).recipes.create({
      data: {
        outlet_id: outletId,
        name: String(name).trim(),
        menu_item_id: menuItemId || null,
        yield_portions: Number(yieldPortions || 1),
        version: nextVersion,
        created_by: userId,
        updated_by: userId,
      },
    });

    for (const ing of ingredients) {
      await (prisma as any).recipe_ingredients.create({
        data: {
          recipe_id: recipe.id,
          ingredient_id: ing.ingredientId || ing.id,
          quantity: Number(ing.quantity || 1),
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        outletId,
        actor_id: userId,
        action: "CREATE",
        entityType: "INVENTORY_RECIPE",
        entityId: recipe.id,
        afterState: { name, menuItemId, ingredients },
        createdAt: new Date(),
      },
    });

    res.status(201).json({ id: recipe.id, name, menuItemId, ingredients });
  } catch (error: any) {
    console.error("Error creating recipe:", error);
    res.status(500).json({ error: error.message });
  }
});

// List vendors
inventoryRouter.get("/vendors", requireAuth, requirePermission("inventory.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const vendors = await (prisma as any).vendors.findMany({
      where: { outlet_id: outletId, is_active: true },
      orderBy: { name: "asc" },
    });

    res.status(200).json(vendors.map((v: any) => ({
      id: v.id,
      name: v.name,
      contactName: v.contact_name,
      contactPhone: v.contact_phone,
      contactEmail: v.contact_email,
      paymentTerms: v.payment_terms,
    })));
  } catch (error: any) {
    console.error("Error listing vendors:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create a vendor
inventoryRouter.post("/vendors", requireAuth, requirePermission("inventory.write"), async (req: AuthedRequest, res) => {
  const { name, contactName, contactPhone, contactEmail, paymentTerms } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Missing vendor name" });
  }

  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;

    const vendor = await (prisma as any).vendors.create({
      data: {
        outlet_id: outletId,
        name: String(name).trim(),
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        contact_email: contactEmail || null,
        payment_terms: paymentTerms || null,
        created_by: userId,
        updated_by: userId,
      },
    });

    await prisma.auditLog.create({
      data: {
        outletId,
        actor_id: userId,
        action: "CREATE",
        entityType: "INVENTORY_VENDOR",
        entityId: vendor.id,
        afterState: { name, contactName, contactPhone, contactEmail, paymentTerms },
        createdAt: new Date(),
      },
    });

    res.status(201).json({
      id: vendor.id,
      name: vendor.name,
      contactName: vendor.contact_name,
      contactPhone: vendor.contact_phone,
      contactEmail: vendor.contact_email,
      paymentTerms: vendor.payment_terms
    });
  } catch (error: any) {
    console.error("Error creating vendor:", error);
    res.status(500).json({ error: error.message });
  }
});

// List purchase orders
inventoryRouter.get("/purchase-orders", requireAuth, requirePermission("inventory.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const orders = await (prisma as any).purchase_orders.findMany({
      where: { outlet_id: outletId },
      include: {
        vendors: true,
        purchase_order_items: {
          include: {
            ingredients: true,
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    res.status(200).json(orders.map((po: any) => ({
      id: po.id,
      poNumber: po.po_number,
      vendorId: po.vendor_id,
      vendorName: po.vendors.name,
      items: po.purchase_order_items.map((poi: any) => ({
        ingredientId: poi.ingredient_id,
        ingredientName: poi.ingredients.name,
        quantity: Number(poi.quantity),
        receivedQty: Number(poi.received_qty || 0),
        unitPrice: Number(poi.unit_price_minor) / 100,
        total: Number(poi.total_minor) / 100,
      })),
      totalAmount: Number(po.total_amount_minor) / 100,
      status: po.status,
      createdAt: po.created_at.toISOString(),
    })));
  } catch (error: any) {
    console.error("Error listing purchase orders:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create a purchase order
inventoryRouter.post("/purchase-orders", requireAuth, requirePermission("inventory.write"), async (req: AuthedRequest, res) => {
  const { vendorId, items } = req.body;

  if (!vendorId || !items || !Array.isArray(items)) {
    return res.status(400).json({ error: "Missing vendorId or items" });
  }

  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;

    // Generate PO number
    const count = await (prisma as any).purchase_orders.count({
      where: { outlet_id: outletId },
    });
    const poNumber = `PO-${String(count + 1).padStart(6, "0")}`;

    const total = items.reduce((sum: number, it: any) => sum + Number(it.unitPrice || 0) * Number(it.quantity || 0), 0);

    const po = await (prisma as any).purchase_orders.create({
      data: {
        outlet_id: outletId,
        vendor_id: vendorId,
        po_number: poNumber,
        total_amount_minor: Math.round(total * 100),
        status: "DRAFT",
        created_by: userId,
        updated_by: userId,
      },
    });

    for (const item of items) {
      const unitPriceMinor = Math.round(Number(item.unitPrice) * 100);
      const qty = Number(item.quantity);
      await (prisma as any).purchase_order_items.create({
        data: {
          po_id: po.id,
          ingredient_id: item.ingredientId,
          quantity: qty,
          unit_price_minor: unitPriceMinor,
          total_minor: unitPriceMinor * qty,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        outletId,
        actor_id: userId,
        action: "CREATE",
        entityType: "INVENTORY_PURCHASE_ORDER",
        entityId: po.id,
        afterState: { vendorId, items, totalAmount: total, status: "DRAFT" },
        createdAt: new Date(),
      },
    });

    res.status(201).json({ id: po.id, poNumber, vendorId, items, totalAmount: total, status: "DRAFT" });
  } catch (error: any) {
    console.error("Error creating purchase order:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /inventory/purchase-orders/:id/receive - Receive goods (GRN) and increment ingredient stock in DB
inventoryRouter.post("/purchase-orders/:id/receive", requireAuth, requirePermission("inventory.write"), async (req: AuthedRequest, res) => {
  const poId = req.params.id;

  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;

    const po = await (prisma as any).purchase_orders.findFirst({
      where: { id: poId, outlet_id: outletId },
      include: {
        purchase_order_items: {
          include: { ingredients: true },
        },
        vendors: true,
      },
    });

    if (!po) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    if (po.purchase_order_items.every((item: any) => Number(item.received_qty || 0) >= Number(item.quantity || 0))) {
      return res.status(400).json({ error: "Purchase order has already been received" });
    }

    const requested = Array.isArray(req.body.items) ? req.body.items as { ingredientId: string; quantity: number }[] : null;
    const receivedItems = [];
    let allComplete = true;

    for (const item of po.purchase_order_items) {
      const already = Number(item.received_qty || 0);
      const ordered = Number(item.quantity || 0);
      const remaining = Math.max(0, ordered - already);
      const requestedRow = requested?.find((r) => r.ingredientId === item.ingredient_id);
      const addQty = requested ? Number(requestedRow?.quantity || 0) : remaining;
      if (addQty <= 0) {
        if (already < ordered) allComplete = false;
        continue;
      }
      const applied = Math.min(addQty, remaining);
      if (applied < remaining || already + applied < ordered) allComplete = false;

      const ingredient = await prisma.ingredients.findUnique({
        where: { id: item.ingredient_id },
      });
      if (!ingredient) continue;

      const previousStock = Number(ingredient.current_stock_qty || 0);
      const newStock = previousStock + applied;
      await prisma.ingredients.update({
        where: { id: ingredient.id },
        data: {
          current_stock_qty: newStock,
          updated_at: new Date(),
          updated_by: userId,
        },
      });
      await prisma.purchase_order_items.update({
        where: { id: item.id },
        data: { received_qty: already + applied },
      });
      receivedItems.push({
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        addedQty: applied,
        previousStock,
        newStock,
        unit: ingredient.unit_of_measure,
      });
    }

    const nextStatus = allComplete ? "RECEIVED" : "PARTIALLY_RECEIVED";
    await prisma.purchase_orders.update({
      where: { id: poId },
      data: {
        status: nextStatus,
        updated_at: new Date(),
        updated_by: userId,
      },
    });

    // Write GRN Audit Log
    await prisma.auditLog.create({
      data: {
        outletId,
        actor_id: userId,
        action: "UPDATE",
        entityType: "INVENTORY_GRN",
        entityId: poId,
        beforeState: { status: po.status },
        afterState: { status: nextStatus, receivedItems, poNumber: po.po_number, vendorName: po.vendors?.name },
        createdAt: new Date(),
      },
    });


    import("../websockets").then(({ broadcast }) => {
      broadcast("inventory.stock_updated", {
        outletId,
        poId,
        poNumber: po.po_number,
        receivedCount: receivedItems.length,
      });
    }).catch(err => console.error('Background task error:', err?.message || err));

    res.status(200).json({
      ok: true,
      message: `Goods for ${po.po_number} received. Status ${nextStatus}.`,
      poNumber: po.po_number,
      status: nextStatus,
      receivedItems,
    });
  } catch (error: any) {
    console.error("Error receiving purchase order:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /inventory/availability/export - Export 86 item availability list
inventoryRouter.get("/availability/export", requireAuth, requirePermission("inventory.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const category = req.query.category as string;

    const items = await prisma.menuItem.findMany({
      where: {
        outletId,
        ...(category && category !== "All" ? { category: { name: category } } : {}),
      },
      include: {
        category: true,
      },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    });

    const availabilityRows = await prisma.item_availability.findMany({
      where: { outlet_id: outletId },
      select: { item_id: true, state: true, version: true },
    });
    const availByItem = new Map<string, { state: string; version: number }>();
    for (const row of availabilityRows) {
      const prev = availByItem.get(row.item_id);
      if (!prev || row.version >= prev.version) availByItem.set(row.item_id, { state: row.state, version: row.version });
    }

    const payload = items.map((it) => {
      const avail = availByItem.get(it.id);
      const isStocked = avail ? avail.state !== "OFF" : it.isActive !== false;
      return {
        id: it.id,
        name: it.name,
        code: (it as any).code || "",
        category: it.category?.name || "General",
        priceMinor: Math.round(Number(it.price || 0) * 100),
        priceFormatted: `₹${Number(it.price || 0).toFixed(2)}`,
        isVeg: it.isVeg,
        isStocked,
        stockQty: isStocked ? 1 : 0,
        status: isStocked ? "IN_STOCK" : "86_OUT_OF_STOCK",
      };
    });

    res.status(200).json(payload);
  } catch (error: any) {
    console.error("Error exporting availability:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /inventory/wastage - Log ingredient wastage/spoilage
inventoryRouter.post("/wastage", requireAuth, requirePermission("inventory.write"), async (req: AuthedRequest, res) => {
  const { ingredientId, quantity, reason } = req.body;

  if (!ingredientId || quantity === undefined || !reason) {
    return res.status(400).json({ error: "Missing ingredientId, quantity, or reason" });
  }

  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;

    const existing = await prisma.ingredients.findFirst({
      where: { id: ingredientId, outlet_id: outletId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Ingredient not found" });
    }

    const newStock = Number(existing.current_stock_qty) - Number(quantity);

    await prisma.$transaction(async (tx) => {
      // 1. Deduct stock
      await tx.ingredients.update({
        where: { id: ingredientId },
        data: {
          current_stock_qty: newStock,
          updated_at: new Date(),
          updated_by: userId,
        },
      });

      // 2. Log to InventoryWastageLog
      const log = await (tx as any).inventoryWastageLog.create({
        data: {
          outletId,
          ingredientId,
          quantity: Number(quantity),
          reason,
          loggedBy: userId,
        },
      });

      // 3. Write Audit Log
      await tx.auditLog.create({
        data: {
          outletId,
          actor_id: userId,
          action: "CREATE",
          entityType: "INVENTORY_WASTAGE",
          entityId: log.id,
          beforeState: { currentStock: Number(existing.current_stock_qty) },
          afterState: { currentStock: newStock, wastageAmount: Number(quantity), reason },
          createdAt: new Date(),
        },
      });
    });

    res.status(200).json({ success: true, currentStock: newStock, message: "Wastage logged successfully" });
  } catch (error: any) {
    console.error("Error logging wastage:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /inventory/purchase-orders/:id/pay - Pay a vendor for a purchase order
inventoryRouter.post("/purchase-orders/:id/pay", requireAuth, requirePermission("inventory.write"), async (req: AuthedRequest, res) => {
  const poId = req.params.id;
  
  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;
    const paymentMethod = req.body.paymentMethod || "CASH";
    const paymentRef = req.body.paymentRef || null;

    const po = await prisma.purchase_orders.findFirst({
      where: { id: poId, outlet_id: outletId },
      include: { vendors: true }
    });

    if (!po) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    if (po.status === "PAID") {
      return res.status(400).json({ error: "Purchase order is already paid" });
    }

    const newStatus = "PAID";

    await prisma.$transaction(async (tx) => {
      // 1. Update PO Status
      await tx.purchase_orders.update({
        where: { id: poId },
        data: {
          status: newStatus,
          updated_at: new Date(),
          updated_by: userId,
        },
      });

      // 2. Record to Petty Cash Ledger if cash
      if (paymentMethod === "CASH") {
        await tx.petty_cash_ledger.create({
          data: {
            outlet_id: outletId,
            amount_minor: -po.total_amount_minor, // Expense
            category: "VENDOR_PAYMENT",
            description: `Payment for PO ${po.po_number} to ${po.vendors?.name}`,
            paid_to: po.vendors?.name || "Vendor",
            recorded_by: userId,
          }
        });
      }

      // 3. Audit Log
      await tx.auditLog.create({
        data: {
          outletId,
          actor_id: userId,
          action: "UPDATE",
          entityType: "INVENTORY_PO_PAYMENT",
          entityId: poId,
          beforeState: { status: po.status },
          afterState: { status: newStatus, paymentMethod, paymentRef, amount: Number(po.total_amount_minor) },
          createdAt: new Date(),
        },
      });
    });

    res.status(200).json({ success: true, message: "Purchase order marked as paid", status: newStatus });
  } catch (error: any) {
    console.error("Error paying purchase order:", error);
    res.status(500).json({ error: error.message });
  }
});
