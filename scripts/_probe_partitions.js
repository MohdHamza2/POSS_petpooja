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
  const { rows } = await client.query(`
    SELECT inhrelid::regclass::text AS part
    FROM pg_inherits i
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_logs'
    ORDER BY 1
  `);
  console.log(rows.map((r) => r.part).join("\n"));
  const sept = await client.query(`
    SELECT to_regclass('public.audit_logs_y2026m09') AS sept
  `);
  console.log("sept_regclass", sept.rows[0].sept);
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
