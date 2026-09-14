/* Result subjects are defined once per academic group; exams only select and configure them. */

ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS class_group public.class_group;

UPDATE public.subjects AS subject
SET class_group = COALESCE(class.class_group, 'science'::public.class_group)
FROM public.classes AS class
WHERE subject.class_id = class.id
  AND subject.class_group IS NULL;

UPDATE public.subjects
SET class_group = 'science'::public.class_group
WHERE class_group IS NULL;

ALTER TABLE public.subjects
  ALTER COLUMN class_group SET NOT NULL;

WITH ranked_subjects AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY class_group, lower(btrim(code))
           ORDER BY is_active DESC, created_at, id
         ) AS duplicate_rank
  FROM public.subjects
)
UPDATE public.subjects AS subject
SET is_active = false
FROM ranked_subjects AS ranked
WHERE ranked.id = subject.id
  AND ranked.duplicate_rank > 1;

CREATE INDEX IF NOT EXISTS subjects_class_group_idx
  ON public.subjects (class_group, is_active, name);

CREATE UNIQUE INDEX IF NOT EXISTS subjects_active_group_code_unique
  ON public.subjects (class_group, lower(btrim(code)))
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.validate_result_subject_and_marks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_subject_group public.class_group;
  v_exam_group public.class_group;
  v_exam_status text;
BEGIN
  SELECT subject.class_group, class.class_group, exam.status
  INTO v_subject_group, v_exam_group, v_exam_status
  FROM public.subjects AS subject
  CROSS JOIN public.result_exams AS exam
  JOIN public.classes AS class ON class.id = exam.class_id
  WHERE subject.id = NEW.subject_id
    AND exam.id = NEW.exam_id;

  IF v_subject_group IS DISTINCT FROM v_exam_group THEN
    RAISE EXCEPTION 'Subject must belong to the exam class group';
  END IF;
  IF v_exam_status = 'published' THEN
    RAISE EXCEPTION 'Return this result to draft before changing its subjects';
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1
    FROM public.result_marks AS mark
    WHERE mark.exam_subject_id = NEW.id
      AND (
        mark.creative_marks > NEW.creative_max
        OR mark.written_marks > NEW.written_max
        OR mark.practical_marks > NEW.practical_max
      )
  ) THEN
    RAISE EXCEPTION 'Configured maximum cannot be lower than marks already entered';
  END IF;
  RETURN NEW;
END;
$$;

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

  SELECT count(*) INTO v_class_count
  FROM public.classes AS class
  WHERE class.id IN (SELECT DISTINCT requested.id FROM unnest(p_class_ids) AS requested(id))
    AND class.is_active = true
    AND class.academic_year_id IS NOT NULL;

  IF v_class_count <> v_requested_count THEN
    RAISE EXCEPTION 'One or more selected classes are unavailable';
  END IF;

  RETURN QUERY
  WITH inserted_exams AS (
    INSERT INTO public.result_exams (
      exam_group_id, class_id, academic_year_id, exam_type_id, title, exam_date, created_by
    )
    SELECT v_group_id, class.id, class.academic_year_id, p_exam_type_id,
           nullif(btrim(p_title), ''), p_exam_date, auth.uid()
    FROM public.classes AS class
    WHERE class.id IN (SELECT DISTINCT requested.id FROM unnest(p_class_ids) AS requested(id))
    RETURNING result_exams.id, result_exams.class_id
  ), attached_subjects AS (
    INSERT INTO public.result_exam_subjects (
      exam_id, subject_id, creative_max, written_max, practical_max, pass_mark, sort_order
    )
    SELECT inserted.id, subject.id, 40, 40, 20, 33,
           (row_number() OVER (PARTITION BY inserted.id ORDER BY subject.name, subject.code) - 1) * 10
    FROM inserted_exams AS inserted
    JOIN public.classes AS class ON class.id = inserted.class_id
    JOIN public.subjects AS subject
      ON subject.class_group = class.class_group
     AND subject.is_active = true
    RETURNING result_exam_subjects.exam_id
  )
  SELECT inserted.id, inserted.class_id
  FROM inserted_exams AS inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.create_result_exams_for_classes(uuid[], uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_result_exams_for_classes(uuid[], uuid, text, date) TO authenticated;

COMMENT ON COLUMN public.subjects.class_group IS
  'Academic group whose result exams use this subject.';
