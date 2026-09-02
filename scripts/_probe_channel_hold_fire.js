const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const LASSI = "1a6095ee-3543-4dcd-9962-dee4cc33536b";

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const { accessToken } = await lr.json();
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };
  const j = async (p, init) => {
    const r = await fetch(BASE + p, { headers: H, ...init });
    const t = await r.text();
    let b;
    try {
      b = JSON.parse(t);
    } catch {
      b = t;
    }
    return { status: r.status, b };
  };

  await j("/settings/store-status", { method: "PATCH", body: JSON.stringify({ deliveryActive: false }) });
  const holdDelivery = await j("/orders", {
    method: "POST",
    body: JSON.stringify({
      action: "HOLD",
      orderType: "DELIVERY",
      lines: [{ menuItemId: LASSI, quantity: 1 }],
    }),
  });
  const pickupHold = await j("/orders", {
    method: "POST",
    body: JSON.stringify({
      action: "HOLD",
      orderType: "PICKUP",
      lines: [{ menuItemId: LASSI, quantity: 1 }],
    }),
  });
  const firePickup = pickupHold.b?.id
    ? await j(`/orders/${pickupHold.b.id}/fire-advance`, { method: "POST" })
    : { status: 0, b: null };
  await j("/settings/store-status", { method: "PATCH", body: JSON.stringify({ pickupActive: false }) });
  const firePickupPaused = pickupHold.b?.id
    ? await j(`/orders/${pickupHold.b.id}/fire-advance`, { method: "POST" })
    : { status: 0, b: null };
  const addPickup = pickupHold.b?.id
    ? await j(`/orders/${pickupHold.b.id}/items`, {
        method: "POST",
        body: JSON.stringify({ lines: [{ menuItemId: LASSI, quantity: 1 }] }),
      })
    : { status: 0, b: null };
  const unbounded = await j("/orders");
  await j("/settings/store-status", {
    method: "PATCH",
    body: JSON.stringify({ deliveryActive: true, pickupActive: true }),
  });
  const after = await j("/settings/store-status");
  console.log(
    JSON.stringify({
      holdDelivery: { status: holdDelivery.status, error: holdDelivery.b?.error, code: holdDelivery.b?.code },
      pickupHold: { status: pickupHold.status, id: pickupHold.b?.id || null, num: pickupHold.b?.orderNumber || null },
      firePickup: { status: firePickup.status, error: firePickup.b?.error, code: firePickup.b?.code },
      firePickupPaused: { status: firePickupPaused.status, error: firePickupPaused.b?.error, code: firePickupPaused.b?.code },
      addPickup: { status: addPickup.status, error: addPickup.b?.error, code: addPickup.b?.code },
      unboundedCount: Array.isArray(unbounded.b) ? unbounded.b.length : null,
      restored: after.b,
    }),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
