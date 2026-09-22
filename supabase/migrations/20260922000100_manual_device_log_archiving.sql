-- Device log archiving is an explicit administrator action. This table records
-- administrator-selected archive cutoffs, allowing readers to route each date to
-- the correct database without assuming a fixed retention period.

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'archive-processed-device-logs'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.invoke_device_log_archive();

CREATE TABLE IF NOT EXISTS public.device_log_archive_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_before date NOT NULL,
  archived_rows integer NOT NULL DEFAULT 0 CHECK (archived_rows >= 0),
  deleted_rows integer NOT NULL DEFAULT 0 CHECK (deleted_rows >= 0),
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_log_archive_runs_cutoff_idx
  ON public.device_log_archive_runs (archive_before DESC, completed_at DESC);

ALTER TABLE public.device_log_archive_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view device log archive runs"
  ON public.device_log_archive_runs;
CREATE POLICY "Admins can view device log archive runs"
  ON public.device_log_archive_runs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
        AND profiles.is_active = true
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.device_log_archive_runs FROM anon, authenticated;
GRANT SELECT ON public.device_log_archive_runs TO authenticated;

CREATE OR REPLACE FUNCTION public.is_device_log_date_archived(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.device_log_archive_runs
    WHERE p_date < archive_before
  );
$$;

REVOKE ALL ON FUNCTION public.is_device_log_date_archived(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_device_log_date_archived(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_device_log_date_archived(date) TO service_role;

COMMENT ON TABLE public.device_log_archive_runs IS
  'Administrator-triggered device-log archive operations and their routing cutoffs.';
COMMENT ON FUNCTION public.is_device_log_date_archived(date) IS
  'Returns whether a punch date falls before a successfully completed manual archive cutoff.';

-- Remove the obsolete scheduler credential from Vault when it exists.
DELETE FROM vault.secrets WHERE name = 'device_log_archive_secret';
