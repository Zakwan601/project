/* Edit examination-wide settings after creation while protecting configured data. */

CREATE OR REPLACE FUNCTION public.update_result_exam_group_settings(
  p_exam_group_id uuid,
  p_exam_type_id uuid,
  p_title text,
  p_exam_date date,
  p_has_regular_classes boolean,
  p_combine_subject_papers boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_count integer;
  v_current_combined boolean;
  v_requested_combined boolean := coalesce(p_combine_subject_papers, false);
BEGIN
  IF NOT public.has_permission('results', 'write') THEN
    RAISE EXCEPTION 'You do not have permission to edit examinations';
  END IF;

  IF p_exam_group_id IS NULL OR p_exam_type_id IS NULL OR p_exam_date IS NULL THEN
    RAISE EXCEPTION 'Examination, exam type, and reference date are required';
  END IF;

  SELECT count(*), bool_and(exam.combine_subject_papers)
  INTO v_exam_count, v_current_combined
  FROM public.result_exams AS exam
  WHERE exam.exam_group_id = p_exam_group_id;

  IF v_exam_count = 0 THEN RAISE EXCEPTION 'Examination not found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.result_exams
    WHERE exam_group_id = p_exam_group_id AND status <> 'draft'
  ) THEN
    RAISE EXCEPTION 'Published examinations must be returned to draft before editing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.result_exam_types
    WHERE id = p_exam_type_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Select an active exam type';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.result_exams AS exam
    JOIN public.academic_years AS year ON year.id = exam.academic_year_id
    WHERE exam.exam_group_id = p_exam_group_id
      AND (p_exam_date < year.start_date OR p_exam_date > year.end_date)
  ) THEN
    RAISE EXCEPTION 'Reference date must be inside every selected class session';
  END IF;

  IF v_current_combined IS DISTINCT FROM v_requested_combined
     AND (
       EXISTS (
         SELECT 1
         FROM public.result_exam_subjects AS exam_subject
         JOIN public.result_exams AS exam ON exam.id = exam_subject.exam_id
         WHERE exam.exam_group_id = p_exam_group_id
       )
       OR EXISTS (
         SELECT 1 FROM public.result_exam_schedules
         WHERE exam_group_id = p_exam_group_id
       )
     ) THEN
    RAISE EXCEPTION 'Paper mode cannot be changed after subjects or routine rows have been configured';
  END IF;

  IF NOT coalesce(p_has_regular_classes, true)
     AND EXISTS (
       SELECT 1 FROM public.result_exam_schedules
       WHERE exam_group_id = p_exam_group_id AND exam_time IS NULL
     ) THEN
    RAISE EXCEPTION 'Add a time to every routine row before changing this to an exam-only examination';
  END IF;

  UPDATE public.result_exams
  SET exam_type_id = p_exam_type_id,
      title = nullif(btrim(p_title), ''),
      exam_date = p_exam_date,
      has_regular_classes = coalesce(p_has_regular_classes, true),
      combine_subject_papers = v_requested_combined
  WHERE exam_group_id = p_exam_group_id;

  UPDATE public.result_exam_schedules
  SET has_regular_classes = coalesce(p_has_regular_classes, true)
  WHERE exam_group_id = p_exam_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_result_exam_group_settings(uuid, uuid, text, date, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_result_exam_group_settings(uuid, uuid, text, date, boolean, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.update_result_exam_group_settings(uuid, uuid, text, date, boolean, boolean) IS
  'Updates settings shared by every class in an examination group. Paper mode changes are blocked after configuration begins.';
