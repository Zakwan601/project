/*
# Holidays table + auto-generate attendance sessions

## Purpose
1. `holidays` table — admin can mark any date as a holiday. No absence is counted on holidays.
2. `generate_attendance_sessions(month_start date)` function — auto-creates attendance_sessions
   for every active class for every working day (Sun–Thu) in the given month.
   Fridays and Saturdays are skipped as off days. Holidays are also skipped.
   Existing sessions are not duplicated (ON CONFLICT DO NOTHING).

## How auto-generation works
- Admin calls the function (via the UI "Generate Month" button) with the first day of a month.
- The function iterates all days in that month, skips Friday (5) and Saturday (6).
- For each remaining day, it checks if a holiday exists; if so, skips.
- For each active class, it inserts a `full_day` session with `source = 'system'`.
- A unique constraint on (class_id, date, session_type) prevents duplicates.
*/

-- ============================================================
-- HOLIDAYS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS holidays_updated_at ON holidays;
CREATE TRIGGER holidays_updated_at BEFORE UPDATE ON holidays
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Everyone authenticated can see holidays; only admin can manage
DROP POLICY IF EXISTS "holidays_select" ON holidays;
CREATE POLICY "holidays_select" ON holidays FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "holidays_insert" ON holidays;
CREATE POLICY "holidays_insert" ON holidays FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "holidays_update" ON holidays;
CREATE POLICY "holidays_update" ON holidays FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "holidays_delete" ON holidays;
CREATE POLICY "holidays_delete" ON holidays FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- UNIQUE CONSTRAINT on attendance_sessions to prevent duplicates
-- ============================================================
DROP INDEX IF EXISTS sessions_class_date_type_idx;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_class_date_type_idx
  ON attendance_sessions(class_id, date, session_type)
  WHERE subject_id IS NULL;

-- ============================================================
-- AUTO-GENERATE ATTENDANCE SESSIONS FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION generate_attendance_sessions(month_start date)
RETURNS TABLE(class_id uuid, session_date date, session_type text)
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

    -- Create a full_day session for every active class
    FOR cls IN SELECT id FROM classes WHERE is_active = true LOOP
      INSERT INTO attendance_sessions (class_id, date, session_type, source, is_finalized)
      VALUES (cls.id, d, 'full_day', 'system', false)
      ON CONFLICT (class_id, date, session_type) WHERE subject_id IS NULL DO NOTHING;
    END LOOP;

    d := d + 1;
  END LOOP;

  RETURN QUERY
  SELECT class_id, date::date, session_type::text
  FROM attendance_sessions
  WHERE date >= month_start AND date <= month_end
  ORDER BY date;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION generate_attendance_sessions(date) TO authenticated;
