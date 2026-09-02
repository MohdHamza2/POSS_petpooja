require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const ORDER_ID = "58f85783-ec12-4170-8529-554d92034153";

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
  const H = { Authorization: `Bearer ${TOK}`, "X-Outlet-Id": OUTLET };
  const order = await prisma.order.findUnique({
    where: { id: ORDER_ID },
    include: { invoices: true, diningTable: true, kotTickets: true },
  });
  const payments = await prisma.payment.findMany({ where: { orderId: ORDER_ID } });
  const consumption = await prisma.inventoryConsumptionLog.findMany({ where: { orderId: ORDER_ID } });
  const rice = await prisma.ingredients.findUnique({
    where: { id: "434437c3-4607-4b7b-9384-54f0ee1c1acd" },
    select: { current_stock_qty: true, name: true },
  });
  const settleAgain = await fetch(`${BASE}/orders/${ORDER_ID}/settle`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ payments: [{ method: "CASH", amount: 41000 }] }),
  });
  const occ = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();
  const z = await (await fetch(`${BASE}/finance/z-report`, { headers: H })).json();
  console.log(
    JSON.stringify(
      {
        status: order && order.status,
        settledAt: order && order.settledAt,
        tableStatus: order && order.diningTable && order.diningTable.status,
        invoices: (order?.invoices || []).map((i) => ({
          n: i.invoiceNumber,
          amount: String(i.amountMinor),
          split: i.splitIndex,
        })),
        payments: payments.map((p) => ({ method: p.method, amount: String(p.amount), status: p.status })),
        bom: consumption.map((c) => ({
          ingredientId: c.ingredientId,
          qty: String(c.quantityDeducted),
          remaining: String(c.remainingStock),
        })),
        rice,
        settleAgain: settleAgain.status,
        occupancy: { occupied: occ.occupiedTables, rate: occ.occupancyRatePercent },
        zInvoiceCount: z.invoiceCount || (z.data && z.data.invoiceCount),
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
