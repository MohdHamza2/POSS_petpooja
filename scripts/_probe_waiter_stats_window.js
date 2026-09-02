require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const IDS = [
  "ad7d094b-b296-44e4-a830-14f90e5376d4",
  "86809e47-852f-4b37-89fc-1d584afbf1d4",
  "8d6fb839-ac37-455c-b5c4-d9c9f73238cc",
];
const ADMIN = "2b76bd69-4aba-4b3b-8c13-b20e3a9b434b";
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";

(async () => {
  const orders = await prisma.order.findMany({
    where: { id: { in: IDS } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      createdAt: true,
      settledAt: true,
      created_by: true,
      grandTotal: true,
    },
  });
  const pays = await prisma.payment.findMany({
    where: { orderId: { in: IDS } },
    select: { orderId: true, amount: true, method: true, status: true, createdAt: true },
  });
  const rice = await prisma.ingredients.findUnique({
    where: { id: "434437c3-4607-4b7b-9384-54f0ee1c1acd" },
    select: { name: true, current_stock_qty: true },
  });
  const cons = await prisma.inventoryConsumptionLog.findMany({
    where: { orderId: { in: IDS } },
    select: { orderId: true, ingredientId: true, quantityDeducted: true, remainingStock: true, reasonCode: true },
  });
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const tok = (await lr.json()).accessToken;
  const H = { Authorization: `Bearer ${tok}`, "X-Outlet-Id": OUTLET };
  const stats = await (await fetch(`${BASE}/waiters/me/stats`, { headers: H })).json();
  const recon = await (await fetch(`${BASE}/waiters/me/shift-reconciliation`, { headers: H })).json();
  const drawer = await (await fetch(`${BASE}/finance/cash-drawer`, { headers: H })).json();
  const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
  console.log(
    JSON.stringify(
      {
        orders: orders.map((o) => ({
          n: o.orderNumber,
          createdAt: o.createdAt,
          settledAt: o.settledAt,
          created_by: o.created_by,
          matchAdmin: o.created_by === ADMIN,
          grand: String(o.grandTotal),
        })),
        pays,
        rice,
        cons,
        stats,
        recon: {
          orderCount: recon.orderCount,
          cashSalesMinor: recon.cashSalesMinor,
          shiftDate: recon.shiftDate,
          recent: (recon.recentOrders || []).map((o) => o.orderNumber),
        },
        drawer: {
          date: drawer.date,
          cashSalesMinor: drawer.cashSalesMinor,
          expectedCashMinor: drawer.expectedCashMinor,
          openingFloatMinor: drawer.openingFloatMinor,
        },
      },
      big,
      2
    )
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
