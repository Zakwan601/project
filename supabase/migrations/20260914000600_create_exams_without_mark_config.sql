/* Group subjects are a catalogue only. Every exam defines its own included subjects and marks. */

CREATE OR REPLACE FUNCTION public.create_result_exams_for_classes(
  p_class_ids uuid[],
  p_exam_type_id uuid,
  p_title text,
  p_exam_date date
)
RETURNS TABLE (exam_id uuid, class_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid := gen_random_uuid();
  v_requested_count integer;
  v_class_count integer;
BEGIN
  IF NOT public.has_permission('results', 'write') THEN
    RAISE EXCEPTION 'You do not have permission to create examinations';
  END IF;

  SELECT count(DISTINCT requested.id)
  INTO v_requested_count
  FROM unnest(coalesce(p_class_ids, ARRAY[]::uuid[])) AS requested(id);

  IF v_requested_count = 0 THEN
    RAISE EXCEPTION 'Select at least one class';
  END IF;

  IF p_exam_type_id IS NULL OR p_exam_date IS NULL THEN
    RAISE EXCEPTION 'Exam type and date are required';
  END IF;

  SELECT count(*) INTO v_class_count
  FROM public.classes AS class
  WHERE class.id IN (SELECT DISTINCT requested.id FROM unnest(p_class_ids) AS requested(id))
    AND class.is_active = true
    AND class.academic_year_id IS NOT NULL;

  IF v_class_count <> v_requested_count THEN
    RAISE EXCEPTION 'One or more selected classes are unavailable';
  END IF;

  RETURN QUERY
  INSERT INTO public.result_exams (
    exam_group_id, class_id, academic_year_id, exam_type_id, title, exam_date, created_by
  )
  SELECT v_group_id, class.id, class.academic_year_id, p_exam_type_id,
         nullif(btrim(p_title), ''), p_exam_date, auth.uid()
  FROM public.classes AS class
  WHERE class.id IN (SELECT DISTINCT requested.id FROM unnest(p_class_ids) AS requested(id))
  RETURNING result_exams.id, result_exams.class_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_result_exams_for_classes(uuid[], uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_result_exams_for_classes(uuid[], uuid, text, date) TO authenticated;
