require("dotenv").config();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const json = (v) => JSON.stringify(v, null, 2);

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const { accessToken } = await lr.json();
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };

  const paused = await fetch(`${BASE}/settings/store-status`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ isOnline: false }),
  });
  const pausedBody = await paused.json();
  const blockedId = `pause-${Date.now()}`;
  const blocked = await fetch(`${BASE}/webhooks/swiggy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      outletId: OUTLET,
      externalOrderId: blockedId,
      items: [{ name: "Chicken Dum Biryani (Special)", quantity: 1, priceMinor: 32000 }],
    }),
  });
  const blockedBody = await blocked.json().catch(() => ({}));

  const resumed = await fetch(`${BASE}/settings/store-status`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ isOnline: true }),
  });
  const resumedBody = await resumed.json();
  const openId = `unpause-${Date.now()}`;
  const open = await fetch(`${BASE}/webhooks/swiggy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      outletId: OUTLET,
      externalOrderId: openId,
      items: [{ name: "Chicken Dum Biryani (Special)", quantity: 1, priceMinor: 32000 }],
    }),
  });
  const openBody = await open.json().catch(() => ({}));

  console.log(
    json({
      paused: { http: paused.status, isOnline: pausedBody.isOnline },
      ingestWhilePaused: { http: blocked.status, error: blockedBody.error, orderId: blockedBody.orderId },
      resumed: { http: resumed.status, isOnline: resumedBody.isOnline },
      ingestWhileOpen: { http: open.status, status: openBody.status, orderId: openBody.orderId, orderNumber: openBody.orderNumber },
    })
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
