ALTER TABLE public.student_reports
  ADD COLUMN IF NOT EXISTS admin_unread boolean NOT NULL DEFAULT true;

UPDATE public.student_reports
SET admin_unread = (admin_read_at IS NULL)
WHERE admin_unread IS DISTINCT FROM (admin_read_at IS NULL);

CREATE OR REPLACE FUNCTION public.sync_student_report_admin_unread()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.admin_unread := NEW.admin_read_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS student_reports_admin_unread ON public.student_reports;
CREATE TRIGGER student_reports_admin_unread
  BEFORE INSERT OR UPDATE OF admin_read_at
  ON public.student_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_student_report_admin_unread();

CREATE UNIQUE INDEX IF NOT EXISTS student_reports_realtime_unread_identity_idx
  ON public.student_reports (id, admin_unread);

ALTER TABLE public.student_reports
  REPLICA IDENTITY USING INDEX student_reports_realtime_unread_identity_idx;

COMMENT ON COLUMN public.student_reports.admin_unread IS
  'Non-sensitive realtime identity flag kept in sync with admin_read_at.';
