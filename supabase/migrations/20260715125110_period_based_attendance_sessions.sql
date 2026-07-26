/* Period-based attendance: add period_number to attendance_sessions and rewrite
   generate_attendance_sessions to create one session per routine slot per day. */

-- 1. Add period_number column
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS period_number integer;

-- 2. Drop old unique index (class_id, date, session_type) WHERE subject_id IS NULL
DROP INDEX IF EXISTS sessions_class_date_type_idx;

-- 3. Create new unique index on (class_id, date, period_number) to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS sessions_class_date_period_idx
  ON attendance_sessions(class_id, date, period_number)
  WHERE period_number IS NOT NULL;

-- 4. Also keep a unique index for non-period sessions (full_day/morning/afternoon)
CREATE UNIQUE INDEX IF NOT EXISTS sessions_class_date_type_noperiod_idx
  ON attendance_sessions(class_id, date, session_type)
  WHERE period_number IS NULL;

-- 5. Rewrite the generate function to create per-period sessions from routine_slots
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

    -- Skip Friday (5) and Saturday (6)
    IF dow IN (5, 6) THEN
      d := d + 1;
      CONTINUE;
    END IF;

    -- Skip holidays
    SELECT EXISTS(SELECT 1 FROM holidays WHERE date = d) INTO is_holiday;
    IF is_holiday THEN
      d := d + 1;
      CONTINUE;
    END IF;

    -- For each active class, create one session per routine slot for this day-of-week
    FOR cls IN SELECT id FROM classes WHERE is_active = true LOOP
      FOR slot IN
        SELECT period_number, subject_id, teacher_id, start_time, end_time, subject_name
        FROM routine_slots
        WHERE class_id = cls.id AND day_of_week = dow
        ORDER BY period_number
      LOOP
        INSERT INTO attendance_sessions (
          class_id, subject_id, date, session_type, source, is_finalized,
          period_number, taken_by, notes
        )
        VALUES (
          cls.id, slot.subject_id, d, 'period', 'system', false,
          slot.period_number, slot.teacher_id,
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
