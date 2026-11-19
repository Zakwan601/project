-- Allow the same authorized staff who can view fines to see their details.
-- Preserve linked-student access and all existing teacher session guards.
DO $patch$
DECLARE definition text; old_guard text;
BEGIN
  SELECT pg_get_functiondef('public.get_student_attendance_exceptions(uuid)'::regprocedure) INTO definition;
  old_guard := $old$WHERE id = p_student_id AND profile_id = auth.uid()
     ) THEN$old$;
  IF strpos(definition,old_guard)=0 THEN RAISE EXCEPTION 'Attendance exception authorization anchor missing'; END IF;
  definition:=replace(definition,old_guard,$new$WHERE id = p_student_id AND profile_id = auth.uid()
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active
         AND (role IN ('admin','teacher') OR (role='sub_admin' AND public.has_permission('reports','read')))
     ) THEN$new$);
  IF strpos(definition,'WHERE public.student_takes_routine_subject(p_student_id, schedule.subject_id, exam.combine_subject_papers) AND (')=0 THEN
    RAISE EXCEPTION 'Missed exam scope anchor missing';
  END IF;
  definition:=replace(definition,
    'WHERE public.student_takes_routine_subject(p_student_id, schedule.subject_id, exam.combine_subject_papers) AND (',
    'WHERE public.teacher_can_access_exam(exam.id) AND public.student_takes_routine_subject(p_student_id, schedule.subject_id, exam.combine_subject_papers) AND (');
  EXECUTE definition;
END;
$patch$;
