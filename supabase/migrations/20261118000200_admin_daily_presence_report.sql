BEGIN;
CREATE FUNCTION public.get_admin_daily_presence(p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_date IS NULL THEN RAISE EXCEPTION 'Select a report date'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.has_permission('dashboard', 'read') THEN
    RAISE EXCEPTION 'Dashboard read permission is required' USING ERRCODE = '42501';
  END IF;
  WITH roster AS (
    SELECT student.id AS student_id, coalesce(enrollment.class_id, student.class_id) AS class_id
    FROM public.students student
    LEFT JOIN LATERAL (
      SELECT history.class_id FROM public.student_enrollments history
      WHERE history.student_id = student.id AND history.started_on <= p_date
        AND (history.ended_on IS NULL OR history.ended_on >= p_date)
      ORDER BY history.started_on DESC, (history.ended_on IS NULL) DESC, history.id
      LIMIT 1
    ) enrollment ON true
    WHERE student.is_active AND (enrollment.class_id IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM public.student_enrollments history WHERE history.student_id = student.id))
  ), daily_records AS (
    SELECT DISTINCT ON (record.student_id) record.student_id, session.class_id, record.status
    FROM public.attendance_records record
    JOIN public.attendance_sessions session ON session.id = record.session_id
    WHERE session.date = p_date
    ORDER BY record.student_id, record.marked_at DESC NULLS LAST, record.id DESC
  ), student_days AS (
    SELECT coalesce(record.student_id, roster.student_id) AS student_id,
      coalesce(record.class_id, roster.class_id) AS class_id, record.status
    FROM roster FULL JOIN daily_records record ON record.student_id = roster.student_id
  ), counted AS (
    SELECT class_id, count(*)::integer AS students,
      count(*) FILTER (WHERE status = 'present')::integer AS present,
      count(*) FILTER (WHERE status = 'late')::integer AS late,
      count(*) FILTER (WHERE status IN ('absent', 'too_late'))::integer AS absent,
      count(*) FILTER (WHERE status = 'excused')::integer AS excused,
      count(*) FILTER (WHERE status IS NULL)::integer AS unmarked
    FROM student_days GROUP BY class_id
  ), included_classes AS (
    SELECT id FROM public.classes WHERE is_active
    UNION SELECT class_id FROM counted
  ), class_counts AS (
    SELECT class.id AS class_id, coalesce(class.name, 'Unassigned students') AS class_name,
      coalesce(class.section, '') AS section, class.academic_year_id AS session_id,
      coalesce(year.name, 'No academic session') AS session_name,
      coalesce(counted.students, 0) AS students, coalesce(counted.present, 0) AS present,
      coalesce(counted.late, 0) AS late, coalesce(counted.absent, 0) AS absent,
      coalesce(counted.excused, 0) AS excused, coalesce(counted.unmarked, 0) AS unmarked
    FROM included_classes included
    LEFT JOIN public.classes class ON class.id = included.id
    LEFT JOIN public.academic_years year ON year.id = class.academic_year_id
    LEFT JOIN counted ON counted.class_id IS NOT DISTINCT FROM included.id
  ), session_counts AS (
    SELECT session_id, session_name, sum(students)::integer AS students,
      sum(present)::integer AS present, sum(late)::integer AS late,
      sum(absent)::integer AS absent, sum(excused)::integer AS excused, sum(unmarked)::integer AS unmarked
    FROM class_counts GROUP BY session_id, session_name
  )
  SELECT jsonb_build_object('date', p_date,
    'classes', coalesce((SELECT jsonb_agg(to_jsonb(report_row) || jsonb_build_object('rate',
      round((present + late + excused)::numeric * 100 / nullif(present + late + absent + excused, 0)))
      ORDER BY session_name DESC, class_name, section, class_id) FROM class_counts report_row), '[]'::jsonb),
    'sessions', coalesce((SELECT jsonb_agg(to_jsonb(report_row) || jsonb_build_object('rate',
      round((present + late + excused)::numeric * 100 / nullif(present + late + absent + excused, 0)))
      ORDER BY session_name DESC, session_id) FROM session_counts report_row), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_daily_presence(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_daily_presence(date) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_admin_daily_presence(date) IS 'Daily class and academic-session attendance. Each student is counted once using the latest record; unmarked roster members are kept separate from absences. Class membership uses enrollment history.';
COMMIT;
