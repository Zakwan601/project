/*
  Ensure daily attendance exists at the start of every school day in Dhaka.

  pg_cron schedules use UTC. Asia/Dhaka is UTC+06 year-round, so these invoke
  sync-attendance at 00:00, 01:00, and 06:00 local time. The Edge Function
  resolves the current Dhaka date, and sync_daily_attendance is idempotent.
*/

DO $$
DECLARE
  v_job_id bigint;
  v_job_name text;
BEGIN
  FOREACH v_job_name IN ARRAY ARRAY[
    'attendance-day-start-dhaka',
    'attendance-day-recheck-1am-dhaka',
    'attendance-day-recheck-6am-dhaka'
  ]
  LOOP
    FOR v_job_id IN
      SELECT jobid FROM cron.job WHERE jobname = v_job_name
    LOOP
      PERFORM cron.unschedule(v_job_id);
    END LOOP;
  END LOOP;

  /* 18:00 UTC is 00:00 the next calendar day in Asia/Dhaka. */
  PERFORM cron.schedule(
    'attendance-day-start-dhaka',
    '0 18 * * *',
    'SELECT public.invoke_attendance_day_start();'
  );

  /* 19:00 UTC is 01:00 the next calendar day in Asia/Dhaka. */
  PERFORM cron.schedule(
    'attendance-day-recheck-1am-dhaka',
    '0 19 * * *',
    'SELECT public.invoke_attendance_day_start();'
  );

  /* 00:00 UTC is 06:00 on the same calendar day in Asia/Dhaka. */
  PERFORM cron.schedule(
    'attendance-day-recheck-6am-dhaka',
    '0 0 * * *',
    'SELECT public.invoke_attendance_day_start();'
  );
END;
$$;

