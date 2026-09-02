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
  const tables = await (await fetch(`${BASE}/tables`, { headers: H })).json();
  const want = new Set(["M2_6359", "M2_6609", "M2_8391", "T-09"]);
  const rows = tables
    .filter((t) => want.has(t.tableNumber))
    .map((t) => ({
      n: t.tableNumber,
      status: t.status,
      mergeGroupId: t.mergeGroupId,
      mergePrimary: t.mergePrimaryTableId,
      mergedWith: t.mergedWith,
      kitchenStage: t.kitchenStage,
      currentOrderId: t.currentOrder && t.currentOrder.id,
      orderStatus: t.currentOrder && t.currentOrder.status,
      grand: t.currentOrder && t.currentOrder.grandTotalPaise,
      createdAt: t.currentOrder && t.currentOrder.createdAt,
    }));
  console.log(JSON.stringify(rows, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
