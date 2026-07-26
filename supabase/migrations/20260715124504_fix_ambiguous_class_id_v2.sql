/* Fix ambiguous column reference by renaming output columns to avoid collision with table columns */
DROP FUNCTION IF EXISTS generate_attendance_sessions(date);

CREATE FUNCTION generate_attendance_sessions(month_start date)
RETURNS TABLE(out_class_id uuid, out_session_date date, out_session_type text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  d date := month_start;
  month_end date := (month_start + INTERVAL '1 month' - INTERVAL '1 day');
  cls RECORD;
  is_holiday boolean;
  dow integer;
BEGIN
  WHILE d <= month_end LOOP
    dow := EXTRACT(DOW FROM d);

    IF dow IN (5, 6) THEN
      d := d + 1;
      CONTINUE;
    END IF;

    SELECT EXISTS(SELECT 1 FROM holidays WHERE date = d) INTO is_holiday;
    IF is_holiday THEN
      d := d + 1;
      CONTINUE;
    END IF;

    FOR cls IN SELECT id FROM classes WHERE is_active = true LOOP
      INSERT INTO attendance_sessions (class_id, date, session_type, source, is_finalized)
      VALUES (cls.id, d, 'full_day', 'system', false)
      ON CONFLICT (class_id, date, session_type) WHERE subject_id IS NULL DO NOTHING;
    END LOOP;

    d := d + 1;
  END LOOP;

  RETURN QUERY
  SELECT s.class_id, s.date::date, s.session_type::text
  FROM attendance_sessions s
  WHERE s.date >= month_start AND s.date <= month_end
  ORDER BY s.date;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_attendance_sessions(date) TO authenticated;
