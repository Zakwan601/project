CREATE OR REPLACE FUNCTION public.get_student_attendance_fine_breakdown(p_student_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE total jsonb; months jsonb;
BEGIN
  total := public.get_student_attendance_fine_details(p_student_id);
  WITH attendance_days AS (
    SELECT session.date AS day,session.class_id,bool_or(record.status='present') AS is_present
    FROM public.attendance_records record
    JOIN public.attendance_sessions session ON session.id=record.session_id
    WHERE record.student_id=p_student_id AND public.teacher_can_access_session(session.id)
    GROUP BY session.date,session.class_id
  ), recorded_dates AS (
    SELECT day FROM attendance_days
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
  ), present_months AS (
    SELECT date_trunc('month',day::timestamp)::date AS month,count(*) FILTER(WHERE is_present)::integer AS present_days
    FROM attendance_days GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object('month',m.month,'presentDays',coalesce(p.present_days,0)) || public.get_student_attendance_fine_details(
      p_student_id,m.month,(m.month+interval '1 month - 1 day')::date)
    ORDER BY m.month DESC),'[]'::jsonb) INTO months
  FROM recorded_months m LEFT JOIN present_months p ON p.month=m.month;
  RETURN jsonb_build_object('total',total,'months',months);
END;
$$;
COMMENT ON FUNCTION public.get_student_attendance_fine_breakdown(uuid) IS
  'Returns all-time fines and monthly fine/attendance details. Present days are deduplicated per class/date, retaining authorization and assigned-class scope.';
