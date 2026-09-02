require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "0028_outlet_channel_pause.sql"),
    "utf8"
  );
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(sql);
  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'outlet_status' ORDER BY column_name
  `);
  console.log(JSON.stringify({ columns: cols.rows.map((r) => r.column_name) }));
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
