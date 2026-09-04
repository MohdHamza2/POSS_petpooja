ALTER TABLE orders ADD COLUMN idempotency_key TEXT; ALTER TABLE orders ADD CONSTRAINT uq_orders_outlet_idempotency UNIQUE (outlet_id, idempotency_key);
