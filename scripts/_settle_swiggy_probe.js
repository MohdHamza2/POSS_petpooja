require("dotenv").config();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const ORDER = "d3eacc15-ae31-4f74-80f4-cba9d898bb1f";

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const { accessToken } = await lr.json();
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };
  const settle = await fetch(`${BASE}/orders/${ORDER}/settle`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ paymentMethod: "UPI", amountPaidMinor: 32000 }),
  });
  const body = await settle.json().catch(() => ({}));
  console.log(JSON.stringify({ http: settle.status, status: body.status, invoice: body.invoiceNumber, already: body.alreadySettled }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
