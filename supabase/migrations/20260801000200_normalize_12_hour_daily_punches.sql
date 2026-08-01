/*
  The biometric device stores a 12-hour display value without an AM/PM marker.
  For a school day, 00:00-05:59 values are afternoon departures and are
  interpreted as 12:00-17:59. Times from 06:00 onward remain unchanged.

  Raw device_logs are never modified; only attendance check-in/check-out values
  are normalized.
*/

CREATE OR REPLACE FUNCTION public.normalized_biometric_punch(p_punched_at timestamptz)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN (p_punched_at AT TIME ZONE 'UTC')::time < TIME '06:00:00'
      THEN p_punched_at + INTERVAL '12 hours'
    ELSE p_punched_at
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_daily_biometric_attendance_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_date date;
  v_punches timestamptz[];
BEGIN
  IF NEW.biometric_verified IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT date
  INTO v_session_date
  FROM public.attendance_sessions
  WHERE id = NEW.session_id;

  SELECT ARRAY_AGG(
    public.normalized_biometric_punch(log.punched_at)
    ORDER BY public.normalized_biometric_punch(log.punched_at), log.id
  )
  INTO v_punches
  FROM public.students AS student
  JOIN public.device_logs AS log
    ON log.student_biometric_id = student.admission_number
  WHERE student.id = NEW.student_id
    AND (log.punched_at AT TIME ZONE 'UTC')::date = v_session_date;

  IF COALESCE(cardinality(v_punches), 0) = 0 THEN
    RETURN NEW;
  END IF;

  NEW.check_in_at := v_punches[1];
  NEW.check_out_at := v_punches[2];
  NEW.marked_at := v_punches[1];

  IF (NEW.check_in_at AT TIME ZONE 'UTC')::time <= TIME '09:00:00' THEN
    NEW.status := 'present'::attendance_status;
    NEW.remarks := 'Synchronized from daily biometric punches';
  ELSE
    NEW.status := 'late'::attendance_status;
    NEW.remarks := 'Late arrival after the 09:00 attendance cutoff';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_records_normalize_biometric_punches
  ON public.attendance_records;

CREATE TRIGGER attendance_records_normalize_biometric_punches
  BEFORE INSERT OR UPDATE OF biometric_verified, check_in_at, check_out_at
  ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_daily_biometric_attendance_record();

/* Recalculate existing biometric records with the corrected daily ordering. */
UPDATE public.attendance_records
SET check_in_at = check_in_at
WHERE biometric_verified = true;

REVOKE ALL ON FUNCTION public.normalized_biometric_punch(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalized_biometric_punch(timestamptz) TO authenticated;

COMMENT ON FUNCTION public.normalized_biometric_punch(timestamptz) IS
  'Interprets ambiguous 00:00-05:59 device values as afternoon times without changing raw logs.';
