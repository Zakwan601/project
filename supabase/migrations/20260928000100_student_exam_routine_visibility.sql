/* Let students view routines for their own class before results are published. */

CREATE OR REPLACE FUNCTION public.can_view_exam_routine(p_exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_permission('results', 'read') OR EXISTS (
    SELECT 1
    FROM public.result_exams AS exam
    JOIN public.students AS student ON student.class_id = exam.class_id
    WHERE exam.id = p_exam_id
      AND student.profile_id = auth.uid()
      AND student.is_active = true
      AND EXISTS (
        SELECT 1
        FROM public.result_exam_schedule_classes AS link
        WHERE link.exam_id = exam.id
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_exam_routine(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_exam_routine(uuid) TO authenticated;

CREATE POLICY result_exams_student_routine_read ON public.result_exams
  FOR SELECT TO authenticated
  USING (public.can_view_exam_routine(id));

DROP POLICY result_exam_schedules_read ON public.result_exam_schedules;
CREATE POLICY result_exam_schedules_read ON public.result_exam_schedules
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.result_exam_schedule_classes AS link
      WHERE link.schedule_id = result_exam_schedules.id
        AND (
          public.can_view_result_exam(link.exam_id)
          OR public.can_view_exam_routine(link.exam_id)
        )
    )
  );

DROP POLICY result_exam_schedule_classes_read ON public.result_exam_schedule_classes;
CREATE POLICY result_exam_schedule_classes_read ON public.result_exam_schedule_classes
  FOR SELECT TO authenticated USING (
    public.can_view_result_exam(exam_id)
    OR public.can_view_exam_routine(exam_id)
  );

COMMENT ON FUNCTION public.can_view_exam_routine(uuid) IS
  'Allows staff or an active student in the examination class to read routine metadata without exposing draft results.';
