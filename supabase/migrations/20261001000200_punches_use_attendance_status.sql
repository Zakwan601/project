/*
  The Punches page must display the status stored by attendance processing.
  Recalculating from the clock time alone cannot account for exam-only days or
  audited manual corrections.
*/
CREATE OR REPLACE FUNCTION public.get_punch_attendance_status(
  p_student_id uuid,
  p_date date
)
RETURNS public.attendance_status
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.attendance_status;
  v_authorized boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND (
        profile.role = 'admin'
        OR (
          profile.role = 'sub_admin'
          AND public.has_permission('punches', 'read')
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.students AS student
    WHERE student.id = p_student_id
      AND student.profile_id = auth.uid()
  )
  INTO v_authorized;

  IF auth.role() <> 'service_role' AND NOT coalesce(v_authorized, false) THEN
    RETURN NULL;
  END IF;

  SELECT record.status
  INTO v_status
  FROM public.attendance_records AS record
  JOIN public.attendance_sessions AS attendance_session
    ON attendance_session.id = record.session_id
  WHERE record.student_id = p_student_id
    AND attendance_session.date = p_date
  ORDER BY record.updated_at DESC, record.created_at DESC
  LIMIT 1;

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.get_punch_attendance_status(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_punch_attendance_status(uuid, date) TO authenticated;

DROP FUNCTION IF EXISTS public.search_daily_punches_page(
  uuid, date, integer, integer, text, text
);

CREATE FUNCTION public.search_daily_punches_page(
  p_class_id uuid,
  p_date date DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_student_biometric_id text DEFAULT NULL,
  p_search text DEFAULT ''
)
RETURNS TABLE (
  student_biometric_id text,
  punch_date date,
  punch_ids uuid[],
  punch_times timestamptz[],
  first_name text,
  last_name text,
  photo_url text,
  attendance_status public.attendance_status,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH daily AS (
    SELECT
      log.student_biometric_id,
      (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date AS punch_date,
      array_agg(log.id ORDER BY log.punched_at, log.id) AS punch_ids,
      array_agg(log.punched_at ORDER BY log.punched_at, log.id) AS punch_times,
      student.id AS student_id,
      student.first_name,
      student.last_name,
      student.photo_url
    FROM public.device_logs AS log
    LEFT JOIN public.students AS student
      ON student.admission_number = log.student_biometric_id
    WHERE (
      p_student_biometric_id IS NULL
      OR log.student_biometric_id = p_student_biometric_id
    )
      AND (
        p_date IS NULL
        OR (
          log.punched_at >= (p_date::timestamp AT TIME ZONE 'Asia/Dhaka')
          AND log.punched_at < ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')
        )
      )
      AND (
        p_class_id IS NULL
        OR public.get_student_class_on_date(
          student.id,
          (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date
        ) = p_class_id
      )
      AND (
        coalesce(btrim(p_search), '') = ''
        OR strpos(
          lower(concat_ws(
            ' ',
            log.student_biometric_id,
            student.first_name,
            student.last_name
          )),
          lower(btrim(p_search))
        ) > 0
      )
    GROUP BY
      log.student_biometric_id,
      (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date,
      student.id,
      student.first_name,
      student.last_name,
      student.photo_url
  )
  SELECT
    daily.student_biometric_id,
    daily.punch_date,
    daily.punch_ids,
    daily.punch_times,
    daily.first_name,
    daily.last_name,
    daily.photo_url,
    public.get_punch_attendance_status(daily.student_id, daily.punch_date),
    count(*) OVER () AS total_count
  FROM daily
  ORDER BY
    daily.punch_date DESC,
    daily.punch_times[1] DESC,
    daily.student_biometric_id
  LIMIT least(greatest(p_page_size, 1), 100)
  OFFSET (
    greatest(p_page, 1) - 1
  ) * least(greatest(p_page_size, 1), 100);
$$;

REVOKE ALL ON FUNCTION public.search_daily_punches_page(
  uuid, date, integer, integer, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_daily_punches_page(
  uuid, date, integer, integer, text, text
) TO authenticated;

COMMENT ON FUNCTION public.get_punch_attendance_status(uuid, date) IS
  'Returns the authorized attendance status used by the Punches page for a student and school date.';

COMMENT ON FUNCTION public.search_daily_punches_page(uuid, date, integer, integer, text, text) IS
  'Searches and paginates punch days and returns the authoritative attendance status when available.';
