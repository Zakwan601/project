/*
  Extend the paginated punch query so My Punches can request only the signed-in
  student's biometric ID. Row-level security remains authoritative.
*/

DROP FUNCTION IF EXISTS public.get_daily_punches_page(date, integer, integer);

CREATE OR REPLACE FUNCTION public.get_daily_punches_page(
  p_date date DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_student_biometric_id text DEFAULT NULL
)
RETURNS TABLE (
  student_biometric_id text,
  punch_date date,
  punch_ids uuid[],
  punch_times timestamptz[],
  first_name text,
  last_name text,
  photo_url text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH daily_punches AS (
    SELECT
      log.student_biometric_id,
      (log.punched_at AT TIME ZONE 'UTC')::date AS punch_date,
      ARRAY_AGG(log.id ORDER BY log.punched_at, log.id) AS punch_ids,
      ARRAY_AGG(log.punched_at ORDER BY log.punched_at, log.id) AS punch_times,
      student.first_name,
      student.last_name,
      student.photo_url
    FROM public.device_logs AS log
    LEFT JOIN public.students AS student
      ON student.admission_number = log.student_biometric_id
    WHERE (p_student_biometric_id IS NULL
           OR log.student_biometric_id = p_student_biometric_id)
      AND (
        p_date IS NULL
        OR (
          log.punched_at >= (p_date::timestamp AT TIME ZONE 'UTC')
          AND log.punched_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC')
        )
      )
    GROUP BY
      log.student_biometric_id,
      (log.punched_at AT TIME ZONE 'UTC')::date,
      student.first_name,
      student.last_name,
      student.photo_url
  ), counted AS (
    SELECT daily_punches.*, COUNT(*) OVER () AS total_count
    FROM daily_punches
  )
  SELECT
    counted.student_biometric_id,
    counted.punch_date,
    counted.punch_ids,
    counted.punch_times,
    counted.first_name,
    counted.last_name,
    counted.photo_url,
    counted.total_count
  FROM counted
  ORDER BY counted.punch_date DESC, counted.punch_times[1] DESC,
           counted.student_biometric_id
  LIMIT LEAST(GREATEST(p_page_size, 1), 100)
  OFFSET (GREATEST(p_page, 1) - 1) * LEAST(GREATEST(p_page_size, 1), 100);
$$;

REVOKE ALL ON FUNCTION public.get_daily_punches_page(date, integer, integer, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_punches_page(date, integer, integer, text)
  TO authenticated;

COMMENT ON FUNCTION public.get_daily_punches_page(date, integer, integer, text) IS
  'Returns RLS-filtered daily biometric punch groups with student/date filters and server-side pagination.';
