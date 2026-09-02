const { Client } = require('pg');

async function setup() {
  const client = new Client({
    connectionString: 'postgresql://pos:pos@localhost:5432/petpooja'
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_wastage_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        outlet_id UUID NOT NULL,
        ingredient_id UUID NOT NULL REFERENCES ingredients(id),
        quantity DECIMAL(10,3) NOT NULL,
        reason TEXT NOT NULL,
        logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        logged_by UUID NOT NULL,
        finance_entry_id UUID
      );
      CREATE INDEX IF NOT EXISTS idx_wastage_log_outlet ON inventory_wastage_log(outlet_id);
      CREATE INDEX IF NOT EXISTS idx_wastage_log_ingredient ON inventory_wastage_log(ingredient_id);
    `);
    console.log('Table inventory_wastage_log created');
  } catch (err) {
    console.error('Error creating table', err);
  } finally {
    await client.end();
  }
}

setup();
