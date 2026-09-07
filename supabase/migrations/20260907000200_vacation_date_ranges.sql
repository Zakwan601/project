/* Add vacations for an inclusive date range while retaining one holiday row per
   working date, which keeps all existing holiday readers compatible. */

CREATE OR REPLACE FUNCTION public.mark_attendance_vacation_range(
  p_start_date date,
  p_end_date date,
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days_added integer := 0;
  v_existing_days integer := 0;
  v_weekend_days_skipped integer := 0;
  v_sessions_removed integer := 0;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_permission('vacations', 'write') THEN
    RAISE EXCEPTION 'Vacation write permission is required';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Vacation start and end dates are required';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Vacation end date must be on or after the start date';
  END IF;

  IF NULLIF(BTRIM(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Vacation name is required';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE EXTRACT(DOW FROM day)::integer IN (5, 6)),
    COUNT(*) FILTER (
      WHERE EXTRACT(DOW FROM day)::integer NOT IN (5, 6)
        AND EXISTS (SELECT 1 FROM public.holidays WHERE date = day::date)
    )
  INTO v_weekend_days_skipped, v_existing_days
  FROM generate_series(p_start_date, p_end_date, INTERVAL '1 day') AS dates(day);

  INSERT INTO public.holidays (date, name, description, created_by)
  SELECT
    day::date,
    BTRIM(p_name),
    NULLIF(BTRIM(p_description), ''),
    auth.uid()
  FROM generate_series(p_start_date, p_end_date, INTERVAL '1 day') AS dates(day)
  WHERE EXTRACT(DOW FROM day)::integer NOT IN (5, 6)
  ON CONFLICT (date) DO NOTHING;

  GET DIAGNOSTICS v_days_added = ROW_COUNT;

  IF v_days_added = 0 AND v_existing_days = 0 THEN
    RAISE EXCEPTION 'The selected range only contains Friday and Saturday weekend days';
  END IF;

  UPDATE public.device_logs
  SET processed = false,
      attendance_record_id = NULL
  WHERE (punched_at AT TIME ZONE 'Asia/Dhaka')::date
        BETWEEN p_start_date AND p_end_date;

  DELETE FROM public.attendance_sessions
  WHERE date BETWEEN p_start_date AND p_end_date;

  GET DIAGNOSTICS v_sessions_removed = ROW_COUNT;

  RETURN jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'days_added', v_days_added,
    'existing_days', v_existing_days,
    'weekend_days_skipped', v_weekend_days_skipped,
    'sessions_removed', v_sessions_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_attendance_vacation_range(date, date, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_attendance_vacation_range(date, date, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.mark_attendance_vacation_range(date, date, text, text) IS
  'Marks each working day in an inclusive range as vacation and removes attendance for the range.';
