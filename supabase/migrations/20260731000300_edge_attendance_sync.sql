/*
  Edge-based daily attendance synchronization.

  - The existing authenticated RPC remains available for compatibility.
  - The edge function receives service requests and invokes the service-only wrapper.
  - A midnight Asia/Dhaka cron invokes the edge endpoint even when there are no punches.
*/

CREATE OR REPLACE FUNCTION public.sync_daily_attendance_as_service(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  /*
    sync_daily_attendance deliberately requires auth.uid(). Give the nested call
    an active application identity while keeping this wrapper executable only by
    service_role. The setting is transaction-local and disappears after the RPC.
  */
  SELECT id
  INTO v_profile_id
  FROM public.profiles
  WHERE is_active = true
  ORDER BY (role = 'admin') DESC, created_at
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'At least one active profile is required to synchronize attendance';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_profile_id, 'role', 'authenticated')::text,
    true
  );

  RETURN public.sync_daily_attendance(p_date);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_daily_attendance_as_service(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_daily_attendance_as_service(date) FROM anon;
REVOKE ALL ON FUNCTION public.sync_daily_attendance_as_service(date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_daily_attendance_as_service(date) TO service_role;

COMMENT ON FUNCTION public.sync_daily_attendance_as_service(date) IS
  'Service-role-only entry point used by the sync-attendance edge function.';

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE OR REPLACE FUNCTION public.invoke_attendance_day_start()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_url text;
  v_sync_secret text;
BEGIN
  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT decrypted_secret INTO v_sync_secret
  FROM vault.decrypted_secrets
  WHERE name = 'attendance_sync_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NULLIF(v_project_url, '') IS NULL OR NULLIF(v_sync_secret, '') IS NULL THEN
    RAISE WARNING 'Attendance day-start skipped: configure project_url and attendance_sync_secret in Vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/sync-attendance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Sync-Secret', v_sync_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_attendance_day_start() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_attendance_day_start() FROM anon;
REVOKE ALL ON FUNCTION public.invoke_attendance_day_start() FROM authenticated;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'attendance-day-start-dhaka'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'attendance-day-start-dhaka',
    '0 18 * * *',
    'SELECT public.invoke_attendance_day_start();'
  );
END;
$$;
