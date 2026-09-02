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
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };
  const pos = await (await fetch(`${BASE}/inventory/purchase-orders`, { headers: H })).json();
  const remaining = pos
    .map((p) => ({
      id: p.id,
      number: p.poNumber,
      status: p.status,
      vendor: p.vendorName,
      items: (p.items || []).map((i) => ({
        ingredientId: i.ingredientId,
        name: i.ingredientName,
        qty: i.quantity,
        received: i.receivedQty,
        remaining: Number(i.quantity) - Number(i.receivedQty || 0),
      })),
    }))
    .filter((p) => p.items.some((i) => i.remaining > 0));
  const occ = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();
  const kots = await (await fetch(`${BASE}/kitchen/kot`, { headers: H })).json();
  const live = Array.isArray(kots) ? kots.filter((k) => k.status !== "SERVED") : [];
  console.log(
    JSON.stringify(
      {
        occ: { occupied: occ.occupiedTables, rate: occ.occupancyRatePercent },
        liveKots: live.map((k) => ({
          id: k.id,
          num: k.ticketNumber,
          status: k.status,
          table: k.tableNumber || k.order?.table_number,
          orderId: k.orderId,
        })),
        remainingPos: remaining.slice(0, 8),
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
