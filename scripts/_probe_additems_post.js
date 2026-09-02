const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const OID = "0dcdef53-9034-4e6e-bab1-98cab5b1f0b5";
const RICE = "434437c3-4607-4b7b-9384-54f0ee1c1acd";

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

  const from = "2026-08-31T00:00:00.000Z";
  const to = "2026-08-31T23:59:59.999Z";
  const qs = `fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`;

  const order = await j("GET", `/orders/${OID}`);
  const bill = await j("GET", `/orders/${OID}/bill`);
  const kot = await j("GET", "/kitchen/kot");
  const occ = await j("GET", "/tables/occupancy");
  const tables = await j("GET", "/tables");
  const drawer = await j("GET", "/finance/cash-drawer");
  const sales = await j("GET", `/reporting/sales-summary?${qs}`);
  const tax = await j("GET", `/reporting/tax-breakdown?${qs}`);
  const leakage = await j("GET", `/reporting/leakage-report?${qs}`);
  const invoices = await j("GET", `/reporting/invoices?limit=100&${qs}`);
  const tta = await j("GET", `/reporting/table-turnaround?${qs}`);
  const ings = await j("GET", "/inventory/ingredients");
  const settleAgain = await j("POST", `/orders/${OID}/settle`, {
    paymentMethod: "CASH",
    amountPaidMinor: 41000,
  });

  const o = order.data || {};
  const items = o.items || o.orderItems || [];
  const tickets = Array.isArray(kot.data) ? kot.data : [];
  const orderKots = tickets.filter((k) => k.orderId === OID);
  const allKotItems = orderKots.flatMap((k) =>
    (k.items || k.kotItems || []).map((i) => ({
      kot: k.ticketNumber,
      status: k.status,
      orderItemId: i.orderItemId || i.order_item_id,
      name: i.itemName || i.name || (i.menuItem && i.menuItem.name),
      qty: i.quantity,
    }))
  );
  const ids = allKotItems.map((i) => i.orderItemId).filter(Boolean);
  const t09 = (Array.isArray(tables.data) ? tables.data : []).find(
    (t) => t.tableNumber === "T-09"
  );
  const ingList = Array.isArray(ings.data)
    ? ings.data
    : ings.data.ingredients || [];
  const rice = ingList.find((i) => i.id === RICE);
  const invList = Array.isArray(invoices.data)
    ? invoices.data
    : (invoices.data && invoices.data.invoices) || [];
  const invHit = invList.find(
    (i) => i.orderId === OID || i.invoiceNumber === "INV-2026-00042"
  );

  console.log(
    JSON.stringify(
      {
        order: {
          http: order.status,
          id: o.id,
          number: o.orderNumber,
          status: o.status,
          settledAt: o.settledAt,
          customerId: o.customerId,
          guestName: o.guestName || o.customerName,
          grand: o.grandTotal || o.totalAmount,
          tax: o.taxTotal,
          items: items.map((i) => ({
            id: i.id,
            name: i.itemName || i.name,
            qty: i.quantity,
          })),
        },
        bill: { http: bill.status, data: bill.data },
        kots: {
          unique: ids.length === new Set(ids).size,
          tickets: orderKots.map((k) => ({
            n: k.ticketNumber,
            status: k.status,
            items: (k.items || k.kotItems || []).map((i) => ({
              orderItemId: i.orderItemId || i.order_item_id,
              name: i.itemName || i.name,
            })),
          })),
          leftoverOpen: tickets
            .filter((k) => ["QUEUED", "PREPARING", "READY"].includes(k.status))
            .map((k) => ({
              n: k.ticketNumber,
              status: k.status,
              type: k.orderType,
              table: k.tableNumber,
              orderId: k.orderId,
            })),
        },
        occupancy: occ.data,
        t09: t09 && {
          status: t09.status,
          kitchenStage: t09.kitchenStage,
          activeOrderId: t09.activeOrderId,
        },
        drawer: {
          http: drawer.status,
          expected: drawer.data && drawer.data.expectedCashMinor,
          cashSales: drawer.data && drawer.data.cashSalesMinor,
        },
        sales: {
          http: sales.status,
          net: sales.data && sales.data.netSalesMinor,
          orders: sales.data && sales.data.orderCount,
        },
        tax: { http: tax.status, data: tax.data },
        leakage: {
          http: leakage.status,
          unbilled: leakage.data && leakage.data.kotsNotBilledCount,
          kotsNotBilled: leakage.data && leakage.data.kotsNotBilled,
          totalUnbilledMinor: leakage.data && leakage.data.totalUnbilledMinor,
        },
        invoice: invHit || null,
        invoiceCount: invList.length,
        tta: tta.data,
        rice: rice && {
          id: rice.id,
          name: rice.name,
          qty:
            rice.currentStockQty ??
            rice.current_stock_qty ??
            rice.remainingQty ??
            rice.quantity,
          keys: Object.keys(rice).slice(0, 20),
        },
        reSettle: {
          http: settleAgain.status,
          error: settleAgain.data && settleAgain.data.error,
        },
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
