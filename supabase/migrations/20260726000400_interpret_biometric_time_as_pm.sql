/*
  ZKBioTime is storing 12-hour clock values without the PM marker.
  Preserve punched_at exactly as received, but interpret times before 12:00
  as PM for attendance matching:

    02:31:10 stored -> 14:31:10 interpreted
    11:45:00 stored -> 23:45:00 interpreted
    12:15:00 stored -> 12:15:00 interpreted
*/

CREATE OR REPLACE FUNCTION public.biometric_attendance_time(punched_at timestamptz)
RETURNS time
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN (punched_at AT TIME ZONE 'UTC')::time < TIME '12:00:00'
    THEN (
      (punched_at AT TIME ZONE 'UTC')::time + INTERVAL '12 hours'
    )::time
    ELSE (punched_at AT TIME ZONE 'UTC')::time
  END;
$$;

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
  v_corrected_records integer := 0;
  v_absent_records integer := 0;
  v_present_records integer := 0;
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

  UPDATE public.device_logs AS log
  SET processed = false, attendance_record_id = NULL
  WHERE (log.punched_at AT TIME ZONE 'UTC')::date
    BETWEEN p_month_start AND v_month_end;

  UPDATE public.attendance_records AS record
  SET
    status = 'absent'::attendance_status,
    biometric_verified = false,
    remarks = 'Generated attendance - no matching period punch'
  FROM public.attendance_sessions AS session
  WHERE record.session_id = session.id
    AND session.source = 'system'
    AND session.is_finalized = false
    AND session.date BETWEEN p_month_start AND v_month_end
    AND record.biometric_verified = true;

  GET DIAGNOSTICS v_corrected_records = ROW_COUNT;

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
    'Generated attendance - no matching period punch'
  FROM public.attendance_sessions AS session
  JOIN public.routine_slots AS slot
    ON slot.class_id = session.class_id
   AND slot.period_number = session.period_number
   AND slot.day_of_week = EXTRACT(DOW FROM session.date)::integer
  JOIN public.students AS student
    ON student.class_id = session.class_id
   AND student.is_active = true
  WHERE session.source = 'system'
    AND session.is_finalized = false
    AND session.date BETWEEN p_month_start AND v_month_end
    AND (session.date + slot.end_time) <= (now() AT TIME ZONE 'UTC')
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
     AND session.date = (log.punched_at AT TIME ZONE 'UTC')::date
     AND session.source = 'system'
     AND session.is_finalized = false
    JOIN public.routine_slots AS slot
      ON slot.class_id = session.class_id
     AND slot.period_number = session.period_number
     AND slot.day_of_week = EXTRACT(DOW FROM session.date)::integer
     AND public.biometric_attendance_time(log.punched_at) >= slot.start_time
     AND public.biometric_attendance_time(log.punched_at) < slot.end_time
    WHERE (log.punched_at AT TIME ZONE 'UTC')::date
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
    'Synchronized from biometric punch (12-hour value interpreted as PM)',
    first_punch
  FROM matched_punches
  ON CONFLICT (session_id, student_id) DO UPDATE
  SET
    status = 'present'::attendance_status,
    biometric_verified = true,
    marked_at = EXCLUDED.marked_at,
    remarks = CASE
      WHEN existing.remarks IS NULL
        OR existing.remarks IN (
          'Generated attendance - no biometric punch',
          'Generated attendance - no matching period punch',
          'Synchronized from biometric punch',
          'Synchronized from biometric punch (12-hour value interpreted as PM)'
        )
      THEN EXCLUDED.remarks
      ELSE existing.remarks
    END;

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
       AND session.is_finalized = false
      JOIN public.routine_slots AS slot
        ON slot.class_id = session.class_id
       AND slot.period_number = session.period_number
       AND slot.day_of_week = EXTRACT(DOW FROM session.date)::integer
       AND public.biometric_attendance_time(log.punched_at) >= slot.start_time
       AND public.biometric_attendance_time(log.punched_at) < slot.end_time
      JOIN public.attendance_records AS record
        ON record.session_id = session.id
       AND record.student_id = student.id
      WHERE student.admission_number = log.student_biometric_id
        AND student.is_active = true
      ORDER BY session.period_number, session.id
      LIMIT 1
    )
  WHERE (log.punched_at AT TIME ZONE 'UTC')::date
      BETWEEN p_month_start AND v_month_end
    AND EXISTS (
      SELECT 1
      FROM public.students AS student
      JOIN public.attendance_sessions AS session
        ON session.class_id = student.class_id
       AND session.date = (log.punched_at AT TIME ZONE 'UTC')::date
       AND session.source = 'system'
       AND session.is_finalized = false
      JOIN public.routine_slots AS slot
        ON slot.class_id = session.class_id
       AND slot.period_number = session.period_number
       AND slot.day_of_week = EXTRACT(DOW FROM session.date)::integer
       AND public.biometric_attendance_time(log.punched_at) >= slot.start_time
       AND public.biometric_attendance_time(log.punched_at) < slot.end_time
      WHERE student.admission_number = log.student_biometric_id
        AND student.is_active = true
    );

  GET DIAGNOSTICS v_processed_logs = ROW_COUNT;

  SELECT COUNT(*)
  INTO v_unmatched_logs
  FROM public.device_logs AS log
  WHERE log.processed = false
    AND (log.punched_at AT TIME ZONE 'UTC')::date
      BETWEEN p_month_start AND v_month_end;

  RETURN jsonb_build_object(
    'month_start', p_month_start,
    'month_end', v_month_end,
    'corrected_records', v_corrected_records,
    'absent_records_created', v_absent_records,
    'attendance_records_synced', v_present_records,
    'device_logs_processed', v_processed_logs,
    'device_logs_unmatched', v_unmatched_logs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biometric_attendance_time(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biometric_attendance_time(timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.sync_device_logs_to_attendance(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_device_logs_to_attendance(date) TO authenticated;

COMMENT ON FUNCTION public.biometric_attendance_time(timestamptz) IS
  'Interprets stored 12-hour biometric times before noon as PM without changing punched_at.';
COMMENT ON FUNCTION public.sync_device_logs_to_attendance(date) IS
  'Matches PM-interpreted biometric punches to one exact generated routine period.';
