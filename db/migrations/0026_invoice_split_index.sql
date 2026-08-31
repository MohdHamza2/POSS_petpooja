-- Split bills: one Invoice row per payment on the same order.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_order_id_key;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS split_index INT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_order_split ON invoices(order_id, split_index);
