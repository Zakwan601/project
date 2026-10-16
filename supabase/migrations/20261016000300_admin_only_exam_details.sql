/* Examination metadata is controlled by active full administrators. */
CREATE OR REPLACE FUNCTION public.update_result_exam_group_settings(
  p_exam_group_id uuid,
  p_exam_type_id uuid,
  p_title text,
  p_exam_date date,
  p_has_regular_classes boolean,
  p_combine_subject_papers boolean,
  p_count_fourth_subject boolean
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
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.role = 'admin'
      AND profile.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only a full administrator can edit examination details'
      USING ERRCODE = '42501';
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
      combine_subject_papers = v_requested_combined,
      count_fourth_subject = coalesce(p_count_fourth_subject, false)
  WHERE exam_group_id = p_exam_group_id;

  UPDATE public.result_exam_schedules
  SET has_regular_classes = coalesce(p_has_regular_classes, true)
  WHERE exam_group_id = p_exam_group_id;
END;
$$;

/* Also protect direct table updates, alongside the existing publication guard. */
CREATE OR REPLACE FUNCTION public.enforce_admin_exam_details_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF ROW(
    OLD.exam_group_id, OLD.class_id, OLD.academic_year_id, OLD.exam_type_id,
    OLD.title, OLD.exam_date, OLD.has_regular_classes,
    OLD.combine_subject_papers, OLD.count_fourth_subject
  ) IS DISTINCT FROM ROW(
    NEW.exam_group_id, NEW.class_id, NEW.academic_year_id, NEW.exam_type_id,
    NEW.title, NEW.exam_date, NEW.has_regular_classes,
    NEW.combine_subject_papers, NEW.count_fourth_subject
  ) AND COALESCE(auth.role(), '') <> 'service_role'
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND profile.is_active = true
    ) THEN
    RAISE EXCEPTION 'Only a full administrator can edit examination details'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_admin_exam_details_change_before_update
  BEFORE UPDATE ON public.result_exams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_exam_details_change();

REVOKE ALL ON FUNCTION public.enforce_admin_exam_details_change() FROM PUBLIC;

COMMENT ON FUNCTION public.enforce_admin_exam_details_change() IS
  'Restricts examination metadata changes to full admins while retaining assigned mark-entry and subject-configuration permissions.';
