import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

interface DynamicRestaurantData {
  organization: { name: string; taxNumber?: string };
  outlet: {
    name: string;
    code: string;
    address?: string;
    timezone?: string;
    currency?: string;
    dayStartTime?: string;
  };
  terminals?: Array<{ name: string; terminalNumber: string }>;
  diningTables?: Array<{ tableNumber: string; capacity?: number; section?: string }>;
  stations?: Array<{ name: string; printerIp?: string }>;
  users?: Array<{
    email: string;
    password?: string;
    pin?: string;
    firstName: string;
    lastName?: string;
    role: string;
  }>;
  categories?: Array<{ name: string; sortOrder?: number; description?: string }>;
  menuItems?: Array<{
    categoryName: string;
    name: string;
    description?: string;
    pricePaise: number;
    isVeg?: boolean;
    taxRate?: number;
    stockQty?: number;
  }>;
  ingredients?: Array<{
    name: string;
    unitOfMeasure: string;
    currentStock: number;
    reorderLevel: number;
    unitCostPaise: number;
  }>;
}

async function runDynamicSeed(filePath?: string) {
  const targetPath = filePath
    ? path.resolve(process.cwd(), filePath)
    : path.resolve(process.cwd(), "data/user-restaurant-template.json");

  console.log(`\n======================================================`);
  console.log(`[DYNAMIC INGESTION] Reading input data from:\n${targetPath}`);
  console.log(`======================================================\n`);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Data file not found at: ${targetPath}`);
  }

  const raw = fs.readFileSync(targetPath, "utf-8");
  const data: DynamicRestaurantData = JSON.parse(raw);

  // 1. Organization
  const org = await prisma.organization.upsert({
    where: { id: "00000000-0000-0000-0000-000000000000" },
    update: {
      name: data.organization.name,
      tax_id: data.organization.taxNumber,
    },
    create: {
      id: "00000000-0000-0000-0000-000000000000",
      name: data.organization.name,
      tax_id: data.organization.taxNumber,
    },
  });
  console.log(`✓ Organization: ${org.name}`);

  // 2. Outlet
  const outlet = await prisma.outlet.upsert({
    where: { organizationId_code: { organizationId: org.id, code: data.outlet.code } },
    update: {
      name: data.outlet.name,
      timezone: data.outlet.timezone || "Asia/Kolkata",
      currency: data.outlet.currency || "INR",
    },
    create: {
      organizationId: org.id,
      name: data.outlet.name,
      code: data.outlet.code,
      timezone: data.outlet.timezone || "Asia/Kolkata",
      currency: data.outlet.currency || "INR",
    },
  });
  console.log(`✓ Outlet: ${outlet.name} (${outlet.code})`);


  // 4. Dining Tables
  if (data.diningTables) {
    for (const dt of data.diningTables) {
      await prisma.diningTable.upsert({
        where: {
          outletId_tableNumber: {
            outletId: outlet.id,
            tableNumber: dt.tableNumber,
          },
        },
        update: {
          capacity: dt.capacity || 4,
          section: dt.section || "General",
        },
        create: {
          outletId: outlet.id,
          tableNumber: dt.tableNumber,
          capacity: dt.capacity || 4,
          section: dt.section || "General",
        },
      });
    }
    console.log(`✓ Dining Tables: ${data.diningTables.length} tables configured.`);
  }

  // 5. Stations
  if (data.stations) {
    for (const st of data.stations) {
      const existing = await prisma.station.findFirst({
        where: { outletId: outlet.id, name: st.name },
      });
      if (existing) {
        await prisma.station.update({
          where: { id: existing.id },
          data: { printerIp: st.printerIp },
        });
      } else {
        await prisma.station.create({
          data: {
            outletId: outlet.id,
            name: st.name,
            printerIp: st.printerIp,
          },
        });
      }
      console.log(`  - Kitchen Station: ${st.name} (Printer IP: ${st.printerIp || "LAN default"})`);
    }
  }

  // 6. Users & Roles
  if (data.users) {
    const salt = await bcrypt.genSalt(10);
    for (const u of data.users) {
      const passwordHash = await bcrypt.hash(u.password || "password123", salt);
      const pinHash = u.pin ? await bcrypt.hash(u.pin, salt) : null;

      const user = await prisma.user.upsert({
        where: { email: u.email },
        update: {
          firstName: u.firstName,
          lastName: u.lastName || "",
          passwordHash,
          pinHash,
        },
        create: {
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName || "",
          passwordHash,
          pinHash,
          isActive: true,
        },
      });

      const roleObj = await prisma.role.findUnique({
        where: { code: u.role },
      });

      if (roleObj) {
        const existingRole = await prisma.userRole.findFirst({
          where: { userId: user.id, roleId: roleObj.id }
        });
        if (existingRole) {
          await prisma.userRole.update({
            where: { id: existingRole.id },
            data: { outletId: outlet.id }
          });
        } else {
          await prisma.userRole.create({
            data: {
              userId: user.id,
              roleId: roleObj.id,
              outletId: outlet.id,
            },
          });
        }
        console.log(`  - User: ${user.email} (Role: ${u.role}, PIN: ${u.pin || "N/A"})`);
      }
    }
  }

  // 7. Categories
  const categoryMap = new Map<string, string>();
  if (data.categories) {
    for (let i = 0; i < data.categories.length; i++) {
      const cat = data.categories[i];
      const existing = await prisma.menuCategory.findFirst({
        where: { outletId: outlet.id, name: cat.name },
      });
      if (existing) {
        await prisma.menuCategory.update({
          where: { id: existing.id },
          data: { sortOrder: cat.sortOrder || i + 1, description: cat.description },
        });
        categoryMap.set(cat.name, existing.id);
      } else {
        const created = await prisma.menuCategory.create({
          data: {
            outletId: outlet.id,
            name: cat.name,
            sortOrder: cat.sortOrder || i + 1,
            description: cat.description,
            isActive: true,
          },
        });
        categoryMap.set(cat.name, created.id);
      }
    }
    console.log(`✓ Menu Categories: ${data.categories.length} categories synchronized.`);
  }

  // 8. Menu Items
  if (data.menuItems) {
    for (const item of data.menuItems) {
      let catId = categoryMap.get(item.categoryName);
      if (!catId) {
        const foundCat = await prisma.menuCategory.findFirst({
          where: { outletId: outlet.id, name: item.categoryName },
        });
        if (foundCat) catId = foundCat.id;
      }

      if (!catId) {
        console.warn(`[WARN] Category '${item.categoryName}' not found for item '${item.name}', skipping.`);
        continue;
      }

      const existingItem = await prisma.menuItem.findFirst({
        where: { outletId: outlet.id, name: item.name },
      });

      let menuItemId = "";
      if (existingItem) {
        await prisma.menuItem.update({
          where: { id: existingItem.id },
          data: {
            categoryId: catId,
            description: item.description,
            price: Number(item.pricePaise) / 100,
            isVeg: item.isVeg ?? true,
            taxRate: item.taxRate ?? 5.0,
          },
        });
        menuItemId = existingItem.id;
      } else {
        const created = await prisma.menuItem.create({
          data: {
            outletId: outlet.id,
            categoryId: catId,
            name: item.name,
            description: item.description,
            price: Number(item.pricePaise) / 100,
            isVeg: item.isVeg ?? true,
            taxRate: item.taxRate ?? 5.0,
            isActive: true,
          },
        });
        menuItemId = created.id;
      }

      await prisma.item_availability.upsert({
        where: {
          outlet_id_menu_item_id: {
            outlet_id: outlet.id,
            menu_item_id: menuItemId,
          },
        },
        update: {
          stock_qty: item.stockQty ?? 50,
          is_stocked: true,
        },
        create: {
          outlet_id: outlet.id,
          menu_item_id: menuItemId,
          stock_qty: item.stockQty ?? 50,
          is_stocked: true,
          version: 1,
        },
      });
      console.log(`  - Menu Item: ${item.name} (₹${(item.pricePaise / 100).toFixed(2)}, Stock: ${item.stockQty ?? 50})`);
    }
  }

  // 9. Ingredients
  if (data.ingredients) {
    for (const ing of data.ingredients) {
      const existing = await prisma.ingredients.findFirst({
        where: { outlet_id: outlet.id, name: ing.name },
      });
      if (existing) {
        await prisma.ingredients.update({
          where: { id: existing.id },
          data: {
            unit_of_measure: ing.unitOfMeasure,
            current_stock: ing.currentStock,
            reorder_level: ing.reorderLevel,
            unit_cost_minor: BigInt(ing.unitCostPaise),
          },
        });
      } else {
        await prisma.ingredients.create({
          data: {
            outlet_id: outlet.id,
            name: ing.name,
            unit_of_measure: ing.unitOfMeasure,
            current_stock: ing.currentStock,
            reorder_level: ing.reorderLevel,
            unit_cost_minor: BigInt(ing.unitCostPaise),
            is_active: true,
          },
        });
      }
      console.log(`  - Ingredient: ${ing.name} (${ing.currentStock} ${ing.unitOfMeasure}, Unit Cost: ₹${(ing.unitCostPaise / 100).toFixed(2)})`);
    }
    console.log(`✓ Ingredients: ${data.ingredients.length} raw inventory items synchronized.`);
  }

  console.log(`\n======================================================`);
  console.log(`[DYNAMIC INGESTION] Dynamic data insertion complete! 🚀`);
  console.log(`======================================================\n`);
}

const customFile = process.argv[2];
runDynamicSeed(customFile)
  .catch((e) => {
    console.error("[DYNAMIC INGESTION ERROR]", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
