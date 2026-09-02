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

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || "postgresql://pos:pos@127.0.0.1:5432/petpooja",
  });
  await client.connect();
  const orderId = "6740d91d-53e6-4d2a-a203-0c6d17ce71e2";
  const { rows } = await client.query(
    `SELECT id, order_number, status, created_by, settled_at, created_at, tip_total_minor, total_minor, dining_table_id, type
     FROM orders WHERE id = $1`,
    [orderId]
  );
  console.log(JSON.stringify(rows[0], null, 2));
  const user = await client.query(
    `SELECT id, email FROM users WHERE email = 'admin@restaurant.com'`
  );
  console.log("admin", user.rows[0]);
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
