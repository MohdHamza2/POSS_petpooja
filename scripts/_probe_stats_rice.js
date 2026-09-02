const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const RICE = "434437c3-4607-4b7b-9384-54f0ee1c1acd";

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const TOK = (await lr.json()).accessToken;
  const H = { Authorization: `Bearer ${TOK}`, "X-Outlet-Id": OUTLET };
  const j = async (p) => (await fetch(BASE + p, { headers: H })).json();
  const z = await j("/finance/z-report");
  const stats = await j("/waiters/me/stats");
  const inv = await j("/inventory/ingredients");
  const list = Array.isArray(inv) ? inv : inv.items || inv.skus || [];
  const rice = list.find((x) => x.id === RICE || x.skuId === RICE || x.ingredientId === RICE);
  const riceRow = rice || list.filter((x) => String(x.name || x.skuName || "").toLowerCase().includes("rice")).slice(0, 3);
  console.log(JSON.stringify({
    zNoDate: { date: z.date, invoices: z.invoiceCount, sales: z.totalSales, tax: z.totalTax, grand: z.grandTotal, tips: z.totalTips, start: z.businessDayStart },
    waiterStats: stats,
    rice: riceRow,
    invKeys: list[0] ? Object.keys(list[0]) : [],
    invCount: list.length,
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
