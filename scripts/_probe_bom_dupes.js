require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";

(async () => {
  const leftover = await p.kOTTicket.updateMany({
    where: { orderId: "859dfe7d-6035-4cdb-9579-eb74e265d42d", status: { not: "CANCELLED" } },
    data: { status: "CANCELLED", updatedAt: new Date() },
  });

  const recipes = await p.recipes.groupBy({
    by: ["menu_item_id"],
    where: { outlet_id: OUTLET, is_active: true },
    _count: { id: true },
  });
  const multi = recipes.filter((r) => r._count.id > 1).sort((a, b) => b._count.id - a._count.id);
  const named = await Promise.all(
    multi.slice(0, 15).map(async (r) => {
      const m = r.menu_item_id
        ? await p.menuItem.findUnique({ where: { id: r.menu_item_id }, select: { id: true, name: true } })
        : null;
      return { menuItemId: r.menu_item_id, name: m && m.name, activeRecipes: r._count.id };
    })
  );

  let deactivated = 0;
  for (const r of multi) {
    if (!r.menu_item_id) continue;
    const latest = await p.recipes.findFirst({
      where: { outlet_id: OUTLET, menu_item_id: r.menu_item_id, is_active: true },
      orderBy: [{ version: "desc" }, { created_at: "desc" }],
      select: { id: true },
    });
    if (!latest) continue;
    const extra = await p.recipes.updateMany({
      where: {
        outlet_id: OUTLET,
        menu_item_id: r.menu_item_id,
        is_active: true,
        id: { not: latest.id },
      },
      data: { is_active: false, updated_at: new Date() },
    });
    deactivated += extra.count;
  }

  const after = await p.recipes.groupBy({
    by: ["menu_item_id"],
    where: { outlet_id: OUTLET, is_active: true },
    _count: { id: true },
  });
  const stillMulti = after.filter((r) => r._count.id > 1).length;

  const customer = await p.customer.findFirst({
    where: { outletId: OUTLET, phone: "9980123299" },
    select: { id: true, name: true, phone: true, loyaltyPoints: true },
  });
  const acct = customer
    ? await p.loyalty_accounts.findUnique({ where: { customer_id: customer.id } })
    : null;

  const biryani = await p.menuItem.findMany({
    where: { outletId: OUTLET, name: { contains: "Biryani" } },
    select: { id: true, name: true },
  });
  const biryaniRecipes = await Promise.all(
    biryani.map(async (m) => {
      const c = await p.recipes.count({ where: { menu_item_id: m.id, is_active: true } });
      return { id: m.id, name: m.name, activeRecipes: c };
    })
  );

  console.log(
    JSON.stringify(
      {
        leftoverKotsCancelled: leftover.count,
        multiBefore: named,
        deactivated,
        stillMulti,
        chromeCover: customer
          ? {
              id: customer.id,
              name: customer.name,
              phone: customer.phone,
              customerPoints: Number(customer.loyaltyPoints),
              accountBalance: acct ? Number(acct.balance) : null,
            }
          : null,
        biryaniRecipes,
      },
      null,
      2
    )
  );
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
