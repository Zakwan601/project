/*
  Allow every active authenticated user to trigger the deterministic daily
  attendance synchronization when visiting the application.

  The function accepts only a date. Attendance values are always calculated
  server-side from students and device_logs.
*/

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
    class_id,
    subject_id,
    date,
    session_type,
    source,
    is_finalized,
    notes
  )
  SELECT
    cls.id,
    NULL,
    p_date,
    'full_day'::session_type,
    'system'::attendance_source,
    false,
    'Daily attendance'
  FROM public.classes AS cls
  WHERE cls.is_active = true
  ON CONFLICT (class_id, date) DO NOTHING;

  GET DIAGNOSTICS v_sessions_created = ROW_COUNT;

  INSERT INTO public.attendance_records (
    session_id,
    student_id,
    status,
    biometric_verified,
    remarks
  )
  SELECT
    session.id,
    student.id,
    'absent'::attendance_status,
    false,
    'No biometric punch for this date'
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
    remarks = 'No biometric punch for this date'
  FROM public.attendance_sessions AS session
  WHERE record.session_id = session.id
    AND session.date = p_date
    AND session.source = 'system'
    AND session.is_finalized = false;

  UPDATE public.device_logs AS log
  SET processed = false, attendance_record_id = NULL
  WHERE (log.punched_at AT TIME ZONE 'UTC')::date = p_date;

  WITH daily_punches AS (
    SELECT
      session.id AS session_id,
      student.id AS student_id,
      MIN(log.punched_at) AS first_punch
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
    session_id,
    student_id,
    status,
    biometric_verified,
    remarks,
    marked_at
  )
  SELECT
    session_id,
    student_id,
    'present'::attendance_status,
    true,
    'Synchronized from daily biometric punch',
    first_punch
  FROM daily_punches
  ON CONFLICT (session_id, student_id) DO UPDATE
  SET
    status = 'present'::attendance_status,
    biometric_verified = true,
    remarks = EXCLUDED.remarks,
    marked_at = EXCLUDED.marked_at;

  GET DIAGNOSTICS v_present_records = ROW_COUNT;

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
  'Deterministic daily punch sync callable by active authenticated application users.';
