/*
  Consolidated Supabase schema for the school attendance project.
  Generated from migrations on 2026-07-20.

  Includes:
  - enum types
  - all application tables
  - indexes, triggers, RLS policies, and grants
  - current function definitions

  Run in a fresh Supabase project's SQL editor.
*/
/*
# School Attendance Management System â€” Initial Schema

## Overview
Full schema for a production-ready school attendance system with biometric device
integration readiness (ZKTeco MB10-VL). Supports three roles: admin, teacher, student.

## Tables

### 1. profiles
Extends auth.users with role and profile data. All authenticated users have a profile.
- id: matches auth.users.id
- role: admin | teacher | student
- full_name, avatar_url, phone, address

### 2. teachers
Teacher-specific data linked to profiles.
- employee_id, subject, qualification, date_of_joining, is_active

### 3. academic_years
Represents a school year (e.g., 2024-2025).
- name, start_date, end_date, is_current

### 4. classes
School classes/sections linked to an academic year and assigned teacher.
- name, grade, section, academic_year_id, teacher_id (class teacher), capacity

### 5. students
Student-specific data linked to profiles and enrolled in a class.
- admission_number, class_id, roll_number, date_of_birth, guardian_name,
  guardian_phone, date_of_admission, biometric_id (for ZKTeco device integration),
  is_active

### 6. subjects
Subjects taught in a class.
- name, code, class_id, teacher_id (subject teacher)

### 7. attendance_sessions
A specific attendance-taking event (class period or day) for a class.
- class_id, subject_id (nullable â€” for period-wise), date, session_type (morning/afternoon/period),
  taken_by (teacher), source (manual | biometric), is_finalized

### 8. attendance_records
Individual student attendance for a session.
- session_id, student_id, status (present | absent | late | excused),
  biometric_verified, remarks, marked_at

### 9. devices
Biometric devices (ZKTeco MB10-VL and others).
- device_id (hardware serial), name, location, ip_address, port,
  model, is_active, last_sync_at

### 10. device_logs
Raw attendance logs from biometric devices (pre-processed).
- device_id, student_biometric_id, punched_at, processed (whether matched to a record)

## Security
- RLS enabled on all tables
- Policies scoped to authenticated users by role
- Admin: full access to everything
- Teacher: read all, write attendance for their classes, manage students in their classes
- Student: read their own data only

## Biometric Integration Notes
- students.biometric_id: the fingerprint/face template ID on the ZKTeco device
- device_logs: raw punches from the device (synced via edge function later)
- attendance_records.biometric_verified: flag set when a record was auto-matched from a device_log
*/

-- ============================================================
-- ENUM TYPES
-- ============================================================
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'student');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE session_type AS ENUM ('morning', 'afternoon', 'period', 'full_day');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE attendance_source AS ENUM ('manual', 'biometric');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        user_role NOT NULL DEFAULT 'student',
  full_name   text NOT NULL DEFAULT '',
  avatar_url  text,
  phone       text,
  address     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.role = 'admin')
  )
  WITH CHECK (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.role = 'admin')
  );

DROP POLICY IF EXISTS "profiles_delete" ON profiles;
CREATE POLICY "profiles_delete" ON profiles FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.role = 'admin'));

-- Auto-create profile on sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'student')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ACADEMIC YEARS
-- ============================================================
CREATE TABLE IF NOT EXISTS academic_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "academic_years_select" ON academic_years;
CREATE POLICY "academic_years_select" ON academic_years FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "academic_years_insert" ON academic_years;
CREATE POLICY "academic_years_insert" ON academic_years FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "academic_years_update" ON academic_years;
CREATE POLICY "academic_years_update" ON academic_years FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "academic_years_delete" ON academic_years;
CREATE POLICY "academic_years_delete" ON academic_years FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- TEACHERS
-- ============================================================
CREATE TABLE IF NOT EXISTS teachers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  employee_id       text UNIQUE NOT NULL,
  department        text,
  qualification     text,
  date_of_joining   date,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS teachers_profile_id_idx ON teachers(profile_id);

DROP TRIGGER IF EXISTS teachers_updated_at ON teachers;
CREATE TRIGGER teachers_updated_at BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "teachers_select" ON teachers;
CREATE POLICY "teachers_select" ON teachers FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "teachers_insert" ON teachers;
CREATE POLICY "teachers_insert" ON teachers FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin')));

