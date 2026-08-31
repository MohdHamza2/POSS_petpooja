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
      orderBy: [{ version: "desc" }, { created_at: "desc" }],
    });

    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'A',location:'inventory-depletion.ts:recipes-for-item',message:'BOM recipes for order item',data:{orderId,menuItemId:item.menuItemId,itemName:item.item_name,recipeCount:matchingRecipes.length,ingCount:matchingRecipes.reduce((n,r)=>n+(r.recipe_ingredients||[]).length,0)},timestamp:Date.now(),runId:'post-fix'})}).catch(()=>{});
    // #endregion

    const latestByMenu = new Map<string, (typeof matchingRecipes)[number]>();
    for (const recipe of matchingRecipes) {
      const key = recipe.menu_item_id || recipe.id;
      if (!latestByMenu.has(key)) latestByMenu.set(key, recipe);
    }
    const keepIds = [...latestByMenu.values()].map((r) => r.id);
    if (item.menuItemId && matchingRecipes.length > keepIds.length) {
      const deactivated = await prisma.recipes.updateMany({
        where: {
          menu_item_id: item.menuItemId,
          is_active: true,
          id: { notIn: keepIds },
        },
        data: { is_active: false, updated_at: new Date() },
      });
      // #region agent log
      fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'B1',location:'inventory-depletion.ts:stale-recipes',message:'deactivated extra active recipes',data:{orderId,menuItemId:item.menuItemId,activeBefore:matchingRecipes.length,kept:keepIds.length,deactivated:deactivated.count},timestamp:Date.now(),runId:'tax-fix'})}).catch(()=>{});
      // #endregion
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


  // #region agent log
  fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'F',location:'inventory-depletion.ts:deductBomStockForOrder',message:'BOM deduct result',data:{orderId,outletId,reasonCode,deductedCount,skippedDuplicate,detailCount:details.length,first:details[0]?{ingredientName:details[0].ingredientName,ingredientId:details[0].ingredientId,deductedQty:details[0].deductedQty,remainingStock:details[0].remainingStock,shortage:details[0].shortage}:null},timestamp:Date.now(),runId:'post-fix'})}).catch(()=>{});
  // #endregion
  return { deductedCount, skippedDuplicate, details };
}
