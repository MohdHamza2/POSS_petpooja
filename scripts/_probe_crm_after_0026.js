require("dotenv").config();
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
  const crm = await (await fetch(`${BASE}/crm/customers?search=Chrome&limit=10`, { headers: H })).json();
  const drawer = await (await fetch(`${BASE}/finance/cash-drawer`, { headers: H })).json();
  const occ = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();
  const ings = await (await fetch(`${BASE}/inventory/ingredients`, { headers: H })).json();
  const rice = (Array.isArray(ings) ? ings : ings.ingredients || []).find(
    (i) => i.id === "434437c3-4607-4b7b-9384-54f0ee1c1acd" || (i.name && String(i.name).includes("1787988542078"))
  );
  const chrome = (crm.customers || crm || []).find
    ? (Array.isArray(crm.customers) ? crm.customers : crm).find((c) => c.firstName === "Chrome")
    : null;
  console.log(
    JSON.stringify(
      {
        chrome: chrome && { id: chrome.id, points: chrome.loyaltyPoints, name: `${chrome.firstName} ${chrome.lastName}` },
        drawerExpected: drawer.expectedCashMinor,
        cashSales: drawer.cashSalesMinor,
        occ: { occupied: occ.occupiedTables, total: occ.totalTables, rate: occ.occupancyRatePercent },
        rice: rice && { id: rice.id, name: rice.name, stock: rice.currentStock ?? rice.current_stock_qty },
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
