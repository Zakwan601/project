# Sync attendance edge function

This is the single API entry point for daily attendance generation and punch processing.

## Required secret

Set a long random value as the edge-function secret:

```sh
supabase secrets set ATTENDANCE_SYNC_SECRET=replace-with-a-long-random-value
```

Store the same value in Vault so the midnight database schedule can invoke the function. Also store the project's public URL:

```sql
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('the-same-long-random-value', 'attendance_sync_secret');
```

Redeploy the function after changing its secret. The database schedules invoke it
at `18:00`, `19:00`, and `00:00` UTC, which are `00:00`, `01:00`, and `06:00`
in `Asia/Dhaka`. Repeated calls are idempotent: they create missing daily
attendance and refresh punch-derived statuses without duplicating sessions or
records.

## Service app call

Call after inserting one or more new punches. Multiple calls are safe because the database sync recalculates the whole selected day.

```http
POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/sync-attendance
Content-Type: application/json
X-Sync-Secret: the-same-long-random-value

{"date":"2026-07-31"}
```

The date is optional. When omitted, the function uses today's date in `Asia/Dhaka`. The service should also call the endpoint once at startup or when its local date changes; the database schedule remains the fallback that creates the report even if the service is not running and no punch arrives.

Do not put `ATTENDANCE_SYNC_SECRET` in the browser app or any `VITE_` environment variable.
