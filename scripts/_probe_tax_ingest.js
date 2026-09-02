require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const prisma = new PrismaClient();

(async () => {
  const lr = await fetch(`${BASE}/health`);
  const health = await lr.text();

  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@restaurant.com",
      password: "admin123",
      outletId: OUTLET,
    }),
  });
  const loginBody = await login.json();
  const TOK = loginBody.accessToken;
  if (!TOK) {
    console.log(JSON.stringify({ health, loginHttp: login.status, loginBody }));
    process.exit(1);
  }
  const H = { Authorization: `Bearer ${TOK}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };
  const from = "2026-08-31T00:00:00.000Z";
  const to = "2026-08-31T23:59:59.999Z";
  const qs = `fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`;
  const j = async (p) => (await fetch(BASE + p, { headers: H })).json();

  const before = {
    sales: await j(`/reporting/sales-summary?${qs}`),
    pay: await j(`/reporting/payment-breakdown?${qs}`),
    channel: await j(`/reporting/channel-breakdown?${qs}`),
  };

  const extId = `tax-fix-${Date.now()}`;
  const ingest = await fetch(`${BASE}/webhooks/swiggy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      outletId: OUTLET,
      externalOrderId: extId,
      items: [{ name: "Chicken Dum Biryani (Special)", quantity: 1, priceMinor: 32000 }],
    }),
  });
  const ingestBody = await ingest.json();

  const created = ingestBody.orderId
    ? await prisma.order.findUnique({
        where: { id: ingestBody.orderId },
        select: { id: true, orderNumber: true, subtotal: true, taxTotal: true, grandTotal: true, status: true },
      })
    : null;

  let cancel = null;
  if (ingestBody.orderId) {
    const cr = await fetch(`${BASE}/orders/${ingestBody.orderId}/cancel`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ reasonCode: "TEST_TAX_INGEST" }),
    });
    cancel = { http: cr.status, body: await cr.json().catch(() => ({})) };
  }

  const mismatched = await prisma.order.findMany({
    where: {
      outletId: OUTLET,
      status: "COMPLETED",
      grandTotal: 33600n,
    },
    select: { id: true, orderNumber: true, subtotal: true, taxTotal: true, grandTotal: true },
  });

  const corrected = [];
  for (const row of mismatched) {
    await prisma.order.update({
      where: { id: row.id },
      data: { grandTotal: 32000n, subtotal: 32000n, taxTotal: 1524n },
    });
    await prisma.invoice.updateMany({
      where: { orderId: row.id, amountMinor: 32000n },
      data: { taxAmountMinor: 1524n },
    });
    corrected.push(row.id);
  }

  const biryani = await prisma.menuItem.findFirst({
    where: { outletId: OUTLET, name: { contains: "Chicken Dum Biryani" } },
    select: { id: true, name: true },
  });
  let recipeCleanup = null;
  if (biryani) {
    const active = await prisma.recipes.findMany({
      where: { outlet_id: OUTLET, menu_item_id: biryani.id, is_active: true },
      orderBy: [{ version: "desc" }, { created_at: "desc" }],
      select: { id: true, version: true },
    });
    const keep = active[0];
    let deactivated = 0;
    if (keep && active.length > 1) {
      const extra = await prisma.recipes.updateMany({
        where: {
          outlet_id: OUTLET,
          menu_item_id: biryani.id,
          is_active: true,
          id: { not: keep.id },
        },
        data: { is_active: false, updated_at: new Date() },
      });
      deactivated = extra.count;
    }
    recipeCleanup = { menuItemId: biryani.id, activeBefore: active.length, kept: keep?.id || null, deactivated };
  }

  const after = {
    sales: await j(`/reporting/sales-summary?${qs}`),
    pay: await j(`/reporting/payment-breakdown?${qs}`),
    channel: await j(`/reporting/channel-breakdown?${qs}`),
  };
  const invoices = await j(`/reporting/invoices?limit=500&${qs}`);
  const list = Array.isArray(invoices) ? invoices : invoices.invoices || [];
  const invTotal = list.reduce((s, i) => s + Number(i.grandTotalMinor || i.amountMinor || 0), 0);
  const outlet = await j("/settings/outlet");

  console.log(
    JSON.stringify(
      {
        health,
        ingestHttp: ingest.status,
        ingestBody,
        createdOrder: created
          ? {
              ...created,
              subtotal: created.subtotal.toString(),
              taxTotal: created.taxTotal.toString(),
              grandTotal: created.grandTotal.toString(),
            }
          : null,
        cancel,
        mismatchedBefore: mismatched.map((r) => ({
          id: r.id,
          orderNumber: r.orderNumber,
          grand: r.grandTotal.toString(),
          tax: r.taxTotal.toString(),
        })),
        corrected,
        recipeCleanup,
        before: {
          salesNet: before.sales.netSalesMinor,
          salesOrders: before.sales.orderCount,
          payTotal: before.pay.totalAmountMinor,
          delta: Number(before.pay.totalAmountMinor) - Number(before.sales.netSalesMinor),
        },
        after: {
          salesNet: after.sales.netSalesMinor,
          salesOrders: after.sales.orderCount,
          payTotal: after.pay.totalAmountMinor,
          delta: Number(after.pay.totalAmountMinor) - Number(after.sales.netSalesMinor),
          channels: after.channel,
        },
        invoiceGrandSum: invTotal,
        invoiceCount: list.length,
        gstin: outlet.taxNumber || null,
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
