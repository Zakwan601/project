/* Fix: taken_by references profiles(id), not teachers(id). Remove taken_by from
   auto-generated sessions (it gets set when a teacher actually takes attendance). */

DROP FUNCTION IF EXISTS generate_attendance_sessions(date);

CREATE FUNCTION generate_attendance_sessions(month_start date)
RETURNS TABLE(out_class_id uuid, out_session_date date, out_period_number integer, out_session_type text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  d date := month_start;
  month_end date := (month_start + INTERVAL '1 month' - INTERVAL '1 day');
  cls RECORD;
  slot RECORD;
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
      FOR slot IN
        SELECT period_number, subject_id, subject_name
        FROM routine_slots
        WHERE class_id = cls.id AND day_of_week = dow
        ORDER BY period_number
      LOOP
        INSERT INTO attendance_sessions (
          class_id, subject_id, date, session_type, source, is_finalized,
          period_number, notes
        )
        VALUES (
          cls.id, slot.subject_id, d, 'period', 'system', false,
          slot.period_number,
          COALESCE(slot.subject_name, 'Period ' || slot.period_number)
        )
        ON CONFLICT (class_id, date, period_number) WHERE period_number IS NOT NULL DO NOTHING;
      END LOOP;
    END LOOP;

    d := d + 1;
  END LOOP;

  RETURN QUERY
  SELECT s.class_id, s.date::date, s.period_number, s.session_type::text
  FROM attendance_sessions s
  WHERE s.date >= month_start AND s.date <= month_end
  ORDER BY s.date, s.period_number;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_attendance_sessions(date) TO authenticated;
