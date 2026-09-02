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
  const lj = await lr.json();
  const TOK = lj.accessToken;
  const H = {
    Authorization: `Bearer ${TOK}`,
    "X-Outlet-Id": OUTLET,
    "Content-Type": "application/json",
  };
  const leftover = await prisma.order.findFirst({
    where: { orderNumber: "20260831-0008" },
    include: { invoices: true, diningTable: true, kotTickets: true },
  });
  const payments = leftover
    ? await prisma.payment.findMany({ where: { orderId: leftover.id } })
    : [];
  const occ = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();
  const drawer = await (await fetch(`${BASE}/finance/cash-drawer`, { headers: H })).json();
  const z = await (await fetch(`${BASE}/finance/z-report`, { headers: H })).json();
  const outlet = await prisma.outlet.findUnique({
    where: { id: OUTLET },
    select: { loyaltyPaisePerPoint: true, name: true },
  });
  const org = await prisma.organization.findFirst({
    select: { tax_id: true, name: true },
  });
  const waiterOrder = await prisma.order.findFirst({
    where: { orderNumber: "20260831-0024" },
    select: { id: true, customerId: true, grandTotal: true, settledAt: true },
  });
  let loyalty = null;
  if (waiterOrder && waiterOrder.customerId) {
    loyalty = await prisma.loyalty_accounts.findFirst({
      where: { customer_id: waiterOrder.customerId, outlet_id: OUTLET },
    });
  }
  const rice = await prisma.ingredients.findUnique({
    where: { id: "434437c3-4607-4b7b-9384-54f0ee1c1acd" },
    select: { name: true, current_stock_qty: true },
  });
  const json = (v) =>
    JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);
  console.log(
    json(
      {
        leftover: leftover && {
          id: leftover.id,
          status: leftover.status,
          settledAt: leftover.settledAt,
          grand: String(leftover.grandTotal),
          table: leftover.diningTable && leftover.diningTable.tableNumber,
          tableStatus: leftover.diningTable && leftover.diningTable.status,
          invoices: leftover.invoices.length,
          kots: leftover.kotTickets.map((k) => k.status),
          payments: payments.map((p) => ({ method: p.method, amount: String(p.amount) })),
          customerId: leftover.customerId,
        },
        occupancy: { occupied: occ.occupiedTables, total: occ.totalTables, rate: occ.occupancyRatePercent },
        drawer: {
          session: drawer.sessionStatus,
          opening: drawer.openingFloatMinor,
          cashSales: drawer.cashSalesMinor,
          petty: drawer.pettyCashTotalMinor,
          expected: drawer.expectedCashMinor,
        },
        z: { invoiceCount: z.invoiceCount, grandTotal: z.grandTotal, paymentModes: z.paymentModes },
        outlet,
        orgTax: org && org.tax_id,
        waiterOrder,
        loyalty,
        rice,
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
