const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const STUCK = "2bc8c922-6aa5-4137-b155-e4c74a286792";

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const { accessToken } = await lr.json();
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };

  const settle = await fetch(`${BASE}/orders/${STUCK}/settle`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ paymentMethod: "CASH", amountPaidMinor: 32000 }),
  });
  const settleJson = await settle.json();
  console.log("stuckSettle", settle.status, {
    invoice: settleJson.invoiceNumber,
    status: settleJson.status,
    error: settleJson.error,
    diningTableId: settleJson.diningTableId,
  });

  const ext = `LIVE${Date.now()}`;
  const wh = await fetch(`${BASE}/webhooks/swiggy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: "SWIGGY",
      outletId: OUTLET,
      externalOrderId: ext,
      externalEventId: `evt-${ext}`,
      customer: { name: "Swiggy Cover Guest", phone: "9876501234" },
      items: [{ name: "Chicken Dum Biryani (Special)", quantity: 1, priceMinor: 32000 }],
    }),
  });
  const wj = await wh.json();
  console.log("newWebhook", wh.status, {
    orderId: wj.orderId,
    orderNumber: wj.orderNumber,
    status: wj.status,
  });

  const live = await (await fetch(`${BASE}/orders/live?kind=online`, { headers: H })).json();
  const arr = Array.isArray(live) ? live : [];
  console.log(
    "onlineLive",
    arr.map((o) => ({
      n: o.orderNumber,
      s: o.status,
      channel: o.channel,
      cust: o.customerName,
      table: o.table_number,
      dining: o.diningTableId,
    }))
  );
  const occ = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();
  console.log("occ", occ.occupiedTables, occ.occupancyRatePercent);
  const kots = await (await fetch(`${BASE}/kitchen/kot`, { headers: H })).json();
  const karr = Array.isArray(kots) ? kots : [];
  console.log(
    "kots",
    karr
      .filter((k) => k.orderId === wj.orderId)
      .map((k) => ({ id: k.id, n: k.ticketNumber, s: k.status, table: k.tableNumber }))
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
