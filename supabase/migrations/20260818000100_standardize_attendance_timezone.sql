/*
  Standardize biometric attendance timestamps as real instants.

  ZKTeco ATTLOG dates and times are Asia/Dhaka wall-clock values. timestamptz
  stores the equivalent UTC instant, but every school-day boundary and cutoff
  must be evaluated in Asia/Dhaka rather than UTC.
*/

CREATE TEMP TABLE attendance_timezone_repair_dates (
  date date PRIMARY KEY
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.zkteco_raw_punch_instant(p_raw_data jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_date text := p_raw_data #>> '{fields,1}';
  v_time text := p_raw_data #>> '{fields,2}';
BEGIN
  IF jsonb_typeof(p_raw_data -> 'fields') IS DISTINCT FROM 'array'
     OR COALESCE(v_date !~ '^\d{4}-\d{2}-\d{2}$', true)
     OR COALESCE(v_time !~ '^\d{2}:\d{2}:\d{2}$', true)
  THEN
    RETURN NULL;
  END IF;

  RETURN concat(v_date, ' ', v_time)::timestamp AT TIME ZONE 'Asia/Dhaka';
EXCEPTION
  WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RETURN NULL;
END;
$$;

/* Capture both sides of a possible date move so stale attendance is cleared. */
INSERT INTO attendance_timezone_repair_dates (date)
SELECT DISTINCT candidate.date
FROM (
  SELECT
    log.punched_at,
    pg_temp.zkteco_raw_punch_instant(log.raw_data) AS canonical_punched_at
  FROM public.device_logs AS log
) AS repairable
CROSS JOIN LATERAL (
  VALUES
    ((repairable.punched_at AT TIME ZONE 'UTC')::date),
    ((repairable.canonical_punched_at AT TIME ZONE 'Asia/Dhaka')::date)
) AS candidate(date)
WHERE repairable.canonical_punched_at IS NOT NULL
ON CONFLICT DO NOTHING;

/* The saved body is authoritative, so it can safely repair legacy offset use. */
UPDATE public.device_logs AS log
SET
  punched_at = repairable.canonical_punched_at,
  processed = false,
  attendance_record_id = NULL
FROM (
  SELECT id, pg_temp.zkteco_raw_punch_instant(raw_data) AS canonical_punched_at
  FROM public.device_logs
) AS repairable
WHERE repairable.id = log.id
  AND repairable.canonical_punched_at IS NOT NULL;

/* Preserve the latest academic-year-aware sync implementation, changing only
   its obsolete wall-clock interpretation. */
DO $migration$
DECLARE
  v_oid oid;
  v_definition text;
  v_updated text;
BEGIN
  SELECT to_regprocedure('public.sync_daily_attendance(date)')::oid INTO v_oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'sync_daily_attendance(date) was not found';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;
  v_updated := replace(
    v_definition,
    'AT TIME ZONE ''UTC''',
    'AT TIME ZONE ''Asia/Dhaka'''
  );

  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'sync_daily_attendance(date) had no UTC attendance expressions to replace';
  END IF;
  EXECUTE v_updated;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.mark_post_9_biometric_arrival_late()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.manually_corrected = true THEN
    RETURN NEW;
  END IF;

  IF NEW.biometric_verified = true
     AND NEW.check_in_at IS NOT NULL
     AND (NEW.check_in_at AT TIME ZONE 'Asia/Dhaka')::time > TIME '09:00:00'
  THEN
    NEW.status := 'late'::attendance_status;
    NEW.remarks := 'Late arrival after the 09:00 attendance cutoff';
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.get_daily_punches_page(date, integer, integer, text);

CREATE OR REPLACE FUNCTION public.get_daily_punches_page(
  p_date date DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_student_biometric_id text DEFAULT NULL
)
RETURNS TABLE (
  student_biometric_id text,
  punch_date date,
  punch_ids uuid[],
  punch_times timestamptz[],
  first_name text,
  last_name text,
  photo_url text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH daily_punches AS (
    SELECT
      log.student_biometric_id,
      (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date AS punch_date,
      ARRAY_AGG(log.id ORDER BY log.punched_at, log.id) AS punch_ids,
      ARRAY_AGG(log.punched_at ORDER BY log.punched_at, log.id) AS punch_times,
      student.first_name,
      student.last_name,
      student.photo_url
    FROM public.device_logs AS log
    LEFT JOIN public.students AS student
      ON student.admission_number = log.student_biometric_id
    WHERE (p_student_biometric_id IS NULL
           OR log.student_biometric_id = p_student_biometric_id)
      AND (
        p_date IS NULL
        OR (
          log.punched_at >= (p_date::timestamp AT TIME ZONE 'Asia/Dhaka')
          AND log.punched_at < ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')
        )
      )
    GROUP BY
      log.student_biometric_id,
      (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date,
      student.first_name,
      student.last_name,
      student.photo_url
  ), counted AS (
    SELECT daily_punches.*, COUNT(*) OVER () AS total_count
    FROM daily_punches
  )
  SELECT
    counted.student_biometric_id,
    counted.punch_date,
    counted.punch_ids,
    counted.punch_times,
    counted.first_name,
    counted.last_name,
    counted.photo_url,
    counted.total_count
  FROM counted
  ORDER BY counted.punch_date DESC, counted.punch_times[1] DESC,
           counted.student_biometric_id
  LIMIT LEAST(GREATEST(p_page_size, 1), 100)
  OFFSET (GREATEST(p_page, 1) - 1) * LEAST(GREATEST(p_page_size, 1), 100);
$$;

REVOKE ALL ON FUNCTION public.get_daily_punches_page(date, integer, integer, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_punches_page(date, integer, integer, text)
  TO authenticated;

/* Vacation cleanup also uses the local school date. */
DO $migration$
DECLARE
  v_oid oid;
  v_definition text;
  v_updated text;
BEGIN
  SELECT to_regprocedure('public.mark_attendance_vacation(date,text,text)')::oid INTO v_oid;
  IF v_oid IS NOT NULL THEN
    SELECT pg_get_functiondef(v_oid) INTO v_definition;
    v_updated := replace(
      v_definition,
      'AT TIME ZONE ''UTC''',
      'AT TIME ZONE ''Asia/Dhaka'''
    );
    IF v_updated <> v_definition THEN
      EXECUTE v_updated;
    END IF;
  END IF;
END;
$migration$;

/* Departure analysis uses each class's validated configured timezone. */
DO $migration$
DECLARE
  v_oid oid;
  v_definition text;
  v_updated text;
BEGIN
  SELECT to_regprocedure('public.analyze_student_departures(uuid,date,time without time zone)')::oid
  INTO v_oid;
  IF v_oid IS NOT NULL THEN
    SELECT pg_get_functiondef(v_oid) INTO v_definition;
    v_updated := replace(v_definition, 'AT TIME ZONE ''UTC''', 'AT TIME ZONE v_timezone');
    IF v_updated <> v_definition THEN
      EXECUTE v_updated;
    END IF;
  END IF;
END;
$migration$;

/* Rebuild dates represented by authoritative raw payloads. This clears records
   from an old UTC day and creates/updates them on the correct Dhaka day. */
DO $migration$
DECLARE
  v_date date;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE is_active = true) THEN
    FOR v_date IN
      SELECT date FROM attendance_timezone_repair_dates ORDER BY date
    LOOP
      PERFORM public.sync_daily_attendance_as_service(v_date);
    END LOOP;
  END IF;
END;
$migration$;

COMMENT ON FUNCTION public.get_daily_punches_page(date, integer, integer, text) IS
  'Returns biometric punches grouped and filtered by their Asia/Dhaka school date.';

COMMENT ON FUNCTION public.mark_post_9_biometric_arrival_late() IS
  'Classifies biometric arrival after 09:00 Asia/Dhaka as late.';

COMMENT ON COLUMN public.device_logs.punched_at IS
  'Biometric punch instant; timezone-less device payloads are interpreted as Asia/Dhaka.';
