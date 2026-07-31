/*
  Store the daily arrival and departure punches on the attendance record.

  - The first punch is stored as check_in_at and marks the student present
    only when it is at or before 09:00:00.
  - The second punch is stored as check_out_at.
  - A missing departure remains NULL and never changes attendance status.
*/

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS check_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS check_out_at timestamptz;

WITH historical_punches AS (
  SELECT
    record.id AS attendance_record_id,
    MIN(log.punched_at) AS check_in_at,
    (ARRAY_AGG(log.punched_at ORDER BY log.punched_at, log.id))[2] AS check_out_at
  FROM public.attendance_records AS record
  JOIN public.attendance_sessions AS session
    ON session.id = record.session_id
  JOIN public.students AS student
    ON student.id = record.student_id
  JOIN public.device_logs AS log
    ON log.student_biometric_id = student.admission_number
   AND (log.punched_at AT TIME ZONE 'UTC')::date = session.date
  WHERE record.biometric_verified = true
  GROUP BY record.id
)
UPDATE public.attendance_records AS record
SET
  check_in_at = historical.check_in_at,
  check_out_at = historical.check_out_at
FROM historical_punches AS historical
WHERE record.id = historical.attendance_record_id;

-- Preserve the original first-punch timestamp when its raw log is no longer available.
UPDATE public.attendance_records
SET check_in_at = marked_at
WHERE biometric_verified = true
  AND check_in_at IS NULL;

UPDATE public.attendance_records
SET
  status = CASE
    WHEN (check_in_at AT TIME ZONE 'UTC')::time <= TIME '09:00:00'
      THEN 'present'::attendance_status
    ELSE 'absent'::attendance_status
  END,
  remarks = CASE
    WHEN (check_in_at AT TIME ZONE 'UTC')::time <= TIME '09:00:00'
      THEN 'Synchronized from daily biometric punches'
    ELSE 'Arrival after the 09:00 attendance cutoff'
  END
WHERE biometric_verified = true
  AND check_in_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_daily_attendance(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sessions_created integer := 0;
  v_absent_records integer := 0;
  v_present_records integer := 0;
  v_processed_logs integer := 0;
  v_unmatched_logs integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active authenticated users can synchronize daily attendance';
  END IF;

  INSERT INTO public.attendance_sessions (
    class_id, subject_id, date, session_type, source, is_finalized, notes
  )
  SELECT
    cls.id, NULL, p_date, 'full_day'::session_type,
    'system'::attendance_source, false, 'Daily attendance'
  FROM public.classes AS cls
  WHERE cls.is_active = true
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
  JOIN public.students AS student
    ON student.class_id = session.class_id
   AND student.is_active = true
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

  UPDATE public.device_logs AS log
  SET processed = false,
      attendance_record_id = NULL
  WHERE (log.punched_at AT TIME ZONE 'UTC')::date = p_date;

  WITH daily_punches AS (
    SELECT
      session.id AS session_id,
      student.id AS student_id,
      MIN(log.punched_at) AS check_in_at,
      (ARRAY_AGG(log.punched_at ORDER BY log.punched_at, log.id))[2] AS check_out_at
    FROM public.device_logs AS log
    JOIN public.students AS student
      ON student.admission_number = log.student_biometric_id
     AND student.is_active = true
     AND student.class_id IS NOT NULL
    JOIN public.attendance_sessions AS session
      ON session.class_id = student.class_id
     AND session.date = (log.punched_at AT TIME ZONE 'UTC')::date
     AND session.source = 'system'
     AND session.is_finalized = false
    WHERE (log.punched_at AT TIME ZONE 'UTC')::date = p_date
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
      WHEN (check_in_at AT TIME ZONE 'UTC')::time <= TIME '09:00:00'
        THEN 'present'::attendance_status
      ELSE 'absent'::attendance_status
    END,
    true,
    CASE
      WHEN (check_in_at AT TIME ZONE 'UTC')::time <= TIME '09:00:00'
        THEN 'Synchronized from daily biometric punches'
      ELSE 'Arrival after the 09:00 attendance cutoff'
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

  GET DIAGNOSTICS v_present_records = ROW_COUNT;

  SELECT COUNT(*)
  INTO v_present_records
  FROM public.attendance_records AS record
  JOIN public.attendance_sessions AS session
    ON session.id = record.session_id
  WHERE session.date = p_date
    AND session.source = 'system'
    AND record.status = 'present'::attendance_status
    AND record.biometric_verified = true;

  UPDATE public.device_logs AS log
  SET
    processed = true,
    attendance_record_id = (
      SELECT record.id
      FROM public.students AS student
      JOIN public.attendance_sessions AS session
        ON session.class_id = student.class_id
       AND session.date = (log.punched_at AT TIME ZONE 'UTC')::date
       AND session.source = 'system'
      JOIN public.attendance_records AS record
        ON record.session_id = session.id
       AND record.student_id = student.id
      WHERE student.admission_number = log.student_biometric_id
        AND student.is_active = true
      LIMIT 1
    )
  WHERE (log.punched_at AT TIME ZONE 'UTC')::date = p_date
    AND EXISTS (
      SELECT 1
      FROM public.students AS student
      JOIN public.attendance_sessions AS session
        ON session.class_id = student.class_id
       AND session.date = (log.punched_at AT TIME ZONE 'UTC')::date
       AND session.source = 'system'
      WHERE student.admission_number = log.student_biometric_id
        AND student.is_active = true
    );

  GET DIAGNOSTICS v_processed_logs = ROW_COUNT;

  SELECT COUNT(*)
  INTO v_unmatched_logs
  FROM public.device_logs AS log
  WHERE log.processed = false
    AND (log.punched_at AT TIME ZONE 'UTC')::date = p_date;

  RETURN jsonb_build_object(
    'date', p_date,
    'sessions_created', v_sessions_created,
    'absent_records_created', v_absent_records,
    'attendance_records_synced', v_present_records,
    'device_logs_processed', v_processed_logs,
    'device_logs_unmatched', v_unmatched_logs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_daily_attendance(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_daily_attendance(date) TO authenticated;

COMMENT ON FUNCTION public.sync_daily_attendance(date) IS
  'Marks attendance present for arrival by 09:00, absent afterward, and stores departure data.';

COMMENT ON COLUMN public.attendance_records.check_in_at IS
  'First matched biometric punch; arrival through 09:00 marks present, later arrival remains absent.';

COMMENT ON COLUMN public.attendance_records.check_out_at IS
  'Second matched biometric punch; NULL when departure is missing. Later punches remain raw logs.';
