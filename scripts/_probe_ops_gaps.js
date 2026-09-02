require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const RICE = "434437c3-4607-4b7b-9384-54f0ee1c1acd";

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const TOK = (await lr.json()).accessToken;
  const H = { Authorization: `Bearer ${TOK}`, "X-Outlet-Id": OUTLET };
  const j = async (p) => {
    const r = await fetch(BASE + p, { headers: H });
    return { status: r.status, body: await r.json() };
  };

  const occ = await j("/tables/occupancy");
  const live = await j("/orders/live");
  const online = await j("/orders/live?kind=online");
  const oldOnline = await j("/orders?orderType=AGGREGATOR,DELIVERY&limit=5");
  const stats = await j("/waiters/me/stats");
  const recon = await j("/waiters/me/shift-reconciliation");

  const rice = await prisma.ingredients.findUnique({ where: { id: RICE } });
  const logs = await prisma.inventoryConsumptionLog.findMany({
    where: { ingredientId: RICE },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  const lastRemaining = logs[0] ? Number(logs[0].remainingStock) : null;
  const po = await prisma.purchase_orders.findMany({
    where: { outlet_id: OUTLET },
    orderBy: { created_at: "desc" },
    take: 3,
    select: { id: true, po_number: true, status: true, created_at: true },
  }).catch(() => []);

  console.log(
    JSON.stringify(
      {
        occupancy: {
          occupied: occ.body.occupiedTables,
          total: occ.body.totalTables,
          rate: occ.body.occupancyRatePercent,
        },
        liveCount: Array.isArray(live.body) ? live.body.length : 0,
        onlineCount: Array.isArray(online.body) ? online.body.length : 0,
        oldListCount: (oldOnline.body.orders || oldOnline.body || []).length,
        waiterStats: stats.body,
        recon: {
          orderCount: recon.body.orderCount,
          cash: recon.body.cashSalesMinor,
          tips: recon.body.digitalTipsMinor,
          revenue: recon.body.totalRevenueMinor,
        },
        rice: {
          stock: rice ? Number(rice.current_stock_qty) : null,
          lastLedgerRemaining: lastRemaining,
          match: rice && lastRemaining != null ? Number(rice.current_stock_qty) === lastRemaining : null,
          recent: logs.map((l) => ({
            qty: Number(l.quantityDeducted),
            remaining: l.remainingStock != null ? Number(l.remainingStock) : null,
            reason: l.reasonCode,
            at: l.createdAt,
            orderId: l.orderId,
          })),
        },
        recentPOs: po,
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
