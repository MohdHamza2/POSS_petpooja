// Applies db/migrations/*.sql on existing databases, then reconciles to
// kapmeta/schema.prisma (the schema the running API and POS actually use).
//
// A brand-new database (clone / CI) skips overlapping historic SQL and is
// created from Prisma only. Those SQL files define conflicting enums/indexes
// that make `prisma db push` fail with errors like idx_outbox_pending already exists.
//
// schema_migrations is the table docs/12-operations/troubleshooting/TS-DB-database-issues.md
// already assumes exists — keep this name in sync if either changes.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Client } = require('pg');

const DUPLICATE_SQLSTATES = new Set(['42P07', '42710', '42701', '42723', '42P06']);

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
const DEBUG_LOG = path.join(ROOT_DIR, 'debug-9c675b.log');

function debugLog(hypothesisId, message, data) {
  // #region agent log
  const payload = {
    sessionId: '9c675b',
    hypothesisId,
    location: 'scripts/db-migrate.js',
    message,
    data,
    timestamp: Date.now(),
    runId: process.env.CI === 'true' ? 'ci' : 'local',
  };
  try {
    fs.appendFileSync(DEBUG_LOG, JSON.stringify(payload) + '\n');
  } catch (_) {
    /* ignore */
  }
  console.log(`[db:migrate] ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
  // #endregion
}

function isDuplicateSchemaError(err) {
  if (err && DUPLICATE_SQLSTATES.has(err.code)) return true;
  const msg = String((err && err.message) || '');
  return /already exists/i.test(msg);
}

function reconcilePrismaSchema() {
  console.log('[db:migrate] reconciling Prisma schema (kapmeta/schema.prisma) ...');
  execSync('npx prisma db push --schema=kapmeta/schema.prisma --skip-generate', {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });
  console.log('[db:migrate] Prisma schema is in sync.');
}

async function ensureExtensions(client) {
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await client.query('CREATE EXTENSION IF NOT EXISTS citext');
}

async function isFreshDatabase(client) {
  const { rows } = await client.query(`
    SELECT COUNT(*)::int AS n
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> 'schema_migrations'
  `);
  return rows[0].n === 0;
}

async function applyHistoricSql(client, files) {
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
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://pos:pos@127.0.0.1:5432/petpooja';
  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort()
    : [];

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  debugLog('A', 'connected to postgres', { hostHint: String(databaseUrl).replace(/:[^:@/]+@/, ':****@').slice(0, 80) });

  try {
    await ensureExtensions(client);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version      TEXT PRIMARY KEY,
        applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const fresh = await isFreshDatabase(client);
    debugLog('B', 'database freshness', { fresh, sqlFileCount: files.length });

    if (fresh) {
      console.log('[db:migrate] empty database — applying Prisma schema only so a clone matches the running POS.');
    } else {
      await applyHistoricSql(client, files);
    }
  } finally {
    await client.end();
  }

  try {
    reconcilePrismaSchema();
    debugLog('C', 'prisma db push succeeded', { ok: true });
  } catch (err) {
    debugLog('C', 'prisma db push failed', { ok: false, error: String(err && err.message) });
    throw err;
  }
}

main().catch((err) => {
  console.error('[db:migrate] Unexpected error:', err);
  process.exit(1);
});
