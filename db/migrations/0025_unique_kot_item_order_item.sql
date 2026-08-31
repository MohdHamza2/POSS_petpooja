-- One kitchen ticket line per order item. Partial unique so leftover NULL
-- order_item_id rows (legacy tickets) can coexist.
BEGIN;

DELETE FROM kot_items
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY order_item_id ORDER BY id) AS rn
    FROM kot_items
    WHERE order_item_id IS NOT NULL
  ) dup
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kot_items_order_item
  ON kot_items (order_item_id)
  WHERE order_item_id IS NOT NULL;

COMMIT;
