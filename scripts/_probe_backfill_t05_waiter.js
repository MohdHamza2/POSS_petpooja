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
  const adminId = "2b76bd69-4aba-4b3b-8c13-b20e3a9b434b";
  const r = await client.query(
    `UPDATE orders SET created_by = $1
     WHERE id = $2 AND created_by IS NULL
     RETURNING id, order_number, created_by, tip_total_minor`,
    [adminId, "6740d91d-53e6-4d2a-a203-0c6d17ce71e2"]
  );
  console.log("backfill", r.rows);
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
