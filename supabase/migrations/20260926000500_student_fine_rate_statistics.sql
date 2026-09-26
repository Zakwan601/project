/* Return the configured fine rate with student attendance statistics. */
CREATE FUNCTION public.add_student_fine_rate_to_statistics()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_definition text;
  v_old text := '''totalSessions'', overall.present + overall.late + overall.excused + overall.absent,';
  v_new text := '''totalSessions'', overall.present + overall.late + overall.excused + overall.absent,
      ''finePerAbsentDay'', COALESCE((
        SELECT setting.fine_per_absent_day
        FROM public.attendance_fine_settings AS setting
        WHERE setting.id = true
      ), 0),';
BEGIN
  SELECT pg_get_functiondef('public.get_student_attendance_statistics(uuid)'::regprocedure)
  INTO v_definition;

  IF strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Expected student attendance statistics output was not found';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$$;

SELECT public.add_student_fine_rate_to_statistics();
DROP FUNCTION public.add_student_fine_rate_to_statistics();

COMMENT ON FUNCTION public.get_student_attendance_statistics(uuid) IS
  'Returns grouped lifetime and subject attendance statistics, including the configured per-absence fine rate.';
