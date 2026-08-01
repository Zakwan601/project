/*
  Device punches are Dhaka wall-clock values stored with a +00 offset. Keep the
  stored date and time exactly as received: an 01:40+00 punch means 01:40 AM
  for attendance purposes, not 13:40.

  The preceding normalization migration may already have run, so remove its
  trigger and restore existing attendance records from the immutable raw logs.
*/

DROP TRIGGER IF EXISTS attendance_records_normalize_biometric_punches
  ON public.attendance_records;

DROP FUNCTION IF EXISTS public.normalize_daily_biometric_attendance_record();
DROP FUNCTION IF EXISTS public.normalized_biometric_punch(timestamptz);

WITH raw_daily_punches AS (
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
  check_in_at = punches.check_in_at,
  check_out_at = punches.check_out_at,
  marked_at = punches.check_in_at,
  status = CASE
    WHEN (punches.check_in_at AT TIME ZONE 'UTC')::time <= TIME '09:00:00'
      THEN 'present'::attendance_status
    ELSE 'late'::attendance_status
  END,
  remarks = CASE
    WHEN (punches.check_in_at AT TIME ZONE 'UTC')::time <= TIME '09:00:00'
      THEN 'Synchronized from daily biometric punches'
    ELSE 'Late arrival after the 09:00 attendance cutoff'
  END
FROM raw_daily_punches AS punches
WHERE record.id = punches.attendance_record_id;

COMMENT ON COLUMN public.attendance_records.check_in_at IS
  'First raw biometric wall-clock punch; through 09:00 is present and after 09:00 is late.';

COMMENT ON COLUMN public.attendance_records.check_out_at IS
  'Second raw biometric wall-clock punch; NULL when departure is missing.';
