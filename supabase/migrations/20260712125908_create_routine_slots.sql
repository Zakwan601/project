/*
# Create routine_slots table for class timetables

## Purpose
Allows admin to create weekly routine/timetable for each class.
Each slot represents one period on a specific day for a specific class,
with an assigned subject and teacher.

Students can view their class routine (read-only).
Teachers can view routines for classes they teach.
Admin can create, update, and delete routine slots.

## New Tables

### routine_slots
- id: uuid primary key
- class_id: FK to classes
- day_of_week: integer (0=Sunday, 1=Monday, ..., 6=Saturday)
- period_number: integer (1-based period index within the day)
- start_time: time (start of the period)
- end_time: time (end of the period)
- subject_id: FK to subjects (nullable — allows free periods)
- teacher_id: FK to teachers (nullable — allows unassigned slots)
- room: text (optional override room for this slot)
- notes: text (optional notes)
- created_at, updated_at: timestamps

## Security
- RLS enabled on routine_slots
- SELECT: authenticated users (admin, teacher, student) — students see only their own class routine
- INSERT/UPDATE/DELETE: admin only
*/

CREATE TABLE IF NOT EXISTS routine_slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  day_of_week   integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  period_number integer NOT NULL CHECK (period_number >= 1 AND period_number <= 20),
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  subject_id    uuid REFERENCES subjects(id) ON DELETE SET NULL,
  teacher_id    uuid REFERENCES teachers(id) ON DELETE SET NULL,
  room          text,
  notes         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(class_id, day_of_week, period_number)
);

ALTER TABLE routine_slots ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS routine_slots_class_idx ON routine_slots(class_id);
CREATE INDEX IF NOT EXISTS routine_slots_class_day_idx ON routine_slots(class_id, day_of_week, period_number);

DROP TRIGGER IF EXISTS routine_slots_updated_at ON routine_slots;
CREATE TRIGGER routine_slots_updated_at BEFORE UPDATE ON routine_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- SELECT: admin and teacher can see all; students see only their own class routine
DROP POLICY IF EXISTS "routine_slots_select" ON routine_slots;
CREATE POLICY "routine_slots_select" ON routine_slots FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher'))
    OR EXISTS (
      SELECT 1 FROM students s
      WHERE s.profile_id = auth.uid() AND s.class_id = routine_slots.class_id
    )
  );

-- INSERT: admin only
DROP POLICY IF EXISTS "routine_slots_insert" ON routine_slots;
CREATE POLICY "routine_slots_insert" ON routine_slots FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- UPDATE: admin only
DROP POLICY IF EXISTS "routine_slots_update" ON routine_slots;
CREATE POLICY "routine_slots_update" ON routine_slots FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- DELETE: admin only
DROP POLICY IF EXISTS "routine_slots_delete" ON routine_slots;
CREATE POLICY "routine_slots_delete" ON routine_slots FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
