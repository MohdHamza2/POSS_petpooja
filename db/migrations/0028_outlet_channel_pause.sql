-- Per-channel pause flags for dine-in / delivery / pickup.
-- Additive only. Defaults keep existing outlets accepting all modes.

ALTER TABLE outlet_status
  ADD COLUMN IF NOT EXISTS dine_in_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pickup_active BOOLEAN NOT NULL DEFAULT true;

INSERT INTO schema_migrations (version) VALUES ('0028_outlet_channel_pause') ON CONFLICT DO NOTHING;
