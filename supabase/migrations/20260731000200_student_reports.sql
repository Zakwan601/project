CREATE TABLE IF NOT EXISTS public.student_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('attendance', 'academic', 'safety', 'technical', 'other')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 120),
  message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'reviewed', 'resolved')),
  admin_read_at timestamptz,
  discord_delivered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_reports_student_created_idx
  ON public.student_reports (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS student_reports_admin_unread_idx
  ON public.student_reports (admin_read_at, created_at DESC);

DROP TRIGGER IF EXISTS student_reports_updated_at ON public.student_reports;
CREATE TRIGGER student_reports_updated_at
  BEFORE UPDATE ON public.student_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.student_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_reports_select" ON public.student_reports;
CREATE POLICY "student_reports_select" ON public.student_reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.students
      WHERE id = student_reports.student_id AND profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "student_reports_insert" ON public.student_reports;
CREATE POLICY "student_reports_insert" ON public.student_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE id = student_reports.student_id
        AND profile_id = auth.uid()
        AND is_active = true
    )
  );

DROP POLICY IF EXISTS "student_reports_admin_update" ON public.student_reports;
CREATE POLICY "student_reports_admin_update" ON public.student_reports
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

GRANT SELECT ON public.student_reports TO authenticated;
GRANT UPDATE ON public.student_reports TO authenticated;
REVOKE INSERT ON public.student_reports FROM authenticated;
GRANT ALL ON public.student_reports TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'student_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.student_reports;
  END IF;
END;
$$;

COMMENT ON TABLE public.student_reports IS
  'Student-submitted reports delivered to administrators and Discord.';
