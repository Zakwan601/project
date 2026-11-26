BEGIN;
-- Private report helper: use the same result authorization and teacher class
-- scope as the report builder, without exposing a new public attendance RPC.
CREATE FUNCTION public.result_report_attendance(p_exam_id uuid,p_student_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH period AS (
   SELECT (student.created_at AT TIME ZONE 'Asia/Dhaka')::date AS start_date,
     coalesce((SELECT max(schedule.exam_date)
       FROM public.result_exam_schedules schedule
       JOIN public.result_exam_schedule_classes link ON link.schedule_id=schedule.id
       WHERE link.exam_id=exam.id),exam.exam_date) AS end_date
   FROM public.students student CROSS JOIN public.result_exams exam
   WHERE student.id=p_student_id AND exam.id=p_exam_id
     AND public.teacher_can_access_student(student.id) AND public.teacher_can_access_exam(exam.id)
 ), exam_only_days AS (
   SELECT exam.class_id,schedule.exam_date
   FROM public.result_exam_schedules schedule
   JOIN public.result_exam_schedule_classes link ON link.schedule_id=schedule.id
   JOIN public.result_exams exam ON exam.id=link.exam_id
   CROSS JOIN period
   WHERE schedule.exam_date BETWEEN period.start_date AND period.end_date
   GROUP BY exam.class_id,schedule.exam_date
   HAVING NOT bool_or(exam.has_regular_classes)
 ), class_days AS (
   SELECT session.date,
     bool_or(coalesce(record.status IN ('present','late','excused'),false)) AS attended
   FROM period JOIN public.attendance_sessions session ON session.date BETWEEN period.start_date AND period.end_date
   LEFT JOIN public.attendance_records record ON record.session_id=session.id AND record.student_id=p_student_id
   WHERE session.class_id=public.get_student_class_on_date(p_student_id,session.date)
     AND public.teacher_can_access_session(session.id)
     AND extract(dow FROM session.date)::integer NOT IN (5,6)
     AND NOT EXISTS(SELECT 1 FROM public.holidays holiday WHERE holiday.date=session.date
       AND (holiday.class_ids IS NULL OR session.class_id=ANY(holiday.class_ids)))
     AND NOT EXISTS(SELECT 1 FROM exam_only_days day WHERE day.class_id=session.class_id AND day.exam_date=session.date)
   GROUP BY session.date
 ), counts AS (
   SELECT count(*)::integer AS total_classes,count(*) FILTER(WHERE attended)::integer AS present_count FROM class_days
 )
 SELECT jsonb_build_object('start_date',period.start_date,'end_date',period.end_date,
   'total_classes',counts.total_classes,'present_count',counts.present_count,
   'present_percentage',CASE WHEN counts.total_classes=0 THEN 0
     ELSE round(counts.present_count::numeric*100/counts.total_classes,2) END)
 FROM period CROSS JOIN counts;
$$;
REVOKE ALL ON FUNCTION public.result_report_attendance(uuid,uuid) FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public.result_report_attendance(uuid,uuid) IS
 'Private report-card totals: distinct recorded class days from student creation in Dhaka through the final class exam schedule (reference date fallback). Present, late and approved leave count; holidays, weekends and exam-only days do not.';

-- Patch only the JSON payload; preserve the live grading and access checks.
DO $patch$
DECLARE definition text; anchor text := '''student'', (SELECT to_jsonb(student_info) FROM student_info),';
BEGIN
 SELECT pg_get_functiondef('public.build_student_result(uuid,uuid)'::regprocedure) INTO definition;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Report attendance payload anchor missing'; END IF;
 IF strpos(definition,'result_report_attendance')<>0 THEN RAISE EXCEPTION 'Report attendance already installed'; END IF;
 EXECUTE replace(definition,anchor,anchor || E'\n    ''attendance'', public.result_report_attendance(p_exam_id,p_student_id),');
END;
$patch$;
COMMIT;
