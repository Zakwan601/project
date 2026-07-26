/*
  Synchronize biometric device logs with generated attendance sessions.

  Matching rules:
  - device_logs.student_biometric_id = students.admission_number
  - punch date is calculated in Asia/Dhaka
  - student must belong to the generated session's class
  - finalized sessions are never changed
  - one or more punches mark the student present in every generated session
    for their class on that date
*/

CREATE OR REPLACE FUNCTION public.sync_device_logs_to_attendance(p_month_start date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_end date := (
    p_month_start + INTERVAL '1 month' - INTERVAL '1 day'
  )::date;
  v_absent_records integer := 0;
  v_attendance_records integer := 0;
  v_processed_logs integer := 0;
  v_unmatched_logs integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active administrators can synchronize biometric attendance';
  END IF;

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
    'Generated attendance - no biometric punch'
  FROM public.attendance_sessions AS session
  JOIN public.students AS student
    ON student.class_id = session.class_id
   AND student.is_active = true
  WHERE session.source = 'system'
    AND session.is_finalized = false
    AND session.date BETWEEN p_month_start AND v_month_end
    AND session.date <= (now() AT TIME ZONE 'Asia/Dhaka')::date
  ON CONFLICT (session_id, student_id) DO NOTHING;

  GET DIAGNOSTICS v_absent_records = ROW_COUNT;

  WITH matched_punches AS (
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
     AND session.date = (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date
     AND session.is_finalized = false
     AND session.source = 'system'
    WHERE log.processed = false
      AND (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date
        BETWEEN p_month_start AND v_month_end
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
    'Synchronized from biometric punch',
    first_punch
  FROM matched_punches
  ON CONFLICT (session_id, student_id) DO UPDATE
  SET
    status = 'present'::attendance_status,
    biometric_verified = true,
    marked_at = EXCLUDED.marked_at,
    remarks = CASE
      WHEN existing.remarks IS NULL
        OR existing.remarks = 'Generated attendance - no biometric punch'
      THEN EXCLUDED.remarks
      ELSE existing.remarks
    END;

  GET DIAGNOSTICS v_attendance_records = ROW_COUNT;

  UPDATE public.device_logs AS log
  SET
    processed = true,
    attendance_record_id = (
      SELECT record.id
      FROM public.students AS student
      JOIN public.attendance_sessions AS session
       ON session.class_id = student.class_id
       AND session.date = (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date
       AND session.is_finalized = false
       AND session.source = 'system'
      JOIN public.attendance_records AS record
        ON record.session_id = session.id
       AND record.student_id = student.id
      WHERE student.admission_number = log.student_biometric_id
        AND student.is_active = true
      ORDER BY session.period_number NULLS LAST, session.id
      LIMIT 1
    )
  WHERE log.processed = false
    AND (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date
      BETWEEN p_month_start AND v_month_end
    AND EXISTS (
      SELECT 1
      FROM public.students AS student
      JOIN public.attendance_sessions AS session
        ON session.class_id = student.class_id
       AND session.date = (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date
       AND session.is_finalized = false
       AND session.source = 'system'
      WHERE student.admission_number = log.student_biometric_id
        AND student.is_active = true
    );

  GET DIAGNOSTICS v_processed_logs = ROW_COUNT;

  SELECT COUNT(*)
  INTO v_unmatched_logs
  FROM public.device_logs AS log
  WHERE log.processed = false
    AND (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date
      BETWEEN p_month_start AND v_month_end;

  RETURN jsonb_build_object(
    'month_start', p_month_start,
    'month_end', v_month_end,
    'absent_records_created', v_absent_records,
    'attendance_records_synced', v_attendance_records,
    'device_logs_processed', v_processed_logs,
    'device_logs_unmatched', v_unmatched_logs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_device_logs_to_attendance(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_device_logs_to_attendance(date) TO authenticated;

COMMENT ON FUNCTION public.sync_device_logs_to_attendance(date) IS
  'Admin-only idempotent synchronization of biometric punches into generated attendance sessions.';
