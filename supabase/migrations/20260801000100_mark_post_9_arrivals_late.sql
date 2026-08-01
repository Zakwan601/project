/*
  A student's first biometric punch determines the daily arrival status:

  - through 09:00:00: present
  - after 09:00:00: late
  - no punch: absent

  Device punch timestamps continue to use the same stored UTC wall-clock
  interpretation as sync_daily_attendance.
*/

CREATE OR REPLACE FUNCTION public.mark_post_9_biometric_arrival_late()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.biometric_verified = true
     AND NEW.check_in_at IS NOT NULL
     AND (NEW.check_in_at AT TIME ZONE 'UTC')::time > TIME '09:00:00'
  THEN
    NEW.status := 'late'::attendance_status;
    NEW.remarks := 'Late arrival after the 09:00 attendance cutoff';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_records_post_9_arrival_late
  ON public.attendance_records;

CREATE TRIGGER attendance_records_post_9_arrival_late
  BEFORE INSERT OR UPDATE OF status, biometric_verified, check_in_at
  ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_post_9_biometric_arrival_late();

/* Correct attendance that was synchronized under the previous absent rule. */
UPDATE public.attendance_records
SET
  status = 'late'::attendance_status,
  remarks = 'Late arrival after the 09:00 attendance cutoff'
WHERE biometric_verified = true
  AND check_in_at IS NOT NULL
  AND (check_in_at AT TIME ZONE 'UTC')::time > TIME '09:00:00';

COMMENT ON FUNCTION public.mark_post_9_biometric_arrival_late() IS
  'Converts biometric attendance with a first punch after 09:00 from absent to late.';

COMMENT ON COLUMN public.attendance_records.check_in_at IS
  'First matched biometric punch; through 09:00 is present and after 09:00 is late.';

