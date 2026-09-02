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
  const login = await lr.json();
  const TOK = login.accessToken;
  if (!TOK) {
    console.log(JSON.stringify({ loginError: login, status: lr.status }));
    return;
  }
  const H = { Authorization: `Bearer ${TOK}`, "X-Outlet-Id": OUTLET };
  const j = async (p) => {
    const r = await fetch(BASE + p, { headers: H });
    return { status: r.status, body: await r.json() };
  };

  const z0901 = await j("/finance/z-report?date=2026-09-01");
  const z0831 = await j("/finance/z-report?date=2026-08-31");
  const drawer0901 = await j("/finance/cash-drawer?date=2026-09-01");
  const drawer0831 = await j("/finance/cash-drawer?date=2026-08-31");
  const live = await j("/orders/live");
  const liveList = Array.isArray(live.body) ? live.body : live.body.orders || [];
  const from = "2026-08-31T00:00:00.000Z";
  const to = "2026-09-01T23:59:59.999Z";
  const invoices = await j(`/reporting/invoices?limit=20&fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`);
  const invList = Array.isArray(invoices.body) ? invoices.body : invoices.body.invoices || [];
  const salesDay = await j(
    `/reporting/sales-summary?fromDate=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&toDate=${encodeURIComponent(new Date().toISOString())}`
  );

  console.log(
    JSON.stringify(
      {
        now: new Date().toISOString(),
        tzOffsetMin: new Date().getTimezoneOffset(),
        z0901: {
          status: z0901.status,
          date: z0901.body.date,
          businessDayStart: z0901.body.businessDayStart,
          businessDayEnd: z0901.body.businessDayEnd,
          invoiceCount: z0901.body.invoiceCount,
          grandTotal: z0901.body.grandTotal,
          totalTips: z0901.body.totalTips,
          paymentModes: z0901.body.paymentModes,
        },
        z0831: {
          status: z0831.status,
          date: z0831.body.date,
          businessDayStart: z0831.body.businessDayStart,
          businessDayEnd: z0831.body.businessDayEnd,
          invoiceCount: z0831.body.invoiceCount,
          grandTotal: z0831.body.grandTotal,
          totalTips: z0831.body.totalTips,
          paymentModes: z0831.body.paymentModes,
        },
        drawer0901: {
          date: drawer0901.body.date,
          cashSales: drawer0901.body.cashSalesMinor,
          petty: drawer0901.body.pettyCashTotalMinor,
          expected: drawer0901.body.expectedCashMinor,
          cashTxCount: drawer0901.body.cashTxCount,
        },
        drawer0831: {
          date: drawer0831.body.date,
          cashSales: drawer0831.body.cashSalesMinor,
          petty: drawer0831.body.pettyCashTotalMinor,
          expected: drawer0831.body.expectedCashMinor,
          cashTxCount: drawer0831.body.cashTxCount,
        },
        liveCount: liveList.length,
        liveSample: liveList.slice(0, 8).map((o) => ({
          n: o.orderNumber,
          type: o.orderType,
          status: o.status,
          createdAt: o.createdAt,
        })),
        recentInvoices: invList.slice(0, 8).map((i) => ({
          n: i.invoiceNumber,
          grand: i.grandTotalMinor,
          settledAt: i.settledAt || i.createdAt,
          method: i.paymentMethod,
        })),
        salesDay: {
          orderCount: salesDay.body.orderCount,
          net: salesDay.body.netSalesMinor,
          from: salesDay.body.fromDate,
          to: salesDay.body.toDate,
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
