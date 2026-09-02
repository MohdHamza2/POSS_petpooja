require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@restaurant.com",
      password: "admin123",
      outletId: OUTLET,
    }),
  });
  const TOK = (await lr.json()).accessToken;
  const H = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOK}`,
    "X-Outlet-Id": OUTLET,
  };
  const order = await prisma.order.findFirst({
    where: { orderNumber: "20260831-0024" },
    include: {
      kotTickets: { include: { kotItems: { include: { menuItem: true } } } },
      orderItems: true,
      diningTable: true,
    },
  });
  const serveResults = [];
  if (order) {
    for (const k of order.kotTickets) {
      for (const toStatus of ["PREPARING", "READY", "SERVED"]) {
        if (k.status === "SERVED") break;
        const r = await fetch(`${BASE}/kitchen/kot/${k.id}/status`, {
          method: "PATCH",
          headers: H,
          body: JSON.stringify({ toStatus }),
        });
        serveResults.push({ id: k.id, from: k.status, toStatus, status: r.status });
      }
    }
  }
  const after = await prisma.order.findFirst({
    where: { orderNumber: "20260831-0024" },
    include: {
      kotTickets: { include: { kotItems: { include: { menuItem: { select: { name: true } } } } } },
      diningTable: true,
    },
  });
  const kotItemOrderItemIds = (after?.kotTickets || []).flatMap((k) =>
    k.kotItems.map((i) => i.orderItemId)
  );
  const occ = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();
  const tables = await (await fetch(`${BASE}/tables`, { headers: H })).json();
  const t09 = (Array.isArray(tables) ? tables : []).find((x) => x.tableNumber === "T-09");
  console.log(
    JSON.stringify(
      {
        orderId: after && after.id,
        status: after && after.status,
        tableStatus: after && after.diningTable && after.diningTable.status,
        kotCount: after ? after.kotTickets.length : 0,
        kots: (after?.kotTickets || []).map((k) => ({
          id: k.id,
          num: k.ticketNumber,
          status: k.status,
          items: k.kotItems.map((i) => ({
            name: i.menuItem && i.menuItem.name,
            qty: Number(i.quantity),
            orderItemId: i.orderItemId,
          })),
        })),
        uniqueKotOrderItemIds: [...new Set(kotItemOrderItemIds)].length,
        kotItemCount: kotItemOrderItemIds.length,
        serveResults,
        occupancy: {
          occupied: occ.occupiedTables,
          total: occ.totalTables,
          rate: occ.occupancyRatePercent,
        },
        t09: t09 && {
          status: t09.status,
          kitchenStage: t09.kitchenStage,
          orderNumber: t09.currentOrder && t09.currentOrder.orderNumber,
          kotCount: t09.currentOrder && t09.currentOrder.kots && t09.currentOrder.kots.length,
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
