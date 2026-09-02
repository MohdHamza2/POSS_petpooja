require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const OID = "e0599afd-564d-4fd7-a233-17c72306eb8f";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";

(async () => {
  const items = await prisma.orderItem.findMany({ where: { orderId: OID } });
  const menuIds = items.map((i) => i.menuItemId);
  const recipes = await prisma.recipes.findMany({
    where: { menu_item_id: { in: menuIds } },
    include: { recipe_ingredients: true },
  });
  const anyRecipes = await prisma.recipes.findMany({
    where: { outlet_id: OUTLET, is_active: true, menu_item_id: { not: null } },
    take: 15,
    select: { id: true, name: true, menu_item_id: true, version: true, is_active: true },
  });
  const recipeCount = await prisma.recipes.count({ where: { outlet_id: OUTLET } });
  const linkedCount = await prisma.recipes.count({
    where: { outlet_id: OUTLET, menu_item_id: { not: null } },
  });
  const withIng = await prisma.recipe_ingredients.groupBy({
    by: ["recipe_id"],
    _count: true,
  }).catch(() => []);
  const menus = await prisma.menuItem.findMany({
    where: { id: { in: menuIds } },
    select: { id: true, name: true },
  });
  const unbilled = await prisma.kOTTicket.findMany({
    where: {
      outletId: OUTLET,
      createdAt: {
        gte: new Date("2026-08-31T00:00:00.000Z"),
        lte: new Date("2026-08-31T23:59:59.999Z"),
      },
    },
    include: { order: { select: { id: true, status: true, settledAt: true, orderNumber: true, table_number: true } } },
    take: 40,
  });
  const liveUnbilled = unbilled.filter(
    (k) => k.order && k.order.settledAt == null && k.order.status !== "COMPLETED" && k.order.status !== "CANCELLED"
  );
  const org = await prisma.organization.findFirst({
    include: { /* none */ },
  }).catch(() => null);
  const orgs = await prisma.organization.findMany({ take: 3 });
  const sessions = await prisma.cash_drawer_sessions.findMany({
    where: { outlet_id: OUTLET },
    orderBy: { created_at: "desc" },
    take: 3,
  });

  console.log(
    JSON.stringify(
      {
        items: items.map((i) => ({ id: i.id, menuItemId: i.menuItemId, name: i.item_name, qty: Number(i.quantity) })),
        menus,
        recipesForCover: recipes.map((r) => ({
          id: r.id,
          name: r.name,
          menu_item_id: r.menu_item_id,
          version: r.version,
          active: r.is_active,
          ings: r.recipe_ingredients.length,
        })),
        recipeCount,
        linkedCount,
        sampleLinked: anyRecipes,
        withIngCount: Array.isArray(withIng) ? withIng.length : withIng,
        liveUnbilled: liveUnbilled.map((k) => ({
          ticket: k.ticketNumber,
          status: k.status,
          order: k.order,
        })),
        unbilledSample: unbilled.slice(0, 5).map((k) => ({
          ticket: k.ticketNumber,
          kotStatus: k.status,
          orderStatus: k.order && k.order.status,
          settledAt: k.order && k.order.settledAt,
          table: k.order && k.order.table_number,
        })),
        orgs,
        sessions: sessions.map((s) => ({
          id: s.id,
          status: s.status,
          expected: String(s.expected_close_balance_minor ?? ""),
          created: s.created_at,
        })),
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
