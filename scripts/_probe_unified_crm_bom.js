require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const BIRYANI = "923df5bf-7d93-4061-926e-8a5c2c41d7d0";
const CUSTOMER = "63410ab6-d30a-44d8-932e-ba95cac5e060";
const RICE = "434437c3-4607-4b7b-9384-54f0ee1c1acd";
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const { accessToken } = await lr.json();
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };
  const tables = await (await fetch(`${BASE}/tables`, { headers: H })).json();
  const t09 = tables.find((t) => t.tableNumber === "T-09");
  const riceBefore = await prisma.ingredients.findUnique({ where: { id: RICE }, select: { current_stock_qty: true } });
  const ptsBefore = await prisma.customer.findUnique({ where: { id: CUSTOMER }, select: { loyaltyPoints: true } });
  const acctBefore = await prisma.loyalty_accounts.findUnique({ where: { customer_id: CUSTOMER } });

  const create = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      action: "KOT",
      diningTableId: t09.id,
      tableNumber: "T-09",
      orderType: "DINE_IN",
      customerId: CUSTOMER,
      lines: [{ menuItemId: BIRYANI, quantity: 1 }],
    }),
  });
  const created = await create.json();
  const occAfterKot = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();

  const orderId = created.id;
  const kots = await prisma.kOTTicket.findMany({ where: { orderId } });
  const serveResults = [];
  for (const k of kots) {
    for (const toStatus of ["PREPARING", "READY", "SERVED"]) {
      const r = await fetch(`${BASE}/kitchen/kot/${k.id}/status`, {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({ toStatus }),
      });
      serveResults.push({ kot: k.id, toStatus, status: r.status });
    }
  }

  const bill = await (await fetch(`${BASE}/orders/${orderId}/bill`, { headers: H })).json();
  const settle = await fetch(`${BASE}/orders/${orderId}/settle`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      paymentMethod: "CASH",
      amountPaidMinor: Number(bill.grandTotalMinor || created.grandTotal || 32000),
      customerId: CUSTOMER,
    }),
  });
  const settled = await settle.json();
  const occAfterSettle = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();
  const drawer = await (await fetch(`${BASE}/finance/cash-drawer`, { headers: H })).json();
  const afterOrder = await prisma.order.findUnique({
    where: { id: orderId },
    include: { invoices: true, kotTickets: true },
  });
  const bom = await prisma.inventoryConsumptionLog.findMany({ where: { orderId } });
  const riceAfter = await prisma.ingredients.findUnique({ where: { id: RICE }, select: { current_stock_qty: true } });
  const ptsAfter = await prisma.customer.findUnique({ where: { id: CUSTOMER }, select: { loyaltyPoints: true } });
  const acctAfter = await prisma.loyalty_accounts.findUnique({ where: { customer_id: CUSTOMER } });
  const reSettle = await fetch(`${BASE}/orders/${orderId}/settle`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ paymentMethod: "CASH", amountPaidMinor: 32000 }),
  });
  const t09After = await prisma.diningTable.findFirst({
    where: { tableNumber: "T-09" },
    select: { status: true, mergeGroupId: true },
  });

  console.log(
    json({
      createStatus: create.status,
      orderNumber: created.orderNumber,
      orderId,
      occAfterKot: { occupied: occAfterKot.occupiedTables, rate: occAfterKot.occupancyRatePercent },
      kotCount: kots.length,
      serveResults,
      settleStatus: settle.status,
      invoice: settled.invoiceNumber || settled.invoiceNumbers,
      orderStatus: afterOrder && afterOrder.status,
      invoices: (afterOrder && afterOrder.invoices) || [],
      bom: bom.map((b) => ({ qty: b.quantityDeducted.toString(), remaining: b.remainingStock && b.remainingStock.toString() })),
      rice: { before: riceBefore && riceBefore.current_stock_qty.toString(), after: riceAfter && riceAfter.current_stock_qty.toString() },
      loyalty: {
        ptsBefore: ptsBefore && ptsBefore.loyaltyPoints,
        ptsAfter: ptsAfter && ptsAfter.loyaltyPoints,
        acctBefore: acctBefore && acctBefore.balance.toString(),
        acctAfter: acctAfter && acctAfter.balance.toString(),
      },
      occAfterSettle: { occupied: occAfterSettle.occupiedTables, rate: occAfterSettle.occupancyRatePercent },
      t09After,
      drawerExpected: drawer.expectedCashMinor,
      reSettle: reSettle.status,
    })
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
