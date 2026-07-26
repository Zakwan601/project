/* Simplify generate_attendance_sessions: single set-based INSERT instead of nested loops */
DROP FUNCTION IF EXISTS generate_attendance_sessions(date);

CREATE FUNCTION generate_attendance_sessions(month_start date)
RETURNS TABLE(out_class_id uuid, out_session_date date, out_period_number integer, out_session_type text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO attendance_sessions (
    class_id, subject_id, date, session_type, source, is_finalized, period_number, notes
  )
  SELECT
    c.id,
    rs.subject_id,
    d::date,
    'period',
    'system',
    false,
    rs.period_number,
    COALESCE(rs.subject_name, 'Period ' || rs.period_number)
  FROM generate_series(month_start, month_start + INTERVAL '1 month' - INTERVAL '1 day', INTERVAL '1 day') AS d
  CROSS JOIN classes c
  JOIN routine_slots rs ON rs.class_id = c.id AND rs.day_of_week = EXTRACT(DOW FROM d)::int
  WHERE c.is_active = true
    AND EXTRACT(DOW FROM d)::int NOT IN (5, 6)
    AND NOT EXISTS (SELECT 1 FROM holidays WHERE date = d::date)
  ON CONFLICT (class_id, date, period_number) WHERE period_number IS NOT NULL DO NOTHING;

  RETURN QUERY
  SELECT s.class_id, s.date::date, s.period_number, s.session_type::text
  FROM attendance_sessions s
  WHERE s.date >= month_start AND s.date <= month_end
  ORDER BY s.date, s.period_number;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_attendance_sessions(date) TO authenticated;
