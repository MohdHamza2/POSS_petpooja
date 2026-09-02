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

  const live = await j("GET", "/orders?status=CONFIRMED,PREPARING,READY,SERVED&limit=50");
  const kitchen = await j("GET", "/kitchen/tickets");
  const occ = await j("GET", "/tables/occupancy");
  const tables = await j("GET", "/tables");
  const orders = Array.isArray(live.data) ? live.data : (live.data && live.data.orders) || [];
  const hit = orders.find((o) => o.orderNumber === "20260831-0028" || (o.items || []).some((i) => String(i.itemName || "").includes("Mango")));
  const tickets = Array.isArray(kitchen.data) ? kitchen.data : (kitchen.data && kitchen.data.tickets) || [];
  const t09 = (Array.isArray(tables.data) ? tables.data : []).find((t) => t.tableNumber === "T-09");
  const addTickets = tickets.filter(
    (k) =>
      k.kotNumber === "KOT-1788190448217-454" ||
      k.kotNumber === "KOT-1788190499378-400" ||
      (k.tableNumber === "T-09" && k.status !== "SERVED")
  );

  const itemIds = addTickets.flatMap((k) =>
    (k.items || k.kotItems || []).map((i) => i.orderItemId || i.order_item_id)
  );
  const unique = new Set(itemIds.filter(Boolean));

  console.log(
    JSON.stringify(
      {
        liveHttp: live.status,
        order: hit && {
          id: hit.id,
          number: hit.orderNumber,
          status: hit.status,
          table: hit.tableNumber,
          total: hit.grandTotal || hit.totalAmount,
          items: (hit.items || hit.orderItems || []).map((i) => ({
            id: i.id,
            name: i.itemName || i.name,
            qty: i.quantity,
          })),
        },
        occupancy: occ.data,
        t09: t09 && { status: t09.status, kitchenStage: t09.kitchenStage, activeOrderId: t09.activeOrderId },
        addTickets: addTickets.map((k) => ({
          kot: k.kotNumber || k.ticketNumber,
          status: k.status,
          table: k.tableNumber,
          items: (k.items || k.kotItems || []).map((i) => ({
            orderItemId: i.orderItemId || i.order_item_id,
            name: i.itemName || i.name,
            qty: i.quantity,
          })),
        })),
        uniqueKotItemIds: unique.size === itemIds.filter(Boolean).length,
        leftoverQueued: tickets
          .filter((k) => k.status !== "SERVED" && k.status !== "CANCELLED")
          .map((k) => ({ kot: k.kotNumber, status: k.status, type: k.orderType, table: k.tableNumber })),
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
