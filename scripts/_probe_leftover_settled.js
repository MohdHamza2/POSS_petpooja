require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const { accessToken } = await lr.json();
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };

  const leftover = await prisma.order.findFirst({
    where: { orderNumber: "20260831-0008" },
    include: { invoices: true, diningTable: true, kotTickets: true },
  });
  const payments = leftover ? await prisma.payment.findMany({ where: { orderId: leftover.id } }) : [];
  const bom = leftover
    ? await prisma.inventoryConsumptionLog.findMany({ where: { orderId: leftover.id } })
    : [];
  const rice = await prisma.ingredients.findUnique({
    where: { id: "434437c3-4607-4b7b-9384-54f0ee1c1acd" },
    select: { name: true, current_stock_qty: true },
  });
  const tables = await prisma.diningTable.findMany({
    where: { tableNumber: { in: ["M2_6359", "M2_6609", "M2_8391", "T-09"] } },
    select: { tableNumber: true, status: true, mergeGroupId: true },
  });
  const occ = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();
  const drawer = await (await fetch(`${BASE}/finance/cash-drawer`, { headers: H })).json();
  const from = new Date();
  from.setDate(from.getDate() - 1);
  const qs = `fromDate=${encodeURIComponent(from.toISOString())}&toDate=${encodeURIComponent(new Date().toISOString())}`;
  const dash = await (await fetch(`${BASE}/reporting/dashboard?${qs}`, { headers: H })).json().catch(() => null);
  const gst = await (await fetch(`${BASE}/reporting/tax-breakdown?${qs}`, { headers: H })).json().catch(() => null);
  const invoices = await (await fetch(`${BASE}/reporting/invoices?limit=25&${qs}`, { headers: H })).json().catch(() => null);
  const leak = await (await fetch(`${BASE}/reporting/leakage-report?${qs}`, { headers: H })).json().catch(() => null);
  const tta = await (await fetch(`${BASE}/reporting/table-turnaround?${qs}`, { headers: H })).json().catch(() => null);
  const reSettle = leftover
    ? await fetch(`${BASE}/orders/${leftover.id}/settle`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ paymentMethod: "CASH", amountPaidMinor: 32000 }),
      })
    : null;
  const reJson = reSettle ? await reSettle.json().catch(() => ({})) : null;

  const invoiceRows = Array.isArray(invoices) ? invoices : invoices?.invoices || invoices?.rows || [];
  const lastInv = Array.isArray(invoiceRows)
    ? invoiceRows.find((r) => String(r.invoiceNumber || r.number || "").includes("00038"))
    : null;

  const customers = await prisma.customer.findMany({
    where: {
      OR: [
        { firstName: { contains: "Cover", mode: "insensitive" } },
        { lastName: { contains: "Cover", mode: "insensitive" } },
      ],
    },
    take: 20,
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  const loyalty = customers.length
    ? await prisma.loyalty_accounts.findMany({
        where: { customer_id: { in: customers.map((c) => c.id) } },
      })
    : [];

  console.log(
    json({
      leftover: leftover && {
        id: leftover.id,
        status: leftover.status,
        settledAt: leftover.settledAt,
        grand: leftover.grandTotal.toString(),
        invoices: leftover.invoices.map((i) => ({ n: i.invoiceNumber, amt: i.amountMinor.toString(), tax: i.taxAmountMinor.toString() })),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount.toString(), status: p.status })),
        kots: leftover.kotTickets.map((k) => k.status),
        table: leftover.diningTable && leftover.diningTable.tableNumber,
        customerId: leftover.customerId,
      },
      bom: bom.map((b) => ({
        ingredientId: b.ingredientId,
        qty: b.quantityDeducted.toString(),
        remaining: b.remainingStock.toString(),
        orderItemId: b.orderItemId,
      })),
      rice,
      tables,
      occupancy: { occupied: occ.occupiedTables, total: occ.totalTables, rate: occ.occupancyRatePercent },
      drawer: {
        session: drawer.sessionStatus,
        opening: drawer.openingFloatMinor,
        cashSales: drawer.cashSalesMinor,
        petty: drawer.pettyCashTotalMinor,
        expected: drawer.expectedCashMinor,
      },
      dash: dash && {
        occupancy: dash.occupancy || dash.occupancyRatePercent,
        gst: dash.gst || dash.gstCollected,
        invoices: dash.invoiceCount,
        leakage: dash.leakage,
        tta: dash.tableTurnaround || dash.tta,
      },
      gstKeys: gst && Object.keys(gst),
      leak,
      tta,
      lastInv,
      reSettle: reSettle && { status: reSettle.status, body: reJson },
      customers,
      loyalty,
    })
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
