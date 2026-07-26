/*
  Destructive routine removal and daily attendance conversion.

  Final model:
  - no routine_slots table
  - no month/session generation function
  - no period_number on attendance_sessions
  - one full-day attendance session per class and date
  - any matched biometric punch on that date marks the student present
*/

DROP FUNCTION IF EXISTS public.generate_attendance_sessions(date);
DROP FUNCTION IF EXISTS public.sync_device_logs_to_attendance(date);
DROP FUNCTION IF EXISTS public.biometric_attendance_time(timestamptz);

/*
  Preserve a daily summary before deleting the old period sessions.
  If any old period was present, the preserved daily result is present.
*/
CREATE TEMP TABLE daily_attendance_backup ON COMMIT DROP AS
SELECT
  session.class_id,
  session.date,
  record.student_id,
  CASE
    WHEN bool_or(record.status = 'present') THEN 'present'::attendance_status
    WHEN bool_or(record.status = 'late') THEN 'late'::attendance_status
    WHEN bool_or(record.status = 'excused') THEN 'excused'::attendance_status
    ELSE 'absent'::attendance_status
  END AS status,
  bool_or(record.biometric_verified) AS biometric_verified,
  MIN(record.marked_at) FILTER (
    WHERE record.status IN ('present', 'late')
  ) AS first_marked_at
FROM public.attendance_sessions AS session
JOIN public.attendance_records AS record
  ON record.session_id = session.id
GROUP BY session.class_id, session.date, record.student_id;

/*
  Delete period sessions. Attendance records cascade; device log links become
  null through their existing ON DELETE SET NULL foreign key.
*/
DELETE FROM public.attendance_sessions;

UPDATE public.device_logs
SET processed = false, attendance_record_id = NULL;

DROP INDEX IF EXISTS public.sessions_class_date_period_idx;
DROP INDEX IF EXISTS public.sessions_class_date_type_noperiod_idx;
DROP INDEX IF EXISTS public.sessions_class_date_type_idx;

ALTER TABLE public.attendance_sessions
  DROP COLUMN IF EXISTS period_number;

CREATE UNIQUE INDEX sessions_class_date_daily_idx
  ON public.attendance_sessions (class_id, date);

INSERT INTO public.attendance_sessions (
  class_id,
  subject_id,
  date,
  session_type,
  source,
  is_finalized,
  notes
)
SELECT DISTINCT
  backup.class_id,
  NULL,
  backup.date,
  'full_day'::session_type,
  'system'::attendance_source,
  false,
  'Daily attendance'
FROM daily_attendance_backup AS backup
ON CONFLICT (class_id, date) DO NOTHING;

INSERT INTO public.attendance_records (
  session_id,
  student_id,
  status,
  biometric_verified,
  remarks,
  marked_at
)
SELECT
  session.id,
  backup.student_id,
  backup.status,
  backup.biometric_verified,
  CASE
    WHEN backup.biometric_verified THEN 'Preserved from biometric attendance'
    ELSE 'Preserved during daily attendance conversion'
  END,
  COALESCE(backup.first_marked_at, now())
FROM daily_attendance_backup AS backup
JOIN public.attendance_sessions AS session
  ON session.class_id = backup.class_id
 AND session.date = backup.date
ON CONFLICT (session_id, student_id) DO UPDATE
SET
  status = EXCLUDED.status,
  biometric_verified = EXCLUDED.biometric_verified,
  remarks = EXCLUDED.remarks,
  marked_at = EXCLUDED.marked_at;

DROP TABLE IF EXISTS public.routine_slots CASCADE;

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

  /*
    Recalculate the selected date from all device logs. This makes repeated
    syncs safe and allows late-arriving punches to correct an absence.
  */
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
  'Creates one daily session per active class and synchronizes all punches for the selected date.';
