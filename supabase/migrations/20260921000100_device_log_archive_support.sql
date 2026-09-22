-- Archive-backed attendance recalculation and scheduled hot-log retention.
-- Raw archive rows are supplied by the service-role Edge Function; the external
-- archive database is never exposed to clients or connected directly by Postgres.

CREATE OR REPLACE FUNCTION public.sync_archived_attendance_as_service(
  p_date date,
  p_punches jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sessions_created integer := 0;
  v_absent_records integer := 0;
  v_present_records integer := 0;
  v_archived_punches integer := 0;
  v_unmatched_punches integer := 0;
BEGIN
  IF p_punches IS NULL OR jsonb_typeof(p_punches) <> 'array' THEN
    RAISE EXCEPTION 'p_punches must be a JSON array';
  END IF;

  CREATE TEMP TABLE archived_punch_input (
    id uuid,
    student_biometric_id text NOT NULL,
    punched_at timestamptz NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO archived_punch_input (id, student_biometric_id, punched_at)
  SELECT input.id, input.student_biometric_id, input.punched_at
  FROM jsonb_to_recordset(p_punches) AS input(
    id uuid,
    student_biometric_id text,
    punched_at timestamptz
  )
  WHERE input.student_biometric_id IS NOT NULL
    AND input.punched_at IS NOT NULL
    AND (input.punched_at AT TIME ZONE 'Asia/Dhaka')::date = p_date;

  GET DIAGNOSTICS v_archived_punches = ROW_COUNT;

  INSERT INTO public.attendance_sessions (
    class_id, subject_id, date, session_type, source, is_finalized, notes
  )
  SELECT
    cls.id, NULL, p_date, 'full_day'::session_type,
    'system'::attendance_source, false, 'Daily attendance'
  FROM public.classes AS cls
  JOIN public.academic_years AS year ON year.id = cls.academic_year_id
  WHERE p_date BETWEEN year.start_date AND year.end_date
    AND (cls.is_active = true OR p_date < current_date)
  ON CONFLICT (class_id, date) DO NOTHING;

  GET DIAGNOSTICS v_sessions_created = ROW_COUNT;

  INSERT INTO public.attendance_records (
    session_id, student_id, status, biometric_verified, remarks,
    check_in_at, check_out_at
  )
  SELECT
    session.id, student.id, 'absent'::attendance_status, false,
    'No biometric punch for this date', NULL, NULL
  FROM public.attendance_sessions AS session
  JOIN LATERAL public.get_class_students_for_period(session.class_id, p_date, p_date) AS student
    ON (student.is_active = true OR p_date < current_date)
  WHERE session.date = p_date
    AND session.source = 'system'
    AND session.is_finalized = false
  ON CONFLICT (session_id, student_id) DO NOTHING;

  GET DIAGNOSTICS v_absent_records = ROW_COUNT;

  UPDATE public.attendance_records AS record
  SET
    status = 'absent'::attendance_status,
    biometric_verified = false,
    remarks = 'No biometric punch for this date',
    check_in_at = NULL,
    check_out_at = NULL
  FROM public.attendance_sessions AS session
  WHERE record.session_id = session.id
    AND session.date = p_date
    AND session.source = 'system'
    AND session.is_finalized = false;

  WITH daily_punches AS (
    SELECT
      session.id AS session_id,
      student.id AS student_id,
      MIN(punch.punched_at) AS check_in_at,
      (ARRAY_AGG(punch.punched_at ORDER BY punch.punched_at, punch.id))[2] AS check_out_at
    FROM archived_punch_input AS punch
    JOIN public.students AS student
      ON student.admission_number = punch.student_biometric_id
     AND (student.is_active = true OR p_date < current_date)
     AND public.get_student_class_on_date(student.id, p_date) IS NOT NULL
    JOIN public.attendance_sessions AS session
      ON session.class_id = public.get_student_class_on_date(student.id, p_date)
     AND session.date = p_date
     AND session.source = 'system'
     AND session.is_finalized = false
    GROUP BY session.id, student.id
  )
  INSERT INTO public.attendance_records AS existing (
    session_id, student_id, status, biometric_verified, remarks,
    marked_at, check_in_at, check_out_at
  )
  SELECT
    session_id,
    student_id,
    CASE
      WHEN (check_in_at AT TIME ZONE 'Asia/Dhaka')::time <= TIME '09:00:00'
        THEN 'present'::attendance_status
      ELSE 'absent'::attendance_status
    END,
    true,
    CASE
      WHEN (check_in_at AT TIME ZONE 'Asia/Dhaka')::time <= TIME '09:00:00'
        THEN 'Synchronized from archived biometric punches'
      ELSE 'Archived arrival after the attendance cutoff'
    END,
    check_in_at, check_in_at, check_out_at
  FROM daily_punches
  ON CONFLICT (session_id, student_id) DO UPDATE
  SET
    status = EXCLUDED.status,
    biometric_verified = true,
    remarks = EXCLUDED.remarks,
    marked_at = EXCLUDED.marked_at,
    check_in_at = EXCLUDED.check_in_at,
    check_out_at = EXCLUDED.check_out_at;

  SELECT COUNT(*)
  INTO v_present_records
  FROM public.attendance_records AS record
  JOIN public.attendance_sessions AS session ON session.id = record.session_id
  WHERE session.date = p_date
    AND session.source = 'system'
    AND record.status = 'present'::attendance_status
    AND record.biometric_verified = true;

  SELECT COUNT(*)
  INTO v_unmatched_punches
  FROM archived_punch_input AS punch
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.students AS student
    WHERE student.admission_number = punch.student_biometric_id
      AND public.get_student_class_on_date(student.id, p_date) IS NOT NULL
  );

  RETURN jsonb_build_object(
    'date', p_date,
    'sessions_created', v_sessions_created,
    'absent_records_created', v_absent_records,
    'attendance_records_synced', v_present_records,
    'device_logs_processed', v_archived_punches,
    'device_logs_unmatched', v_unmatched_punches,
    'source', 'archive'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_archived_attendance_as_service(date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_archived_attendance_as_service(date, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.sync_archived_attendance_as_service(date, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_archived_attendance_as_service(date, jsonb) TO service_role;

COMMENT ON FUNCTION public.sync_archived_attendance_as_service(date, jsonb) IS
  'Recalculates a historical attendance date from raw punches retrieved from the external archive.';

CREATE INDEX IF NOT EXISTS device_logs_unprocessed_punched_at_idx
  ON public.device_logs (punched_at DESC)
  WHERE processed = false;

CREATE OR REPLACE FUNCTION public.invoke_device_log_archive()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_url text;
  v_archive_secret text;
BEGIN
  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT decrypted_secret INTO v_archive_secret
  FROM vault.decrypted_secrets
  WHERE name = 'device_log_archive_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NULLIF(v_project_url, '') IS NULL OR NULLIF(v_archive_secret, '') IS NULL THEN
    RAISE WARNING 'Device-log archive skipped: configure project_url and device_log_archive_secret in Vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/archive-device-logs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Archive-Secret', v_archive_secret
    ),
    body := jsonb_build_object('action', 'archive'),
    timeout_milliseconds := 25000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_device_log_archive() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_device_log_archive() FROM anon;
REVOKE ALL ON FUNCTION public.invoke_device_log_archive() FROM authenticated;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'archive-processed-device-logs'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'archive-processed-device-logs',
    '30 20 * * *',
    'SELECT public.invoke_device_log_archive();'
  );
END;
$$;