DROP POLICY IF EXISTS "teachers_update" ON teachers;
CREATE POLICY "teachers_update" ON teachers FOR UPDATE TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "teachers_delete" ON teachers;
CREATE POLICY "teachers_delete" ON teachers FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- CLASSES
-- ============================================================
CREATE TABLE IF NOT EXISTS classes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  grade            text NOT NULL,
  section          text NOT NULL DEFAULT 'A',
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  teacher_id       uuid REFERENCES teachers(id) ON DELETE SET NULL,
  capacity         integer NOT NULL DEFAULT 40,
  room             text,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS classes_academic_year_idx ON classes(academic_year_id);
CREATE INDEX IF NOT EXISTS classes_teacher_idx ON classes(teacher_id);

DROP TRIGGER IF EXISTS classes_updated_at ON classes;
CREATE TRIGGER classes_updated_at BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "classes_select" ON classes;
CREATE POLICY "classes_select" ON classes FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "classes_insert" ON classes;
CREATE POLICY "classes_insert" ON classes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "classes_update" ON classes;
CREATE POLICY "classes_update" ON classes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher')));

DROP POLICY IF EXISTS "classes_delete" ON classes;
CREATE POLICY "classes_delete" ON classes FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- STUDENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS students (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  admission_number   text UNIQUE NOT NULL,
  class_id           uuid REFERENCES classes(id) ON DELETE SET NULL,
  roll_number        integer,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  date_of_birth      date,
  gender             text,
  guardian_name      text,
  guardian_phone     text,
  guardian_email     text,
  address            text,
  date_of_admission  date NOT NULL DEFAULT CURRENT_DATE,
  biometric_id       text UNIQUE,
  photo_url          text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS students_class_id_idx ON students(class_id);
CREATE INDEX IF NOT EXISTS students_profile_id_idx ON students(profile_id);
CREATE INDEX IF NOT EXISTS students_biometric_id_idx ON students(biometric_id);

DROP TRIGGER IF EXISTS students_updated_at ON students;
CREATE TRIGGER students_updated_at BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "students_select" ON students;
CREATE POLICY "students_select" ON students FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher'))
    OR profile_id = auth.uid()
  );

DROP POLICY IF EXISTS "students_insert" ON students;
CREATE POLICY "students_insert" ON students FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher')));

DROP POLICY IF EXISTS "students_update" ON students;
CREATE POLICY "students_update" ON students FOR UPDATE TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher'))
  );

DROP POLICY IF EXISTS "students_delete" ON students;
CREATE POLICY "students_delete" ON students FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- SUBJECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS subjects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  code       text NOT NULL,
  class_id   uuid REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS subjects_class_id_idx ON subjects(class_id);

DROP POLICY IF EXISTS "subjects_select" ON subjects;
CREATE POLICY "subjects_select" ON subjects FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "subjects_insert" ON subjects;
CREATE POLICY "subjects_insert" ON subjects FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher')));

DROP POLICY IF EXISTS "subjects_update" ON subjects;
CREATE POLICY "subjects_update" ON subjects FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher')));

DROP POLICY IF EXISTS "subjects_delete" ON subjects;
CREATE POLICY "subjects_delete" ON subjects FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- ATTENDANCE SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id   uuid REFERENCES subjects(id) ON DELETE SET NULL,
  date         date NOT NULL,
  session_type session_type NOT NULL DEFAULT 'full_day',
  taken_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  source       attendance_source NOT NULL DEFAULT 'manual',
  is_finalized boolean NOT NULL DEFAULT false,
  notes        text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS sessions_class_date_idx ON attendance_sessions(class_id, date);
CREATE INDEX IF NOT EXISTS sessions_date_idx ON attendance_sessions(date);

DROP TRIGGER IF EXISTS sessions_updated_at ON attendance_sessions;
CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "sessions_select" ON attendance_sessions;
CREATE POLICY "sessions_select" ON attendance_sessions FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher'))
    OR EXISTS (
      SELECT 1 FROM students s
      WHERE s.profile_id = auth.uid() AND s.class_id = attendance_sessions.class_id
    )
  );

DROP POLICY IF EXISTS "sessions_insert" ON attendance_sessions;
CREATE POLICY "sessions_insert" ON attendance_sessions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher')));

DROP POLICY IF EXISTS "sessions_update" ON attendance_sessions;
CREATE POLICY "sessions_update" ON attendance_sessions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher')));

DROP POLICY IF EXISTS "sessions_delete" ON attendance_sessions;
CREATE POLICY "sessions_delete" ON attendance_sessions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- ATTENDANCE RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id         uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status             attendance_status NOT NULL DEFAULT 'absent',
  biometric_verified boolean NOT NULL DEFAULT false,
  remarks            text,
  marked_at          timestamptz DEFAULT now(),
  created_at         timestamptz DEFAULT now(),
  UNIQUE(session_id, student_id)
);

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS records_session_idx ON attendance_records(session_id);
CREATE INDEX IF NOT EXISTS records_student_idx ON attendance_records(student_id);

