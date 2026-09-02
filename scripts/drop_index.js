const { Client } = require('pg');

async function dropIndex() {
  const client = new Client({
    connectionString: 'postgresql://pos:pos@localhost:5432/petpooja'
  });
  await client.connect();
  try {
    await client.query('DROP INDEX IF EXISTS idx_dining_tables_merge_group');
    await client.query('DROP INDEX IF EXISTS idx_outbox_pending');
    console.log('Indexes dropped successfully');
  } catch (err) {
    console.error('Error dropping index', err);
  } finally {
    await client.end();
  }
}

dropIndex();
