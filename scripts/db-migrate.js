// Applies db/migrations/*.sql in order, tracked in schema_migrations,
// then reconciles the live database to kapmeta/schema.prisma (the schema the
// running API and POS actually use). Duplicate SQL objects are skipped;
// any other SQL error is not recorded as applied.
//
// schema_migrations is the table docs/12-operations/troubleshooting/TS-DB-database-issues.md
// already assumes exists — keep this name in sync if either changes.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Client } = require('pg');

const DUPLICATE_SQLSTATES = new Set(['42P07', '42710', '42701', '42723', '42P06']);

// Ensure root .env is loaded if DATABASE_URL is not already in environment
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  });
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const ROOT_DIR = path.join(__dirname, '..');

function isDuplicateSchemaError(err) {
  if (err && DUPLICATE_SQLSTATES.has(err.code)) return true;
  const msg = String((err && err.message) || '');
  return /already exists/i.test(msg);
}

function reconcilePrismaSchema() {
  console.log('[db:migrate] reconciling Prisma schema (kapmeta/schema.prisma) ...');
  // CI empty databases may need destructive sync after overlapping historic SQL.
  // Local developer databases never pass --accept-data-loss.
  const extra = process.env.CI === 'true' ? ' --accept-data-loss' : '';
  execSync(`npx prisma db push --schema=kapmeta/schema.prisma --skip-generate${extra}`, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });
  console.log('[db:migrate] Prisma schema is in sync.');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://pos:pos@localhost:5432/petpooja';
  if (!databaseUrl) {
    console.error('[db:migrate] DATABASE_URL not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort()
    : [];

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version      TEXT PRIMARY KEY,
        applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const { rows: applied } = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(applied.map((r) => r.version));

    let ranCount = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[db:migrate] applying ${file} ...`);

      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        console.log(`[db:migrate] applied ${file}`);
        ranCount += 1;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (isDuplicateSchemaError(err)) {
          console.log(`[db:migrate] ${file}: schema objects already present. Recorded migration state.`);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        } else {
          console.warn(
            `[db:migrate] ${file} did not apply (${err.code || 'unknown'}): ${err.message}. Leaving unrecorded; Prisma reconcile will fill gaps.`,
          );
        }
      }
    }

    if (ranCount === 0) {
      console.log('[db:migrate] SQL migrations already up to date (or none pending).');
    } else {
      console.log(`[db:migrate] Applied ${ranCount} SQL migration(s).`);
    }
  } finally {
    await client.end();
  }

  reconcilePrismaSchema();
}

main().catch((err) => {
  console.error('[db:migrate] Unexpected error:', err);
  process.exit(1);
});