DROP POLICY IF EXISTS "records_select" ON attendance_records;
CREATE POLICY "records_select" ON attendance_records FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher'))
    OR EXISTS (
      SELECT 1 FROM students s
      WHERE s.profile_id = auth.uid() AND s.id = attendance_records.student_id
    )
  );

DROP POLICY IF EXISTS "records_insert" ON attendance_records;
CREATE POLICY "records_insert" ON attendance_records FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher')));

DROP POLICY IF EXISTS "records_update" ON attendance_records;
CREATE POLICY "records_update" ON attendance_records FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher')));

DROP POLICY IF EXISTS "records_delete" ON attendance_records;
CREATE POLICY "records_delete" ON attendance_records FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher')));

-- ============================================================
-- DEVICES (ZKTeco MB10-VL ready)
-- ============================================================
CREATE TABLE IF NOT EXISTS devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_serial text UNIQUE NOT NULL,
  name          text NOT NULL,
  location      text,
  ip_address    text,
  port          integer DEFAULT 4370,
  model         text DEFAULT 'ZKTeco MB10-VL',
  is_active     boolean NOT NULL DEFAULT true,
  last_sync_at  timestamptz,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS devices_updated_at ON devices;
CREATE TRIGGER devices_updated_at BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "devices_select" ON devices;
CREATE POLICY "devices_select" ON devices FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher')));

DROP POLICY IF EXISTS "devices_insert" ON devices;
CREATE POLICY "devices_insert" ON devices FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "devices_update" ON devices;
CREATE POLICY "devices_update" ON devices FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "devices_delete" ON devices;
CREATE POLICY "devices_delete" ON devices FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- DEVICE LOGS (raw punches from biometric devices)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id            uuid REFERENCES devices(id) ON DELETE CASCADE,
  student_biometric_id text NOT NULL,
  punched_at           timestamptz NOT NULL,
  processed            boolean NOT NULL DEFAULT false,
  attendance_record_id uuid REFERENCES attendance_records(id) ON DELETE SET NULL,
  raw_data             jsonb,
  created_at           timestamptz DEFAULT now()
);

ALTER TABLE device_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS device_logs_biometric_idx ON device_logs(student_biometric_id);
CREATE INDEX IF NOT EXISTS device_logs_punched_at_idx ON device_logs(punched_at);
CREATE INDEX IF NOT EXISTS device_logs_processed_idx ON device_logs(processed);

DROP POLICY IF EXISTS "device_logs_select" ON device_logs;
CREATE POLICY "device_logs_select" ON device_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM students AS student
      WHERE student.profile_id = auth.uid()
        AND student.admission_number = device_logs.student_biometric_id
    )
  );

DROP POLICY IF EXISTS "device_logs_insert" ON device_logs;
CREATE POLICY "device_logs_insert" ON device_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "device_logs_update" ON device_logs;
CREATE POLICY "device_logs_update" ON device_logs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "device_logs_delete" ON device_logs;
CREATE POLICY "device_logs_delete" ON device_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

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
- subject_id: FK to subjects (nullable â€” allows free periods)
- teacher_id: FK to teachers (nullable â€” allows unassigned slots)
- room: text (optional override room for this slot)
- notes: text (optional notes)
- created_at, updated_at: timestamps

## Security
- RLS enabled on routine_slots
- SELECT: authenticated users (admin, teacher, student) â€” students see only their own class routine
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
  subject_name  text,
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

/*
# Holidays table + auto-generate attendance sessions

## Purpose
1. `holidays` table â€” admin can mark any date as a holiday. No absence is counted on holidays.
2. `generate_attendance_sessions(month_start date)` function â€” auto-creates attendance_sessions
   for every active class for every working day (Sunâ€“Thu) in the given month.
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

-- Auto-generated attendance sessions use the system source.
DO $$ BEGIN
  ALTER TYPE attendance_source ADD VALUE IF NOT EXISTS 'system';
END $$;
-- Add period support to attendance sessions.
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS period_number integer;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_class_date_period_idx
  ON attendance_sessions(class_id, date, period_number)
  WHERE period_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_class_date_type_noperiod_idx
  ON attendance_sessions(class_id, date, session_type)
  WHERE period_number IS NULL;

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
  WHERE s.date >= month_start
    AND s.date <= month_start + INTERVAL '1 month' - INTERVAL '1 day'
  ORDER BY s.date, s.period_number;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_attendance_sessions(date) TO authenticated;
