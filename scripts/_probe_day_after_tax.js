const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const { accessToken } = await lr.json();
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET };
  const from = "2026-08-31T00:00:00.000Z";
  const to = "2026-08-31T23:59:59.999Z";
  const qs = `fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`;
  const j = async (p) => {
    const r = await fetch(BASE + p, { headers: H });
    return { http: r.status, body: await r.json() };
  };
  const sales = await j(`/reporting/sales-summary?${qs}`);
  const pay = await j(`/reporting/payment-breakdown?${qs}`);
  const leak = await j(`/reporting/leakage-report?${qs}`);
  const crm = await j(`/crm/customers/63410ab6-d30a-44d8-932e-ba95cac5e060`);
  const outlet = await j(`/settings/outlet`);
  console.log(
    JSON.stringify(
      {
        sales: { net: sales.body.netSalesMinor, orders: sales.body.orderCount },
        pay: pay.body.totalAmountMinor,
        leak: {
          unbilled: leak.body.kotsNotBilledCount ?? leak.body.unbilledKotCount,
          atRisk: leak.body.estimatedRevenueAtRiskMinor,
          rawKeys: Object.keys(leak.body || {}),
        },
        chromeCover: crm.body,
        gstin: outlet.body.taxNumber,
        loyaltyPaise: outlet.body.loyaltyPaisePerPoint,
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
