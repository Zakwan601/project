-- Expose the too-late subset separately without changing absence totals or rates.
DO $$
DECLARE
  definition text;
  anchor text := '''lateToday'', COALESCE((SELECT late FROM today), 0),';
BEGIN
  SELECT pg_get_functiondef('public.get_admin_dashboard(date,date,date)'::regprocedure)
    INTO definition;
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'Expected dashboard stats expression was not found';
  END IF;
  EXECUTE replace(definition, anchor, anchor || $addition$
      'tooLateToday', (
        SELECT COUNT(record.id)
        FROM public.attendance_records AS record
        JOIN public.attendance_sessions AS session ON session.id = record.session_id
        WHERE session.date = p_today AND record.status = 'too_late'
      ),$addition$);
END;
$$;
