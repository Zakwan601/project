-- Scope manual device-log archive operations to one class while preserving
-- historical enrollment membership for every punch date.

ALTER TABLE public.device_log_archive_runs
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS device_log_archive_runs_class_cutoff_idx
  ON public.device_log_archive_runs (class_id, archive_before DESC, completed_at DESC);

CREATE OR REPLACE FUNCTION public.get_class_device_logs_for_archive(
  p_class_id uuid,
  p_archive_before date,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  id uuid,
  device_id uuid,
  student_biometric_id text,
  punched_at timestamptz,
  processed boolean,
  attendance_record_id uuid,
  raw_data jsonb,
  created_at timestamptz,
  archive_class_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    log.id,
    log.device_id,
    log.student_biometric_id,
    log.punched_at,
    log.processed,
    log.attendance_record_id,
    log.raw_data,
    log.created_at,
    p_class_id
  FROM public.device_logs AS log
  JOIN public.students AS student
    ON student.admission_number = log.student_biometric_id
  WHERE log.processed = true
    AND log.attendance_record_id IS NOT NULL
    AND log.punched_at < (p_archive_before::timestamp AT TIME ZONE 'Asia/Dhaka')
    AND public.get_student_class_on_date(
      student.id,
      (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date
    ) = p_class_id
  ORDER BY log.punched_at, log.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.get_class_device_logs_for_archive(uuid, date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_class_device_logs_for_archive(uuid, date, integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_class_device_logs_for_archive(uuid, date, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_device_logs_for_archive(uuid, date, integer) TO service_role;

COMMENT ON FUNCTION public.get_class_device_logs_for_archive(uuid, date, integer) IS
  'Returns processed punches before a cutoff only when the student belonged to the selected class on the punch date.';
