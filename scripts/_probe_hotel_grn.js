require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
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

  const hotel = await prisma.order.findFirst({
    where: { orderNumber: "20260831-0027" },
    include: { invoices: true, kotTickets: true, diningTable: true },
  });
  const payments = hotel ? await prisma.payment.findMany({ where: { orderId: hotel.id } }) : [];
  const bom = hotel ? await prisma.inventoryConsumptionLog.findMany({ where: { orderId: hotel.id } }) : [];
  const rice = await prisma.ingredients.findUnique({ where: { id: RICE }, select: { name: true, current_stock_qty: true } });
  const occ = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();
  const drawer = await (await fetch(`${BASE}/finance/cash-drawer`, { headers: H })).json();
  const chrome = await (await fetch(`${BASE}/crm/customers?search=Chrome&limit=5`, { headers: H })).json();
  const reSettle = hotel
    ? await fetch(`${BASE}/orders/${hotel.id}/settle`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ paymentMethod: "CASH", amountPaidMinor: 32000 }),
      })
    : null;

  const poId = "c07636e3-3c2a-4d68-8e50-1f3d6990489e";
  const ingId = "5a579291-b824-4761-b1f6-676c08726473";
  const stockBefore = await prisma.ingredients.findUnique({
    where: { id: ingId },
    select: { name: true, current_stock_qty: true },
  });
  const grn = await fetch(`${BASE}/inventory/purchase-orders/${poId}/receive`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ items: [{ ingredientId: ingId, quantity: 10 }] }),
  });
  const grnBody = await grn.json().catch(() => ({}));
  const stockAfter = await prisma.ingredients.findUnique({
    where: { id: ingId },
    select: { current_stock_qty: true },
  });
  const poAfter = await prisma.purchase_orders.findUnique({
    where: { id: poId },
    include: { purchase_order_items: true },
  });

  console.log(
    json({
      hotel: hotel && {
        id: hotel.id,
        status: hotel.status,
        settledAt: hotel.settledAt,
        table: hotel.diningTable && { n: hotel.diningTable.tableNumber, s: hotel.diningTable.status },
        invoices: hotel.invoices.map((i) => ({ n: i.invoiceNumber, amt: i.amountMinor.toString(), tax: i.taxAmountMinor.toString() })),
        payments: payments.map((p) => ({ method: p.method, amt: p.amount.toString() })),
        kots: hotel.kotTickets.map((k) => k.status),
      },
      bom: bom.map((b) => ({ qty: b.quantityDeducted.toString(), remaining: b.remainingStock && b.remainingStock.toString() })),
      rice,
      occ: { occupied: occ.occupiedTables, rate: occ.occupancyRatePercent },
      drawer: { expected: drawer.expectedCashMinor, cash: drawer.cashSalesMinor },
      chromePts: (chrome.customers || []).map((c) => ({ name: `${c.firstName} ${c.lastName}`, pts: c.loyaltyPoints })),
      reSettle: reSettle && reSettle.status,
      grn: {
        status: grn.status,
        message: grnBody.message,
        nextStatus: grnBody.nextStatus || grnBody.status,
        receivedItems: grnBody.receivedItems,
        stockBefore: stockBefore && stockBefore.current_stock_qty.toString(),
        stockAfter: stockAfter && stockAfter.current_stock_qty.toString(),
        poStatus: poAfter && poAfter.status,
        receivedQty: poAfter && poAfter.purchase_order_items.map((i) => Number(i.received_qty)),
      },
    })
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
