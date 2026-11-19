-- Read-only application queries under the real administrator RLS policies.
-- Temporary timing rows and all session settings are rolled back.
BEGIN;
CREATE TEMP TABLE punch_benchmark (scenario text, elapsed_ms numeric, returned_rows bigint, timed_out boolean);
GRANT SELECT, INSERT ON punch_benchmark TO authenticated;
CREATE FUNCTION pg_temp.record_punch_benchmark(label text, report_date date, page_number integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE started timestamptz := clock_timestamp(); n bigint; timed_out boolean := false;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.search_daily_punches_page(NULL,report_date,page_number,25,NULL,'');
  EXCEPTION WHEN query_canceled THEN timed_out := true;
  END;
  INSERT INTO pg_temp.punch_benchmark VALUES (label,round(extract(epoch FROM clock_timestamp()-started)*1000,2),n,timed_out);
END;
$$;
SELECT set_config('app.punch_benchmark_date', (SELECT ((max(punched_at) AT TIME ZONE 'Asia/Dhaka')::date)::text FROM public.device_logs), true);
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.profiles WHERE role='admin' AND is_active ORDER BY id LIMIT 1), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL statement_timeout = '10s';
SET LOCAL ROLE authenticated;
SELECT pg_temp.record_punch_benchmark('All dates, first 25 groups',NULL,1);
SELECT pg_temp.record_punch_benchmark('All dates, page 10',NULL,10);
SELECT pg_temp.record_punch_benchmark('Latest date, first 25 groups',current_setting('app.punch_benchmark_date')::date,1);
RESET ROLE;
SELECT scenario, elapsed_ms, returned_rows, timed_out, (SELECT count(*) FROM public.device_logs) AS punch_rows FROM punch_benchmark ORDER BY scenario;
ROLLBACK;
