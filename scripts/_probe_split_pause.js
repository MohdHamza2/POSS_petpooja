require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const BIRYANI = "923df5bf-7d93-4061-926e-8a5c2c41d7d0";

async function login() {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@restaurant.com",
      password: "admin123",
      outletId: OUTLET,
    }),
  });
  const body = await lr.json();
  if (!body.accessToken) throw new Error("login failed " + JSON.stringify(body));
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${body.accessToken}`,
    "X-Outlet-Id": OUTLET,
  };
}

async function call(H, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    data = txt;
  }
  return { status: res.status, data };
}

async function serveKots(H, table) {
  const kots = (table && table.currentOrder && table.currentOrder.kots) || [];
  const results = [];
  for (const k of kots) {
    for (const toStatus of ["PREPARING", "READY", "SERVED"]) {
      const r = await call(H, "PATCH", `/kitchen/kot/${k.id}/status`, { toStatus });
      results.push({ id: k.id, toStatus, status: r.status, err: r.data && r.data.error });
    }
  }
  return results;
}

(async () => {
  const H = await login();
  const leftover = await prisma.order.findFirst({
    where: { orderNumber: "20260831-0008" },
    include: { diningTable: true, kotTickets: true, invoices: true },
  });
  const leftoverTables = leftover
    ? await prisma.diningTable.findMany({
        where: {
          OR: [
            { id: leftover.diningTableId || "" },
            { mergeGroupId: leftover.diningTable?.mergeGroupId || "" },
          ].filter((c) => Object.values(c)[0]),
        },
      })
    : [];

  const storeBefore = await call(H, "GET", "/settings/store-status");
  const pauseOff = await call(H, "PATCH", "/settings/store-status", { isOnline: false });
  const hookPaused = await fetch(`${BASE}/webhooks/swiggy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      outletId: OUTLET,
      externalOrderId: `PAUSE-TEST-${Date.now()}`,
      items: [{ name: "Chicken Dum Biryani", quantity: 1, priceMinor: 32000 }],
    }),
  });
  const hookPausedBody = await hookPaused.json().catch(() => ({}));
  const pauseOn = await call(H, "PATCH", "/settings/store-status", { isOnline: true });

  const tables = (await call(H, "GET", "/tables")).data;
  const t09 = Array.isArray(tables) ? tables.find((x) => x.tableNumber === "T-09") : null;
  const create = await call(H, "POST", "/orders", {
    action: "KOT",
    orderType: "DINE_IN",
    tableNumber: "T-09",
    diningTableId: t09 && t09.id,
    covers: 2,
    lines: [{ menuItemId: BIRYANI, quantity: 1 }],
  });
  const orderId = create.data && create.data.id;
  const tablesAfterKot = (await call(H, "GET", "/tables")).data;
  const t09Kot = Array.isArray(tablesAfterKot)
    ? tablesAfterKot.find((x) => x.tableNumber === "T-09")
    : null;
  const serve = await serveKots(H, t09Kot);
  const grand = Number(
    (create.data && (create.data.grandTotalMinor || create.data.grandTotal)) || 0
  );
  const base = Math.floor(grand / 2);
  const settle = await call(H, "POST", `/orders/${orderId}/settle`, {
    payments: [
      { method: "CASH", amountMinor: base },
      { method: "CASH", amountMinor: grand - base },
    ],
  });
  const payments = orderId
    ? await prisma.payment.findMany({ where: { orderId } })
    : [];
  const invoices = orderId
    ? await prisma.invoice.findMany({ where: { orderId } })
    : [];
  const order = orderId
    ? await prisma.order.findUnique({
        where: { id: orderId },
        include: { kotTickets: true },
      })
    : null;
  const consumption = orderId
    ? await prisma.inventoryConsumptionLog.findMany({ where: { orderId } })
    : [];
  const reporting = await call(H, "GET", "/reporting/invoices?limit=8");
  const occupancy = await call(H, "GET", "/tables/occupancy");
  const drawer = await call(H, "GET", "/finance/cash-drawer");
    const biryaniAvail = await prisma.item_availability.findMany({
      where: { item_id: BIRYANI },
    });

  console.log(
    JSON.stringify(
      {
        leftover: leftover && {
          id: leftover.id,
          status: leftover.status,
          settledAt: leftover.settledAt,
          table: leftover.diningTable && leftover.diningTable.tableNumber,
          tableStatus: leftover.diningTable && leftover.diningTable.status,
          invoices: leftover.invoices.length,
          kots: leftover.kotTickets.map((k) => k.status),
          mergedTables: leftoverTables.map((t) => ({
            n: t.tableNumber,
            status: t.status,
            merge: t.mergeGroupId,
          })),
        },
        pause: {
          before: storeBefore.data,
          pausedPatch: pauseOff.status,
          webhookWhilePaused: { status: hookPaused.status, body: hookPausedBody },
          restored: pauseOn.status,
          restoredBody: pauseOn.data,
        },
        split: {
          createStatus: create.status,
          orderId,
          orderNumber: order && order.orderNumber,
          orderStatus: order && order.status,
          settledAt: order && order.settledAt,
          grand,
          serve,
          settleStatus: settle.status,
          settleBody: settle.data,
          paymentCount: payments.length,
          paymentAmounts: payments.map((p) => String(p.amount)),
          invoiceCount: invoices.length,
          invoiceNumbers: invoices.map((i) => i.invoiceNumber),
          invoiceAmounts: invoices.map((i) => String(i.amountMinor)),
          kotStatuses: order ? order.kotTickets.map((k) => k.status) : [],
          bomRows: consumption.length,
        },
        reportingSample: Array.isArray(reporting.data)
          ? reporting.data.slice(0, 4).map((r) => ({
              id: r.id,
              invoiceNumber: r.invoiceNumber,
              orderNumber: r.orderNumber,
              paymentMethod: r.paymentMethod,
              grand: r.grandTotalMinor,
            }))
          : reporting,
        occupancy: occupancy.data,
        drawerExpected: drawer.data && drawer.data.expectedCloseBalanceMinor,
        biryaniAvail: biryaniAvail.map((a) => ({
          id: a.id,
          isStocked: a.is_stocked,
          channel: a.channel,
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
