require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";

(async () => {
  const from = new Date("2026-08-01T00:00:00.000Z");
  const to = new Date("2026-08-31T23:59:59.999Z");
  const rows = await prisma.order.findMany({
    where: {
      outletId: OUTLET,
      orderType: "DINE_IN",
      diningTableId: { not: null },
      settledAt: { gte: from, lte: to },
    },
    select: { id: true, orderNumber: true, createdAt: true, settledAt: true },
  });
  const scored = rows
    .map((r) => ({
      n: r.orderNumber,
      created: r.createdAt,
      settled: r.settledAt,
      minutes: (r.settledAt.getTime() - r.createdAt.getTime()) / 60000,
    }))
    .sort((a, b) => b.minutes - a.minutes);
  const avg = scored.reduce((s, r) => s + r.minutes, 0) / (scored.length || 1);
  const outlet = await prisma.outlet.findUnique({ where: { id: OUTLET } });
  const org = outlet
    ? await prisma.organization.findUnique({ where: { id: outlet.organizationId } })
    : null;
  const pos = await prisma.purchase_orders.findMany({
    where: { outlet_id: OUTLET },
    orderBy: { created_at: "desc" },
    take: 8,
    include: { vendors: true, purchase_order_items: { include: { ingredients: true } } },
  });
  console.log(
    JSON.stringify(
      {
        tta: {
          count: scored.length,
          avgMinutes: avg,
          over120: scored.filter((r) => r.minutes > 120).length,
          top5: scored.slice(0, 5).map((r) => ({
            n: r.n,
            minutes: Math.round(r.minutes),
            created: r.created,
            settled: r.settled,
          })),
        },
        gstin: org && { tax_id: org.tax_id, name: org.name },
        pos: pos.map((p) => ({
          id: p.id,
          po: p.po_number,
          status: p.status,
          vendor: p.vendors && p.vendors.name,
          items: p.purchase_order_items.map((i) => ({
            ing: i.ingredients && i.ingredients.name,
            qty: String(i.quantity),
            received: String(i.received_qty || 0),
            stock: i.ingredients && String(i.ingredients.current_stock_qty),
          })),
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
