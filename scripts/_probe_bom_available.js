require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const BIRYANI = "923df5bf-7d93-4061-926e-8a5c2c41d7d0";

(async () => {
  const items = await prisma.menuItem.findMany({
    where: { outletId: OUTLET, isActive: true },
    select: { id: true, name: true, isActive: true },
  });
  const recipes = await prisma.recipes.findMany({
    where: { outlet_id: OUTLET, is_active: true, menu_item_id: { not: null } },
    select: { menu_item_id: true, name: true, version: true, created_at: true },
    orderBy: [{ version: "desc" }, { created_at: "desc" }],
  });
  const latest = new Map();
  for (const r of recipes) {
    if (!latest.has(r.menu_item_id)) latest.set(r.menu_item_id, r);
  }
  const avail = await prisma.item_availability.findMany({
    where: { outlet_id: OUTLET, item_id: { in: [...latest.keys()] } },
  });
  const availByItem = new Map();
  for (const a of avail) {
    const cur = availByItem.get(a.item_id) || [];
    cur.push({ channel: a.channel_id, state: a.state, version: a.version });
    availByItem.set(a.item_id, cur);
  }
  const withBom = [];
  for (const [menuId, rec] of latest) {
    const mi = items.find((i) => i.id === menuId);
    withBom.push({
      menuId,
      itemName: mi ? mi.name : "(inactive or missing)",
      isActive: mi ? mi.isActive : false,
      recipe: rec.name,
      version: rec.version,
      availability: availByItem.get(menuId) || [],
    });
  }
  const biryaniRecipe = await prisma.recipes.findFirst({
    where: { menu_item_id: BIRYANI },
    orderBy: [{ version: "desc" }, { created_at: "desc" }],
    include: { recipe_ingredients: { include: { ingredients: true } } },
  });
  console.log(
    JSON.stringify(
      {
        distinctBomItems: withBom.length,
        withBom,
        biryaniLatest: biryaniRecipe && {
          id: biryaniRecipe.id,
          version: biryaniRecipe.version,
          ings: biryaniRecipe.recipe_ingredients.map((ri) => ({
            name: ri.ingredients.name,
            qty: String(ri.quantity),
            stock: String(ri.ingredients.current_stock_qty),
          })),
        },
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
