/* Each class examination owns an independent routine, like its subject configuration. */

CREATE TEMP TABLE result_exam_schedule_split ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS new_schedule_id,
  schedule.id AS old_schedule_id,
  link.exam_id,
  schedule.exam_group_id,
  schedule.subject_name,
  schedule.subject_id,
  schedule.exam_date,
  schedule.exam_time,
  schedule.has_regular_classes,
  schedule.created_by,
  schedule.created_at,
  schedule.updated_at
FROM public.result_exam_schedules AS schedule
JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
WHERE (
  SELECT count(*)
  FROM public.result_exam_schedule_classes AS sibling
  WHERE sibling.schedule_id = schedule.id
) > 1;

INSERT INTO public.result_exam_schedules (
  id, exam_group_id, subject_name, subject_id, exam_date, exam_time,
  has_regular_classes, created_by, created_at, updated_at
)
SELECT
  split.new_schedule_id, split.exam_group_id, split.subject_name, split.subject_id,
  split.exam_date, split.exam_time, split.has_regular_classes, split.created_by,
  split.created_at, split.updated_at
FROM result_exam_schedule_split AS split;

INSERT INTO public.result_exam_schedule_classes (schedule_id, exam_id, created_at)
SELECT split.new_schedule_id, split.exam_id, split.created_at
FROM result_exam_schedule_split AS split;

DELETE FROM public.result_exam_schedules AS schedule
WHERE schedule.id IN (
  SELECT DISTINCT split.old_schedule_id
  FROM result_exam_schedule_split AS split
);

CREATE UNIQUE INDEX result_exam_schedule_single_exam_idx
  ON public.result_exam_schedule_classes (schedule_id);

CREATE OR REPLACE FUNCTION public.create_result_exam_schedule(
  p_exam_ids uuid[],
  p_exam_date date,
  p_exam_time time without time zone DEFAULT NULL,
  p_has_regular_classes boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_schedule_id uuid;
  v_group_id uuid;
  v_exam_id uuid;
  v_requested_count integer;
BEGIN
  IF NOT public.has_permission('results', 'write') THEN
    RAISE EXCEPTION 'You do not have permission to schedule examinations';
  END IF;

  SELECT count(DISTINCT requested.id), min(requested.id::text)::uuid
  INTO v_requested_count, v_exam_id
  FROM unnest(coalesce(p_exam_ids, ARRAY[]::uuid[])) AS requested(id);

  IF v_requested_count <> 1 THEN
    RAISE EXCEPTION 'A routine row must belong to exactly one class examination';
  END IF;
  IF p_exam_date IS NULL THEN RAISE EXCEPTION 'Exam date is required'; END IF;
  IF NOT coalesce(p_has_regular_classes, true) AND p_exam_time IS NULL THEN
    RAISE EXCEPTION 'Exam time is required when there are no regular classes';
  END IF;

  SELECT exam.exam_group_id INTO v_group_id
  FROM public.result_exams AS exam
  JOIN public.academic_years AS year ON year.id = exam.academic_year_id
  WHERE exam.id = v_exam_id
    AND p_exam_date BETWEEN year.start_date AND year.end_date;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'The class examination is unavailable or the date is outside its session';
  END IF;

  INSERT INTO public.result_exam_schedules (
    exam_group_id, exam_date, exam_time, has_regular_classes, created_by
  ) VALUES (
    v_group_id, p_exam_date, p_exam_time, coalesce(p_has_regular_classes, true), auth.uid()
  ) RETURNING id INTO v_schedule_id;

  INSERT INTO public.result_exam_schedule_classes (schedule_id, exam_id)
  VALUES (v_schedule_id, v_exam_id);

  RETURN v_schedule_id;
END;
$$;

COMMENT ON TABLE public.result_exam_schedule_classes IS
  'Links each routine row to exactly one class examination so every class can have a different routine.';
