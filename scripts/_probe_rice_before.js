require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const rec = await prisma.recipes.findFirst({
    where: { menu_item_id: "923df5bf-7d93-4061-926e-8a5c2c41d7d0" },
    orderBy: [{ version: "desc" }, { created_at: "desc" }],
    include: { recipe_ingredients: { include: { ingredients: true } } },
  });
  console.log(
    JSON.stringify(
      {
        recipeId: rec && rec.id,
        version: rec && rec.version,
        ings: rec
          ? rec.recipe_ingredients.map((ri) => ({
              id: ri.ingredient_id,
              name: ri.ingredients.name,
              qty: String(ri.quantity),
              stock: String(ri.ingredients.current_stock_qty),
            }))
          : [],
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
