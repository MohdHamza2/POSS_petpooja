const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const LASSI = "1a6095ee-3543-4dcd-9962-dee4cc33536b";

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const { accessToken } = await lr.json();
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };
  const j = async (p, init) => {
    const r = await fetch(BASE + p, { headers: H, ...init });
    const t = await r.text();
    let b;
    try {
      b = JSON.parse(t);
    } catch {
      b = t;
    }
    return { status: r.status, b };
  };

  const before = await j("/settings/store-status");
  const pauseDel = await j("/settings/store-status", {
    method: "PATCH",
    body: JSON.stringify({ deliveryActive: false }),
  });
  const pickup = await j("/orders", {
    method: "POST",
    body: JSON.stringify({
      action: "HOLD",
      orderType: "PICKUP",
      lines: [{ menuItemId: LASSI, quantity: 1 }],
    }),
  });
  const delivery = await j("/orders", {
    method: "POST",
    body: JSON.stringify({
      orderType: "DELIVERY",
      lines: [{ menuItemId: LASSI, quantity: 1 }],
    }),
  });
  const ext = `PAUSE${Date.now()}`;
  const wh = await fetch(`${BASE}/webhooks/swiggy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: "SWIGGY",
      outletId: OUTLET,
      externalOrderId: ext,
      externalEventId: `evt-${ext}`,
      customer: { name: "Pause Probe", phone: "9876509999" },
      items: [{ name: "Mango Lassi", quantity: 1, priceMinor: 9000 }],
    }),
  });
  const whb = await wh.json();
  const occ = await j("/tables/occupancy");
  const resume = await j("/settings/store-status", {
    method: "PATCH",
    body: JSON.stringify({ deliveryActive: true }),
  });
  const after = await j("/settings/store-status");
  const pos = await j("/inventory/purchase-orders");
  const poList = Array.isArray(pos.b) ? pos.b : pos.b.orders || pos.b.items || [];
  const z = await j("/finance/z-report");
  const zd = z.b.data || z.b;
  const stats = await j("/waiters/me/stats");
  const recon = await j("/waiters/me/shift-reconciliation");
  const drawer = await j("/finance/cash-drawer");
  const leak = await j("/reporting/leakage-report?fromDate=2026-09-01T00:00:00.000Z&toDate=2026-09-01T23:59:59.000Z");
  const sales = await j("/reporting/sales-summary?fromDate=2026-08-31T23:30:00.000Z&toDate=2026-09-01T23:59:59.000Z");
  const rice = await j("/inventory/ingredients");
  const list = Array.isArray(rice.b) ? rice.b : rice.b.items || rice.b.data || [];
  const riceRow = list.find((x) => x.id === "434437c3-4607-4b7b-9384-54f0ee1c1acd");

  console.log(
    JSON.stringify(
      {
        before: before.b,
        pauseDel: { status: pauseDel.status, deliveryActive: pauseDel.b.deliveryActive, pickupActive: pauseDel.b.pickupActive },
        pickupHold: { status: pickup.status, id: pickup.b.id || pickup.b.orderId, table: pickup.b.diningTableId, err: pickup.b.error },
        deliveryBlocked: { status: delivery.status, error: delivery.b.error, code: delivery.b.code },
        webhookBlocked: { status: wh.status, error: whb.error, code: whb.code },
        occupied: occ.b.occupiedTables,
        after: after.b,
        poStatuses: poList.slice(0, 8).map((p) => ({ n: p.poNumber || p.po_number, s: p.status })),
        z: { invoices: zd.invoiceCount || z.b.invoiceCount, grand: zd.grandTotal || z.b.grandTotal, tax: zd.totalTax || z.b.totalTax, sales: zd.totalSales || z.b.totalSales },
        stats: stats.b,
        reconCash: recon.b.cashSalesMinor,
        drawerCash: drawer.b.cashSalesMinor,
        leak: { kots: leak.b.kotsNotBilledCount, atRisk: leak.b.estimatedRevenueAtRiskMinor },
        sales: { count: sales.b.orderCount, net: sales.b.netSalesMinor },
        rice: riceRow && (riceRow.currentStock ?? riceRow.current_stock_qty),
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
