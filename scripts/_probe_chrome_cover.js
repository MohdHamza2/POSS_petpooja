require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const OID = process.argv[2] || "e0599afd-564d-4fd7-a233-17c72306eb8f";

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
  const j = async (m, p, b) => {
    const r = await fetch(`${BASE}${p}`, {
      method: m,
      headers: H,
      body: b ? JSON.stringify(b) : undefined,
    });
    const t = await r.text();
    let d;
    try {
      d = JSON.parse(t);
    } catch {
      d = t;
    }
    return { status: r.status, data: d };
  };

  const order = await prisma.order.findUnique({
    where: { id: OID },
    include: { orderItems: true, invoices: true, kotTickets: { include: { kotItems: true } } },
  });
  const payments = await prisma.payment.findMany({ where: { orderId: OID } });
  const logs = await prisma.inventoryConsumptionLog.findMany({ where: { orderId: OID } });
  const invoice = order?.invoices?.[0] || null;
  const kots = order?.kotTickets || [];
  const cust = order?.customerId
    ? await prisma.customer.findUnique({ where: { id: order.customerId } })
    : null;
  const acct = order?.customerId
    ? await prisma.loyalty_accounts.findUnique({ where: { customer_id: order.customerId } }).catch(() => null)
    : null;

  const from = "2026-08-31T00:00:00.000Z";
  const to = "2026-08-31T23:59:59.999Z";
  const qs = `fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`;
  const drawer = await j("GET", "/finance/cash-drawer");
  const bill = await j("GET", `/orders/${OID}/bill`);
  const sales = await j("GET", `/reporting/sales-summary?${qs}`);
  const tax = await j("GET", `/reporting/tax-breakdown?${qs}`);
  const leakage = await j("GET", `/reporting/leakage-report?${qs}`);
  const invoices = await j("GET", `/reporting/invoices?limit=25&${qs}`);
  const occupancy = await j("GET", "/tables/occupancy");
  const tta = await j("GET", `/reporting/table-turnaround?${qs}`);
  const tables = await j("GET", "/tables");
  const t09 = Array.isArray(tables.data) ? tables.data.find((x) => x.tableNumber === "T-09") : null;
  const settleAgain = await j("POST", `/orders/${OID}/settle`, {
    paymentMethod: "CASH",
    amountPaidMinor: 47000,
  });
  const crm = cust?.phone
    ? await j("GET", `/crm/customers?search=${encodeURIComponent(cust.phone)}&limit=5`)
    : { status: 0 };
  const outlet = await prisma.outlet.findUnique({
    where: { id: OUTLET },
    select: { loyaltyPaisePerPoint: true, name: true },
  });
  const outletSettings = await j("GET", "/settings/outlet");
  const ingIds = [...new Set(logs.map((l) => l.ingredientId))];
  const ings = ingIds.length
    ? await prisma.ingredients.findMany({ where: { id: { in: ingIds } } })
    : [];
  const invList = Array.isArray(invoices.data)
    ? invoices.data
    : (invoices.data && invoices.data.invoices) || [];
  const invHit = invList.find(
    (i) =>
      i.orderId === OID ||
      i.orderNumber === "20260831-0019" ||
      (invoice && i.invoiceNumber === invoice.invoiceNumber)
  );

  console.log(
    JSON.stringify(
      {
        order: order && {
          id: order.id,
          status: order.status,
          settledAt: order.settledAt,
          customerId: order.customerId,
          grand: String(order.grandTotal),
          tax: String(order.taxTotal || 0),
          items: order.orderItems.map((i) => ({ name: i.item_name, qty: Number(i.quantity) })),
          payments: payments.map((p) => ({ method: p.method, amount: String(p.amount), status: p.status })),
        },
        kots: kots.map((k) => ({
          status: k.status,
          n: k.kotItems.length,
          ids: k.kotItems.map((i) => i.orderItemId),
        })),
        consumption: logs.map((l) => ({
          ingredientId: l.ingredientId,
          qty: String(l.quantityDeducted),
          remaining: l.remainingStock != null ? String(l.remainingStock) : null,
          reason: l.reasonCode,
        })),
        invoice: invoice && {
          number: invoice.invoiceNumber,
          amount: String(invoice.amountMinor),
          tax: String(invoice.taxAmountMinor),
        },
        cust: cust && { phone: cust.phone, points: cust.loyaltyPoints },
        acct: acct && String(acct.balance),
        drawer: {
          http: drawer.status,
          sessionStatus: drawer.data && drawer.data.sessionStatus,
          expected: drawer.data && drawer.data.expectedCashMinor,
          cashSales: drawer.data && drawer.data.cashSalesMinor,
          cashTxCount: drawer.data && drawer.data.cashTxCount,
        },
        bill: bill.data,
        sales: {
          http: sales.status,
          net: sales.data && sales.data.netSalesMinor,
          orders: sales.data && sales.data.orderCount,
        },
        tax: { http: tax.status, collected: tax.data && tax.data.totalTaxCollectedMinor },
        leakage: {
          http: leakage.status,
          unbilled: leakage.data && leakage.data.kotsNotBilledCount,
          reprints: leakage.data && leakage.data.totalReprints,
        },
        invoices: { http: invoices.status, hit: invHit || null, count: invList.length },
        occupancy: { http: occupancy.status, data: occupancy.data },
        tta: { http: tta.status, data: tta.data },
        t09: t09 && {
          status: t09.status,
          kitchenStage: t09.kitchenStage,
          activeOrderId: t09.activeOrderId,
        },
        reSettle: { http: settleAgain.status, error: settleAgain.data && settleAgain.data.error },
        crmHit:
          crm.data && Array.isArray(crm.data.customers)
            ? crm.data.customers.find((c) => c.phone === (cust && cust.phone))
            : crm.data,
        outlet: {
          loyalty: outlet && outlet.loyaltyPaisePerPoint != null ? String(outlet.loyaltyPaisePerPoint) : null,
          settingsHttp: outletSettings.status,
          gstin: outletSettings.data && (outletSettings.data.gstin || outletSettings.data.gstIn || outletSettings.data.GSTIN),
        },
        ingredients: ings.map((i) => ({
          id: i.id,
          name: i.name,
          remaining: String(i.current_stock_qty),
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
