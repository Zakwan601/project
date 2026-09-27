/* Examination owns its day mode; routine rows choose subjects from the subject catalogue. */

ALTER TABLE public.result_exams
  ADD COLUMN has_regular_classes boolean NOT NULL DEFAULT true;

WITH group_modes AS (
  SELECT
    exam.exam_group_id,
    bool_or(schedule.has_regular_classes) AS has_regular_classes
  FROM public.result_exam_schedules AS schedule
  JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
  JOIN public.result_exams AS exam ON exam.id = link.exam_id
  GROUP BY exam.exam_group_id
)
UPDATE public.result_exams AS exam
SET has_regular_classes = mode.has_regular_classes
FROM group_modes AS mode
WHERE mode.exam_group_id = exam.exam_group_id;

UPDATE public.result_exam_schedules AS schedule
SET has_regular_classes = exam.has_regular_classes
FROM (
  SELECT exam_group_id, bool_or(has_regular_classes) AS has_regular_classes
  FROM public.result_exams
  GROUP BY exam_group_id
) AS exam
WHERE exam.exam_group_id = schedule.exam_group_id;

ALTER TABLE public.result_exam_schedules
  ADD COLUMN subject_id uuid REFERENCES public.subjects(id) ON DELETE RESTRICT;

UPDATE public.result_exam_schedules AS schedule
SET subject_id = (
  SELECT subject.id
  FROM public.subjects AS subject
  WHERE lower(btrim(subject.name)) = lower(btrim(schedule.subject_name))
  ORDER BY subject.is_active DESC, subject.created_at, subject.id
  LIMIT 1
)
WHERE schedule.subject_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.subjects AS subject
    WHERE lower(btrim(subject.name)) = lower(btrim(schedule.subject_name))
  );

CREATE INDEX result_exam_schedules_subject_idx
  ON public.result_exam_schedules (subject_id);

DROP FUNCTION public.create_result_exams_for_classes(uuid[], uuid, text, date);

CREATE FUNCTION public.create_result_exams_for_classes(
  p_class_ids uuid[],
  p_exam_type_id uuid,
  p_title text,
  p_exam_date date,
  p_has_regular_classes boolean
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

  SELECT count(DISTINCT requested.id) INTO v_requested_count
  FROM unnest(coalesce(p_class_ids, ARRAY[]::uuid[])) AS requested(id);

  IF v_requested_count = 0 THEN RAISE EXCEPTION 'Select at least one class'; END IF;
  IF p_exam_type_id IS NULL OR p_exam_date IS NULL THEN
    RAISE EXCEPTION 'Exam type and reference date are required';
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
    exam_group_id, class_id, academic_year_id, exam_type_id, title,
    exam_date, has_regular_classes, created_by
  )
  SELECT
    v_group_id, class.id, class.academic_year_id, p_exam_type_id,
    nullif(btrim(p_title), ''), p_exam_date, coalesce(p_has_regular_classes, true), auth.uid()
  FROM public.classes AS class
  WHERE class.id IN (SELECT DISTINCT requested.id FROM unnest(p_class_ids) AS requested(id))
  RETURNING result_exams.id, result_exams.class_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_result_exams_for_classes(uuid[], uuid, text, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_result_exams_for_classes(uuid[], uuid, text, date, boolean) TO authenticated;

DROP FUNCTION public.create_result_exam_routine_entry(uuid[], text, date, time without time zone, boolean);

CREATE FUNCTION public.create_result_exam_routine_entry(
  p_exam_ids uuid[],
  p_subject_id uuid,
  p_exam_date date,
  p_exam_time time without time zone DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule_id uuid;
  v_subject public.subjects%ROWTYPE;
  v_has_regular_classes boolean;
  v_requested_count integer;
  v_matching_count integer;
  v_group_count integer;
BEGIN
  IF NOT public.has_permission('results', 'write') THEN
    RAISE EXCEPTION 'You do not have permission to schedule examinations';
  END IF;

  SELECT * INTO v_subject
  FROM public.subjects
  WHERE id = p_subject_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active subject'; END IF;

  SELECT count(DISTINCT requested.id) INTO v_requested_count
  FROM unnest(coalesce(p_exam_ids, ARRAY[]::uuid[])) AS requested(id);
  IF v_requested_count = 0 THEN RAISE EXCEPTION 'Select at least one class'; END IF;

  SELECT
    count(DISTINCT exam.exam_group_id),
    bool_and(exam.has_regular_classes)
  INTO v_group_count, v_has_regular_classes
  FROM public.result_exams AS exam
  JOIN public.classes AS class ON class.id = exam.class_id
  WHERE exam.id IN (SELECT DISTINCT requested.id FROM unnest(p_exam_ids) AS requested(id));

  IF v_group_count <> 1 THEN
    RAISE EXCEPTION 'All selected classes must belong to the same examination';
  END IF;

  SELECT count(*) INTO v_matching_count
  FROM public.result_exams AS exam
  JOIN public.classes AS class ON class.id = exam.class_id
  WHERE exam.id IN (SELECT DISTINCT requested.id FROM unnest(p_exam_ids) AS requested(id))
    AND class.class_group = v_subject.class_group;

  IF v_matching_count <> v_requested_count THEN
    RAISE EXCEPTION 'The selected subject is not available for every selected class group';
  END IF;

  IF NOT v_has_regular_classes AND p_exam_time IS NULL THEN
    RAISE EXCEPTION 'Exam time is required for an exam-only examination';
  END IF;

  v_schedule_id := public.create_result_exam_schedule(
    p_exam_ids,
    p_exam_date,
    p_exam_time,
    v_has_regular_classes
  );

  UPDATE public.result_exam_schedules
  SET subject_id = v_subject.id,
      subject_name = v_subject.name,
      has_regular_classes = v_has_regular_classes
  WHERE id = v_schedule_id;

  RETURN v_schedule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_result_exam_schedule(uuid[], date, time without time zone, boolean) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_result_exam_routine_entry(uuid[], uuid, date, time without time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_result_exam_routine_entry(uuid[], uuid, date, time without time zone)
  TO authenticated;

COMMENT ON COLUMN public.result_exams.has_regular_classes IS
  'Examination-wide mode inherited by every routine date: true for exam plus classes, false for exam only.';
COMMENT ON COLUMN public.result_exam_schedules.subject_id IS
  'Subject catalogue entry selected for this examination routine row.';
