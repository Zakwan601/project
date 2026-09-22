-- Add an optional historical-class filter to paginated punch searches.
CREATE OR REPLACE FUNCTION public.search_daily_punches_page(
  p_class_id uuid,
  p_date date DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_student_biometric_id text DEFAULT NULL,
  p_search text DEFAULT ''
)
RETURNS TABLE (
  student_biometric_id text, punch_date date, punch_ids uuid[],
  punch_times timestamptz[], first_name text, last_name text,
  photo_url text, total_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH daily AS (
    SELECT log.student_biometric_id,
      (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date AS punch_date,
      array_agg(log.id ORDER BY log.punched_at, log.id) AS punch_ids,
      array_agg(log.punched_at ORDER BY log.punched_at, log.id) AS punch_times,
      student.first_name, student.last_name, student.photo_url
    FROM public.device_logs AS log
    LEFT JOIN public.students AS student ON student.admission_number = log.student_biometric_id
    WHERE (p_student_biometric_id IS NULL OR log.student_biometric_id = p_student_biometric_id)
      AND (p_date IS NULL OR (
        log.punched_at >= (p_date::timestamp AT TIME ZONE 'Asia/Dhaka')
        AND log.punched_at < ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')
      ))
      AND (
        p_class_id IS NULL OR
        public.get_student_class_on_date(
          student.id,
          (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date
        ) = p_class_id
      )
      AND (coalesce(btrim(p_search), '') = '' OR
        strpos(lower(concat_ws(' ', log.student_biometric_id, student.first_name, student.last_name)), lower(btrim(p_search))) > 0)
    GROUP BY log.student_biometric_id, (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date,
      student.first_name, student.last_name, student.photo_url
  )
  SELECT daily.*, count(*) OVER () AS total_count FROM daily
  ORDER BY daily.punch_date DESC, daily.punch_times[1] DESC, daily.student_biometric_id
  LIMIT least(greatest(p_page_size, 1), 100)
  OFFSET (greatest(p_page, 1) - 1) * least(greatest(p_page_size, 1), 100);
$$;

REVOKE ALL ON FUNCTION public.search_daily_punches_page(uuid, date, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_daily_punches_page(uuid, date, integer, integer, text, text) TO authenticated;

COMMENT ON FUNCTION public.search_daily_punches_page(uuid, date, integer, integer, text, text) IS
  'Searches and paginates punch days with an optional class filter resolved from enrollment on each punch date.';
