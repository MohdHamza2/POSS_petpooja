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
  const { rows } = await client.query(
    `SELECT order_number, type, status, created_by, dining_table_id, table_number, advance_status, scheduled_fire_at
     FROM orders WHERE order_number IN ('20260831-0035','20260831-0036','20260831-0037')
     ORDER BY order_number`
  );
  console.log(JSON.stringify(rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
