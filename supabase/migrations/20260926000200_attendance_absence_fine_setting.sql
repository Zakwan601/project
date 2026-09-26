/* Configurable per-day absence fine used by attendance reports. */
CREATE TABLE public.attendance_fine_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  fine_per_absent_day numeric(10, 2) NOT NULL DEFAULT 0
    CHECK (fine_per_absent_day >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.attendance_fine_settings (id, fine_per_absent_day)
VALUES (true, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER attendance_fine_settings_updated_at
  BEFORE UPDATE ON public.attendance_fine_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.attendance_fine_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.attendance_fine_settings FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.attendance_fine_settings TO authenticated;
GRANT ALL ON TABLE public.attendance_fine_settings TO service_role;

CREATE POLICY attendance_fine_settings_report_read
  ON public.attendance_fine_settings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.is_active = true
        AND (
          profile.role = 'admin'
          OR (
            profile.role = 'sub_admin'
            AND public.has_permission('reports', 'read')
          )
        )
    )
  );

CREATE POLICY attendance_fine_settings_admin_update
  ON public.attendance_fine_settings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active = true
    )
  )
  WITH CHECK (
    id = true
    AND fine_per_absent_day >= 0
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

COMMENT ON TABLE public.attendance_fine_settings IS
  'Singleton configuration for attendance-report absence fines.';
COMMENT ON COLUMN public.attendance_fine_settings.fine_per_absent_day IS
  'Fine in Bangladeshi taka charged for each absent attendance record; late and approved-leave records are excluded.';
