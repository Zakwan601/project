CREATE OR REPLACE FUNCTION public.get_daily_attendance_report(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  attendance_date date,
  present_count bigint,
  absent_count bigint,
  late_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    session.date AS attendance_date,
    COUNT(record.id) FILTER (WHERE record.status = 'present') AS present_count,
    COUNT(record.id) FILTER (WHERE record.status = 'absent') AS absent_count,
    COUNT(record.id) FILTER (WHERE record.status = 'late') AS late_count
  FROM public.attendance_sessions AS session
  LEFT JOIN public.attendance_records AS record
    ON record.session_id = session.id
  WHERE session.date BETWEEN p_start_date AND p_end_date
  GROUP BY session.date
  ORDER BY session.date;
$$;

REVOKE ALL ON FUNCTION public.get_daily_attendance_report(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_attendance_report(date, date) TO authenticated;

COMMENT ON FUNCTION public.get_daily_attendance_report(date, date) IS
  'Returns daily attendance status counts for a date range in one request.';