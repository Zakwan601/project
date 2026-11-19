CREATE FUNCTION public.get_student_attendance_fine_breakdown(p_student_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE total jsonb; months jsonb;
BEGIN
  -- Reuse the existing permission and teacher-class checks, including when no
  -- records exist. The same calculator supplies all-time and monthly amounts.
  total := public.get_student_attendance_fine_details(p_student_id);
  WITH recorded_dates AS (
    SELECT session.date AS day
    FROM public.attendance_records record
    JOIN public.attendance_sessions session ON session.id=record.session_id
    WHERE record.student_id=p_student_id AND public.teacher_can_access_session(session.id)
    UNION
    SELECT schedule.exam_date
    FROM public.result_marks mark
    JOIN public.result_exam_subjects subject ON subject.id=mark.exam_subject_id
    JOIN public.result_exams exam ON exam.id=subject.exam_id
    JOIN public.result_exam_schedule_classes link ON link.exam_id=exam.id
    JOIN public.result_exam_schedules schedule ON schedule.id=link.schedule_id AND schedule.subject_id=subject.subject_id
    WHERE mark.student_id=p_student_id AND mark.is_absent
      AND public.teacher_can_access_exam(exam.id)
      AND public.student_takes_routine_subject(p_student_id,schedule.subject_id,exam.combine_subject_papers)
  ), recorded_months AS (
    SELECT DISTINCT date_trunc('month',day::timestamp)::date AS month FROM recorded_dates
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object('month',month) || public.get_student_attendance_fine_details(
      p_student_id,month,(month+interval '1 month - 1 day')::date)
    ORDER BY month DESC),'[]'::jsonb) INTO months FROM recorded_months;
  RETURN jsonb_build_object('total',total,'months',months);
END;
$$;
REVOKE ALL ON FUNCTION public.get_student_attendance_fine_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_attendance_fine_breakdown(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_student_attendance_fine_breakdown(uuid) IS
  'Returns all-time fines and months with attendance or missed-exam records in one request, preserving calculator permissions and assigned-class scope.';
