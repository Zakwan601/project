/*
  Daily Attendance non-school days

  - Friday and Saturday are automatic weekends.
  - Admins can add any other date to holidays as a vacation.
  - Attendance sessions/records cannot exist for either kind of non-school day,
    keeping summaries and percentages accurate.
*/

CREATE OR REPLACE FUNCTION public.prevent_non_school_day_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXTRACT(DOW FROM NEW.date)::integer IN (5, 6)
     OR EXISTS (
       SELECT 1
       FROM public.holidays
       WHERE date = NEW.date
     )
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_sessions_non_school_day ON public.attendance_sessions;
DROP TRIGGER IF EXISTS attendance_sessions_non_school_day_insert ON public.attendance_sessions;
DROP TRIGGER IF EXISTS attendance_sessions_non_school_day_update ON public.attendance_sessions;

CREATE TRIGGER attendance_sessions_non_school_day_insert
  BEFORE INSERT ON public.attendance_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_non_school_day_attendance();

CREATE TRIGGER attendance_sessions_non_school_day_update
  BEFORE UPDATE OF date ON public.attendance_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_non_school_day_attendance();

CREATE OR REPLACE FUNCTION public.mark_attendance_vacation(
  p_date date,
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_holiday_id uuid;
  v_sessions_removed integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active administrator can add a vacation';
  END IF;

  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Vacation date is required';
  END IF;

  IF EXTRACT(DOW FROM p_date)::integer IN (5, 6) THEN
    RAISE EXCEPTION 'Friday and Saturday are already weekends';
  END IF;

  IF NULLIF(BTRIM(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Vacation name is required';
  END IF;

  INSERT INTO public.holidays (date, name, description, created_by)
  VALUES (p_date, BTRIM(p_name), NULLIF(BTRIM(p_description), ''), auth.uid())
  RETURNING id INTO v_holiday_id;

  UPDATE public.device_logs
  SET processed = false,
      attendance_record_id = NULL
  WHERE (punched_at AT TIME ZONE 'UTC')::date = p_date;

  DELETE FROM public.attendance_sessions
  WHERE date = p_date;

  GET DIAGNOSTICS v_sessions_removed = ROW_COUNT;

  RETURN jsonb_build_object(
    'date', p_date,
    'holiday_id', v_holiday_id,
    'sessions_removed', v_sessions_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_attendance_vacation(date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_attendance_vacation(date, text, text) TO authenticated;

COMMENT ON FUNCTION public.mark_attendance_vacation(date, text, text) IS
  'Marks a working date as vacation and removes attendance so it is not counted.';

/*
  Repair any attendance that was previously created on automatic weekends or
  dates already listed in holidays.
*/
UPDATE public.device_logs AS log
SET processed = false,
    attendance_record_id = NULL
WHERE EXTRACT(DOW FROM (log.punched_at AT TIME ZONE 'UTC')::date)::integer IN (5, 6)
   OR EXISTS (
     SELECT 1
     FROM public.holidays
     WHERE date = (log.punched_at AT TIME ZONE 'UTC')::date
   );

DELETE FROM public.attendance_sessions AS session
WHERE EXTRACT(DOW FROM session.date)::integer IN (5, 6)
   OR EXISTS (
     SELECT 1
     FROM public.holidays
     WHERE date = session.date
   );
