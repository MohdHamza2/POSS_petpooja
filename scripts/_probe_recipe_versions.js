require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const ings = await p.ingredients.findMany({
    where: {
      id: {
        in: [
          "434437c3-4607-4b7b-9384-54f0ee1c1acd",
          "f430aabc-71a3-4f0f-b07d-08d806ec636b",
        ],
      },
    },
  });
  console.log(
    "INGS",
    JSON.stringify(
      ings.map((i) => ({ id: i.id, name: i.name, stock: Number(i.current_stock_qty) })),
      null,
      2
    )
  );
  const recs = await p.recipes.findMany({
    where: { menu_item_id: "923df5bf-7d93-4061-926e-8a5c2c41d7d0" },
    include: { recipe_ingredients: true },
    orderBy: [{ version: "desc" }, { created_at: "desc" }],
  });
  console.log(
    "RECS",
    JSON.stringify(
      recs.map((r) => ({
        id: r.id,
        name: r.name,
        ver: r.version,
        created: r.created_at,
        ings: r.recipe_ingredients.map((ri) => ({
          ing: ri.ingredient_id,
          qty: Number(ri.quantity),
        })),
      })),
      null,
      2
    )
  );
  const last = await p.inventoryConsumptionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  console.log(
    "LAST LOGS",
    JSON.stringify(
      last.map((l) => ({
        orderId: l.orderId,
        ing: l.ingredientId,
        recipe: l.recipeId,
        qty: Number(l.quantityDeducted),
        rem: Number(l.remainingStock),
        reason: l.reasonCode,
        at: l.createdAt,
      })),
      null,
      2
    )
  );
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
