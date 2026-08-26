/* Change the biometric late-arrival cutoff prospectively to 08:20 Asia/Dhaka. */

CREATE OR REPLACE FUNCTION public.classify_biometric_arrival_cutoff()
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
     AND (NEW.check_in_at AT TIME ZONE 'Asia/Dhaka')::date >= DATE '2026-08-26'
     AND (NEW.check_in_at AT TIME ZONE 'Asia/Dhaka')::time > TIME '08:20:00'
  THEN
    NEW.status := 'late'::public.attendance_status;
    NEW.remarks := 'Late arrival after the 08:20 attendance cutoff';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_records_post_9_arrival_late
  ON public.attendance_records;
DROP TRIGGER IF EXISTS attendance_records_arrival_cutoff
  ON public.attendance_records;

CREATE TRIGGER attendance_records_arrival_cutoff
  BEFORE INSERT OR UPDATE OF status, biometric_verified, check_in_at
  ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.classify_biometric_arrival_cutoff();

/* Align records from the effective date onward, preserving audited corrections. */
UPDATE public.attendance_records
SET
  status = 'late'::public.attendance_status,
  remarks = 'Late arrival after the 08:20 attendance cutoff'
WHERE biometric_verified = true
  AND check_in_at IS NOT NULL
  AND manually_corrected = false
  AND (check_in_at AT TIME ZONE 'Asia/Dhaka')::date >= DATE '2026-08-26'
  AND (check_in_at AT TIME ZONE 'Asia/Dhaka')::time > TIME '08:20:00';

DROP FUNCTION IF EXISTS public.mark_post_9_biometric_arrival_late();

COMMENT ON FUNCTION public.classify_biometric_arrival_cutoff() IS
  'Classifies biometric arrivals after 08:20 Asia/Dhaka as late from 2026-08-26 onward.';

COMMENT ON COLUMN public.attendance_records.check_in_at IS
  'First matched biometric punch; from 2026-08-26, arrival through 08:20 Asia/Dhaka is on time and a later arrival is late.';
