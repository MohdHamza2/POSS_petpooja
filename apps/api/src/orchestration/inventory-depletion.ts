import { PrismaClient } from "@prisma/client";

export interface BomDeductionResult {
  deductedCount: number;
  skippedDuplicate: number;
  details: {
    menuItemId: string;
    ingredientId: string;
    ingredientName: string;
    deductedQty: number;
    remainingStock: number;
    shortage: number;
  }[];
}

async function markItemUnavailable(
  prisma: PrismaClient,
  outletId: string,
  menuItemId: string,
  actorUserId?: string
): Promise<void> {
  const accounts = await prisma.channelAccount.findMany({
    where: { outletId },
    select: { id: true },
  });
  const channelIds = accounts.length > 0 ? accounts.map((a) => a.id) : [outletId];

  for (const channelId of channelIds) {
    const existing = await prisma.item_availability.findFirst({
      where: { outlet_id: outletId, item_id: menuItemId, channel_id: channelId },
    });
    if (existing) {
      await prisma.item_availability.update({
        where: { id: existing.id },
        data: {
          state: "OFF",
          version: { increment: 1 },
          updated_at: new Date(),
          updated_by: actorUserId || undefined,
        },
      });
    } else {
      await prisma.item_availability.create({
        data: {
          outlet_id: outletId,
          item_id: menuItemId,
          channel_id: channelId,
          state: "OFF",
          version: 1,
          created_by: actorUserId || undefined,
          updated_by: actorUserId || undefined,
        },
      });
    }
  }
}

/**
 * Deducts ingredient stock based on Recipe BOM once per (order_item, ingredient, recipe).
 * Never floors remaining stock with Math.max(0). Shortage is recorded on the ledger.
 */
export async function deductBomStockForOrder(
  orderId: string,
  outletId: string,
  prisma: PrismaClient,
  actorUserId?: string,
  reasonCode: string = "ORDER_SETTLED"
): Promise<BomDeductionResult> {
  const details: BomDeductionResult["details"] = [];
  let deductedCount = 0;
  let skippedDuplicate = 0;

  const orderItems = await prisma.orderItem.findMany({
    where: { orderId, isVoided: false },
  });

  if (orderItems.length === 0) {
    return { deductedCount: 0, skippedDuplicate: 0, details: [] };
  }

  for (const item of orderItems) {
    if (!item.menuItemId) continue;

    const matchingRecipes = await prisma.recipes.findMany({
      where: {
        menu_item_id: item.menuItemId,
        is_active: true,
      },
      include: {
        recipe_ingredients: {
          include: {
            ingredients: true,
          },
        },
      },
      orderBy: { version: "desc" },
    });

    const latestByMenu = new Map<string, (typeof matchingRecipes)[number]>();
    for (const recipe of matchingRecipes) {
      const key = recipe.menu_item_id || recipe.id;
      if (!latestByMenu.has(key)) latestByMenu.set(key, recipe);
    }

    for (const recipe of latestByMenu.values()) {
      for (const ri of recipe.recipe_ingredients || []) {
        const already = await prisma.inventoryConsumptionLog.findUnique({
          where: {
            orderItemId_ingredientId_recipeId: {
              orderItemId: item.id,
              ingredientId: ri.ingredient_id,
              recipeId: recipe.id,
            },
          },
        }).catch(() => null);

        if (already) {
          skippedDuplicate += 1;
          continue;
        }

        const qtyToDeduct = Number(item.quantity) * Number(ri.quantity);
        const currentIng = await prisma.ingredients.findUnique({
          where: { id: ri.ingredient_id },
        });
        if (!currentIng) continue;

        const previous = Number(currentIng.current_stock_qty);
        const remaining = previous - qtyToDeduct;
        const shortage = remaining < 0 ? Math.abs(remaining) : 0;

        const updatedIng = await prisma.ingredients.update({
          where: { id: ri.ingredient_id },
          data: {
            current_stock_qty: remaining,
            updated_at: new Date(),
            updated_by: actorUserId || undefined,
          },
        });

        await prisma.inventoryConsumptionLog.create({
          data: {
            outletId,
            orderId,
            orderItemId: item.id,
            ingredientId: ri.ingredient_id,
            recipeId: recipe.id,
            quantityDeducted: qtyToDeduct,
            remainingStock: remaining,
            shortage,
            reasonCode,
          },
        });

        deductedCount += 1;
        details.push({
          menuItemId: item.menuItemId,
          ingredientId: ri.ingredient_id,
          ingredientName: updatedIng.name,
          deductedQty: qtyToDeduct,
          remainingStock: remaining,
          shortage,
        });

        await prisma.auditLog.create({
          data: {
            outletId,
            actor_id: actorUserId || outletId,
            action: "UPDATE",
            entityType: "INVENTORY_BOM_DEDUCTION",
            entityId: ri.ingredient_id,
            afterState: {
              orderId,
              orderItemId: item.id,
              menuItemId: item.menuItemId,
              ingredientName: updatedIng.name,
              deductedQty: qtyToDeduct,
              remainingStock: remaining,
              shortage,
              reasonCode,
            },
            createdAt: new Date(),
          },
        }).catch(() => undefined);

        if (remaining <= 0) {
          await markItemUnavailable(prisma, outletId, item.menuItemId, actorUserId);
        }
      }
    }
  }

  if (deductedCount > 0) {
    import("../websockets").then(({ broadcast }) => {
      broadcast("inventory.stock_updated", {
        outletId,
        orderId,
        deductedCount,
        details,
      });
    }).catch(() => undefined);
  }


  return { deductedCount, skippedDuplicate, details };
}
