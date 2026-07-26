/*
  Allow students to see only the raw biometric punches whose biometric user ID
  matches their own admission number. Admin access remains unchanged.
*/

DROP POLICY IF EXISTS "device_logs_select" ON public.device_logs;
CREATE POLICY "device_logs_select" ON public.device_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.students AS student
      WHERE student.profile_id = auth.uid()
        AND student.admission_number = device_logs.student_biometric_id
    )
  );
