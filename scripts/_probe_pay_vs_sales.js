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
  const TOK = (await lr.json()).accessToken;
  const H = { Authorization: `Bearer ${TOK}`, "X-Outlet-Id": OUTLET };
  const from = "2026-08-31T00:00:00.000Z";
  const to = "2026-08-31T23:59:59.999Z";
  const qs = `fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`;
  const j = async (p) => (await fetch(BASE + p, { headers: H })).json();

  const pay = await j(`/reporting/payment-breakdown?${qs}`);
  const sales = await j(`/reporting/sales-summary?${qs}`);
  const invoices = await j(`/reporting/invoices?limit=100&${qs}`);
  const list = Array.isArray(invoices) ? invoices : invoices.invoices || [];
  const invTotal = list.reduce((s, i) => s + Number(i.grandTotalMinor || 0), 0);
  const cashInv = list.filter((i) => i.paymentMethod === "CASH");
  const cashInvTotal = cashInv.reduce((s, i) => s + Number(i.grandTotalMinor || 0), 0);

  console.log(
    JSON.stringify(
      {
        salesNet: sales.netSalesMinor,
        salesOrders: sales.orderCount,
        payTotal: pay.totalAmountMinor,
        payMethods: pay.methods,
        invoiceCount: list.length,
        invoiceGrandSum: invTotal,
        cashInvoiceCount: cashInv.length,
        cashInvoiceSum: cashInvTotal,
        deltaPayMinusSales: Number(pay.totalAmountMinor) - Number(sales.netSalesMinor),
      },
      null,
      2
    )
  );
})();
