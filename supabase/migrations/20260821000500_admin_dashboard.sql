CREATE OR REPLACE FUNCTION public.get_admin_dashboard(
  p_today date,
  p_weekly_start date,
  p_weekly_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_weekly_start > p_weekly_end THEN
    RAISE EXCEPTION 'Weekly start date must not be after the end date'
      USING ERRCODE = '22007';
  END IF;

  IF auth.role() <> 'service_role'
     AND NOT EXISTS (
       SELECT 1
       FROM public.profiles
       WHERE id = auth.uid()
         AND role = 'admin'
         AND is_active = true
     ) THEN
    RAISE EXCEPTION 'An active administrator account is required'
      USING ERRCODE = '42501';
  END IF;

  WITH requested_dates AS (
    SELECT day::date AS date
    FROM generate_series(p_weekly_start, p_weekly_end, interval '1 day') AS day
  ),
  attendance_by_date AS (
    SELECT
      session.date,
      COUNT(record.id) FILTER (WHERE record.status = 'present')::integer AS present,
      COUNT(record.id) FILTER (WHERE record.status = 'absent')::integer AS absent,
      COUNT(record.id) FILTER (WHERE record.status = 'late')::integer AS late,
      COUNT(record.id) FILTER (WHERE record.status = 'excused')::integer AS excused
    FROM public.attendance_sessions AS session
    LEFT JOIN public.attendance_records AS record
      ON record.session_id = session.id
    WHERE session.date BETWEEN p_weekly_start AND p_weekly_end
    GROUP BY session.date
  ),
  daily AS (
    SELECT
      requested.date,
      COALESCE(attendance.present, 0) AS present,
      COALESCE(attendance.absent, 0) AS absent,
      COALESCE(attendance.late, 0) AS late,
      COALESCE(attendance.excused, 0) AS excused
    FROM requested_dates AS requested
    LEFT JOIN attendance_by_date AS attendance
      ON attendance.date = requested.date
  ),
  today AS (
    SELECT present, absent, late, excused
    FROM daily
    WHERE date = p_today
  )
  SELECT jsonb_build_object(
    'stats', jsonb_build_object(
      'totalStudents', (SELECT COUNT(*) FROM public.students WHERE is_active = true),
      'totalClasses', (SELECT COUNT(*) FROM public.classes WHERE is_active = true),
      'presentToday', COALESCE((SELECT present FROM today), 0),
      'absentToday', COALESCE((SELECT absent FROM today), 0),
      'lateToday', COALESCE((SELECT late FROM today), 0),
      'excusedToday', COALESCE((SELECT excused FROM today), 0),
      'todayAttendanceRate', CASE
        WHEN COALESCE((SELECT present + absent + late FROM today), 0) = 0 THEN 0
        ELSE ROUND(
          (SELECT (present + late)::numeric * 100 / (present + absent + late) FROM today)
        )::integer
      END
    ),
    'weekly', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'date', date,
            'present', present,
            'absent', absent,
            'late', late
          )
          ORDER BY date
        )
        FROM daily
      ),
      '[]'::jsonb
    )
  )
  INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_dashboard(date, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard(date, date, date)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_dashboard(date, date, date) IS
  'Returns admin summary and grouped weekly attendance in one authorized database request.';
