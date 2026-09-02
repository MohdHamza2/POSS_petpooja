const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const idx = trimmed.indexOf("=");
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    });
}

const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const ORDER = "2bc8c922-6aa5-4137-b155-e4c74a286792";

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const { accessToken } = await lr.json();
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };
  const search = await (await fetch(`${BASE}/crm/customers?search=9876501234&limit=25`, { headers: H })).json();
  const list = search.customers || [];
  const cid = (list.find((c) => String(c.phone || "").replace(/\s+/g, "") === "9876501234") || {}).id;
  if (!cid) throw new Error("customer not found");
  const client = new Client({
    connectionString: process.env.DATABASE_URL || "postgresql://pos:pos@127.0.0.1:5432/petpooja",
  });
  await client.connect();
  await client.query("UPDATE orders SET customer_id = $1, table_number = $2 WHERE id = $3", [cid, "DELIVERY", ORDER]);
  const row = await client.query(
    "SELECT order_number, dining_table_id, table_number, customer_id, status FROM orders WHERE id = $1",
    [ORDER]
  );
  console.log(JSON.stringify(row.rows[0], null, 2));
  await client.end();
  const live = await (await fetch(`${BASE}/orders/live?kind=online`, { headers: H })).json();
  const arr = Array.isArray(live) ? live : [];
  console.log(
    JSON.stringify(
      arr.map((o) => ({
        n: o.orderNumber,
        channel: o.channel,
        cust: o.customerName,
        table: o.table_number,
        dining: o.diningTableId,
        status: o.status,
      })),
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
