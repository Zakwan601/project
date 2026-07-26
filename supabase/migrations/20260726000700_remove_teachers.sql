/*
  Remove the teacher subsystem.

  Supabase Auth identities are retained, but their teacher profiles are deleted,
  so they can no longer access application data. Remove those Auth identities
  separately from Authentication > Users if they are no longer needed.
*/

DELETE FROM public.profiles
WHERE role = 'teacher';

DROP INDEX IF EXISTS public.classes_teacher_idx;

ALTER TABLE public.classes
  DROP COLUMN IF EXISTS teacher_id;

ALTER TABLE public.subjects
  DROP COLUMN IF EXISTS teacher_id;

DROP TABLE IF EXISTS public.teachers CASCADE;

DROP POLICY IF EXISTS "classes_update" ON public.classes;
CREATE POLICY "classes_update" ON public.classes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "students_select" ON public.students;
CREATE POLICY "students_select" ON public.students
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
    OR profile_id = auth.uid()
  );

DROP POLICY IF EXISTS "students_insert" ON public.students;
CREATE POLICY "students_insert" ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "students_update" ON public.students;
CREATE POLICY "students_update" ON public.students
  FOR UPDATE TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "subjects_insert" ON public.subjects;
CREATE POLICY "subjects_insert" ON public.subjects
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "subjects_update" ON public.subjects;
CREATE POLICY "subjects_update" ON public.subjects
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "sessions_select" ON public.attendance_sessions;
CREATE POLICY "sessions_select" ON public.attendance_sessions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.students AS student
      WHERE student.profile_id = auth.uid()
        AND student.class_id = attendance_sessions.class_id
    )
  );

DROP POLICY IF EXISTS "sessions_insert" ON public.attendance_sessions;
CREATE POLICY "sessions_insert" ON public.attendance_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "sessions_update" ON public.attendance_sessions;
CREATE POLICY "sessions_update" ON public.attendance_sessions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "records_select" ON public.attendance_records;
CREATE POLICY "records_select" ON public.attendance_records
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.students AS student
      WHERE student.profile_id = auth.uid()
        AND student.id = attendance_records.student_id
    )
  );

DROP POLICY IF EXISTS "records_insert" ON public.attendance_records;
CREATE POLICY "records_insert" ON public.attendance_records
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "records_update" ON public.attendance_records;
CREATE POLICY "records_update" ON public.attendance_records
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "records_delete" ON public.attendance_records;
CREATE POLICY "records_delete" ON public.attendance_records
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "devices_select" ON public.devices;
CREATE POLICY "devices_select" ON public.devices
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "device_logs_select" ON public.device_logs;
CREATE POLICY "device_logs_select" ON public.device_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
