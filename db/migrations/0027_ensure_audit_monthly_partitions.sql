-- Audit / access / config tables are RANGE-partitioned monthly on created_at.
-- 0008 only shipped the 2026-08 partition. On month rollover, payment and settle
-- audit writes fail with SQLSTATE 23514 (no partition for row).
-- Keep current month plus 18 months ahead so live ops do not stop at midnight.

BEGIN;

CREATE OR REPLACE FUNCTION ensure_monthly_partitions(months_ahead integer DEFAULT 12)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  parent text;
  start_d date;
  end_d date;
  part_name text;
  created int := 0;
  i int;
BEGIN
  IF months_ahead IS NULL OR months_ahead < 0 THEN
    months_ahead := 12;
  END IF;

  FOREACH parent IN ARRAY ARRAY['audit_logs', 'configuration_changes', 'access_logs']
  LOOP
    FOR i IN -1..months_ahead LOOP
      start_d := (date_trunc('month', CURRENT_DATE::timestamp) + make_interval(months => i))::date;
      end_d := (date_trunc('month', CURRENT_DATE::timestamp) + make_interval(months => i + 1))::date;
      part_name := parent || '_y' || to_char(start_d, 'YYYY') || 'm' || to_char(start_d, 'MM');
      BEGIN
        EXECUTE format(
          'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
          part_name,
          parent,
          start_d::text,
          end_d::text
        );
        created := created + 1;
      EXCEPTION
        WHEN duplicate_table THEN
          NULL;
        WHEN others THEN
          RAISE NOTICE 'ensure_monthly_partitions skip %: %', part_name, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  RETURN created;
END;
$$;

SELECT ensure_monthly_partitions(18);

COMMIT;
