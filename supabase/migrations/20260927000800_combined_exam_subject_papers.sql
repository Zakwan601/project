/* Allow an examination to combine first and second papers into one configured subject. */

CREATE TABLE public.result_subject_paper_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_group public.class_group NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  code text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 80),
  first_paper_subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  second_paper_subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (first_paper_subject_id <> second_paper_subject_id),
  UNIQUE (class_group, first_paper_subject_id, second_paper_subject_id)
);

CREATE UNIQUE INDEX result_subject_paper_groups_name_unique
  ON public.result_subject_paper_groups (class_group, lower(btrim(name)));

CREATE TRIGGER result_subject_paper_groups_updated_at
  BEFORE UPDATE ON public.result_subject_paper_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/* Existing course options already contain authoritative paper pairs. */
INSERT INTO public.result_subject_paper_groups (
  class_group, name, code, first_paper_subject_id, second_paper_subject_id
)
SELECT
  option.class_group,
  option.name,
  concat(first_paper.code, '+', second_paper.code),
  option.first_paper_subject_id,
  option.second_paper_subject_id
FROM public.subject_course_options AS option
JOIN public.subjects AS first_paper ON first_paper.id = option.first_paper_subject_id
JOIN public.subjects AS second_paper ON second_paper.id = option.second_paper_subject_id
ON CONFLICT (class_group, first_paper_subject_id, second_paper_subject_id) DO UPDATE SET
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  is_active = true;

/* Discover core pairs such as Bangla 1st Paper / Bangla 2nd Paper. */
WITH paper_subjects AS (
  SELECT
    subject.*,
    btrim(regexp_replace(subject.name, '\s+(1st|first|2nd|second)\s+paper\s*$', '', 'i')) AS base_name,
    CASE
      WHEN subject.name ~* '\s+(1st|first)\s+paper\s*$' THEN 1
      WHEN subject.name ~* '\s+(2nd|second)\s+paper\s*$' THEN 2
    END AS paper_number
  FROM public.subjects AS subject
  WHERE subject.name ~* '\s+(1st|first|2nd|second)\s+paper\s*$'
)
INSERT INTO public.result_subject_paper_groups (
  class_group, name, code, first_paper_subject_id, second_paper_subject_id
)
SELECT
  first_paper.class_group,
  first_paper.base_name,
  concat(first_paper.code, '+', second_paper.code),
  first_paper.id,
  second_paper.id
FROM paper_subjects AS first_paper
JOIN paper_subjects AS second_paper
  ON second_paper.class_group = first_paper.class_group
 AND lower(second_paper.base_name) = lower(first_paper.base_name)
 AND second_paper.paper_number = 2
WHERE first_paper.paper_number = 1
ON CONFLICT (class_group, first_paper_subject_id, second_paper_subject_id) DO UPDATE SET
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  is_active = true;

ALTER TABLE public.result_subject_paper_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY result_subject_paper_groups_read ON public.result_subject_paper_groups
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.result_subject_paper_groups TO authenticated;

ALTER TABLE public.result_exams
  ADD COLUMN combine_subject_papers boolean NOT NULL DEFAULT false;

ALTER TABLE public.result_exam_subjects
  ADD COLUMN paper_group_id uuid REFERENCES public.result_subject_paper_groups(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX result_exam_subjects_exam_paper_group_unique
  ON public.result_exam_subjects (exam_id, paper_group_id)
  WHERE paper_group_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_result_exam_subject_paper_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_combined boolean;
  v_class_group public.class_group;
  v_group public.result_subject_paper_groups%ROWTYPE;
BEGIN
  SELECT exam.combine_subject_papers, class.class_group
  INTO v_combined, v_class_group
  FROM public.result_exams AS exam
  JOIN public.classes AS class ON class.id = exam.class_id
  WHERE exam.id = NEW.exam_id;

  IF NEW.paper_group_id IS NOT NULL THEN
    SELECT * INTO v_group
    FROM public.result_subject_paper_groups
    WHERE id = NEW.paper_group_id AND is_active = true;

    IF NOT FOUND THEN RAISE EXCEPTION 'Select an active subject paper group'; END IF;
    IF NOT v_combined THEN RAISE EXCEPTION 'Paper groups can only be used by a combined-paper examination'; END IF;
    IF v_group.class_group <> v_class_group OR NEW.subject_id <> v_group.first_paper_subject_id THEN
      RAISE EXCEPTION 'The combined subject does not match the examination class';
    END IF;
  ELSIF v_combined AND EXISTS (
    SELECT 1
    FROM public.result_subject_paper_groups AS paper_group
    WHERE paper_group.is_active = true
      AND paper_group.class_group = v_class_group
      AND NEW.subject_id IN (paper_group.first_paper_subject_id, paper_group.second_paper_subject_id)
  ) THEN
    RAISE EXCEPTION 'Choose the combined subject instead of an individual paper';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_result_exam_subject_paper_mode_before_write
  BEFORE INSERT OR UPDATE OF exam_id, subject_id, paper_group_id ON public.result_exam_subjects
  FOR EACH ROW EXECUTE FUNCTION public.validate_result_exam_subject_paper_mode();

CREATE OR REPLACE FUNCTION public.sync_result_subject_paper_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_name text;
  v_paper_number integer;
  v_first public.subjects%ROWTYPE;
  v_second public.subjects%ROWTYPE;
BEGIN
  UPDATE public.result_subject_paper_groups
  SET is_active = false
  WHERE NEW.id IN (first_paper_subject_id, second_paper_subject_id);

  v_base_name := btrim(regexp_replace(NEW.name, '\s+(1st|first|2nd|second)\s+paper\s*$', '', 'i'));
  v_paper_number := CASE
    WHEN NEW.name ~* '\s+(1st|first)\s+paper\s*$' THEN 1
    WHEN NEW.name ~* '\s+(2nd|second)\s+paper\s*$' THEN 2
  END;
  IF v_paper_number IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_first
  FROM public.subjects AS subject
  WHERE subject.class_group = NEW.class_group
    AND subject.name ~* '\s+(1st|first)\s+paper\s*$'
    AND lower(btrim(regexp_replace(subject.name, '\s+(1st|first)\s+paper\s*$', '', 'i'))) = lower(v_base_name)
  ORDER BY subject.created_at, subject.id
  LIMIT 1;

  SELECT * INTO v_second
  FROM public.subjects AS subject
  WHERE subject.class_group = NEW.class_group
    AND subject.name ~* '\s+(2nd|second)\s+paper\s*$'
    AND lower(btrim(regexp_replace(subject.name, '\s+(2nd|second)\s+paper\s*$', '', 'i'))) = lower(v_base_name)
  ORDER BY subject.created_at, subject.id
  LIMIT 1;

  IF v_first.id IS NOT NULL AND v_second.id IS NOT NULL THEN
    INSERT INTO public.result_subject_paper_groups (
      class_group, name, code, first_paper_subject_id, second_paper_subject_id, is_active
    ) VALUES (
      NEW.class_group, v_base_name, concat(v_first.code, '+', v_second.code),
      v_first.id, v_second.id, v_first.is_active AND v_second.is_active
    )
    ON CONFLICT (class_group, first_paper_subject_id, second_paper_subject_id) DO UPDATE SET
      name = EXCLUDED.name,
      code = EXCLUDED.code,
      is_active = EXCLUDED.is_active;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_result_subject_paper_group_after_write
  AFTER INSERT OR UPDATE OF name, code, class_group, is_active ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.sync_result_subject_paper_group();

DROP FUNCTION public.create_result_exams_for_classes(uuid[], uuid, text, date, boolean);

CREATE FUNCTION public.create_result_exams_for_classes(
  p_class_ids uuid[],
  p_exam_type_id uuid,
  p_title text,
  p_exam_date date,
  p_has_regular_classes boolean,
  p_combine_subject_papers boolean
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
    exam_date, has_regular_classes, combine_subject_papers, created_by
  )
  SELECT
    v_group_id, class.id, class.academic_year_id, p_exam_type_id,
    nullif(btrim(p_title), ''), p_exam_date, coalesce(p_has_regular_classes, true),
    coalesce(p_combine_subject_papers, false), auth.uid()
  FROM public.classes AS class
  WHERE class.id IN (SELECT DISTINCT requested.id FROM unnest(p_class_ids) AS requested(id))
  RETURNING result_exams.id, result_exams.class_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_result_exams_for_classes(uuid[], uuid, text, date, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_result_exams_for_classes(uuid[], uuid, text, date, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_result_exam_routine_entry(
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
  v_paper_group public.result_subject_paper_groups%ROWTYPE;
  v_has_regular_classes boolean;
  v_combine_subject_papers boolean;
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
    bool_and(exam.has_regular_classes),
    bool_and(exam.combine_subject_papers)
  INTO v_group_count, v_has_regular_classes, v_combine_subject_papers
  FROM public.result_exams AS exam
  WHERE exam.id IN (SELECT DISTINCT requested.id FROM unnest(p_exam_ids) AS requested(id));

  IF v_group_count <> 1 THEN
    RAISE EXCEPTION 'All selected classes must belong to the same examination';
  END IF;

  IF v_combine_subject_papers THEN
    SELECT * INTO v_paper_group
    FROM public.result_subject_paper_groups AS paper_group
    WHERE paper_group.is_active = true
      AND p_subject_id IN (paper_group.first_paper_subject_id, paper_group.second_paper_subject_id)
    ORDER BY paper_group.created_at
    LIMIT 1;

    IF FOUND THEN
      SELECT * INTO v_subject
      FROM public.subjects
      WHERE id = v_paper_group.first_paper_subject_id AND is_active = true;
    END IF;
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
      subject_name = CASE WHEN v_paper_group.id IS NOT NULL THEN v_paper_group.name ELSE v_subject.name END,
      has_regular_classes = v_has_regular_classes
  WHERE id = v_schedule_id;

  RETURN v_schedule_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.build_student_result(p_exam_id uuid, p_student_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH exam_info AS (
    SELECT exam.id, exam.exam_date, exam.status, exam.title,
           type.name AS exam_type, class.id AS class_id, class.name AS class_name,
           class.grade, class.section, year.name AS academic_year
    FROM public.result_exams AS exam
    JOIN public.result_exam_types AS type ON type.id = exam.exam_type_id
    JOIN public.classes AS class ON class.id = exam.class_id
    JOIN public.academic_years AS year ON year.id = exam.academic_year_id
    WHERE exam.id = p_exam_id
  ), student_info AS (
    SELECT student.id, student.admission_number,
           trim(student.first_name || ' ' || student.last_name) AS full_name,
           COALESCE(enrollment.roll_number, student.roll_number) AS roll_number
    FROM public.students AS student
    CROSS JOIN exam_info AS exam
    LEFT JOIN public.student_enrollments AS enrollment
      ON enrollment.student_id = student.id AND enrollment.class_id = exam.class_id
      AND enrollment.started_on <= exam.exam_date
      AND (enrollment.ended_on IS NULL OR enrollment.ended_on >= exam.exam_date)
    WHERE student.id = p_student_id
    ORDER BY enrollment.started_on DESC NULLS LAST
    LIMIT 1
  ), scored AS (
    SELECT exam_subject.id,
           COALESCE(paper_group.name, subject.name) AS name,
           COALESCE(paper_group.code, subject.code) AS code,
           exam_subject.sort_order,
           exam_subject.creative_max, exam_subject.written_max, exam_subject.practical_max,
           exam_subject.pass_mark, mark.creative_marks, mark.written_marks,
           mark.practical_marks, COALESCE(mark.is_absent, false) AS is_absent,
           mark.remarks,
           COALESCE(mark.creative_marks, 0) + COALESCE(mark.written_marks, 0) + COALESCE(mark.practical_marks, 0) AS obtained,
           exam_subject.creative_max + exam_subject.written_max + exam_subject.practical_max AS total_max
    FROM public.result_exam_subjects AS exam_subject
    JOIN public.subjects AS subject ON subject.id = exam_subject.subject_id
    LEFT JOIN public.result_subject_paper_groups AS paper_group ON paper_group.id = exam_subject.paper_group_id
    LEFT JOIN public.result_marks AS mark
      ON mark.exam_subject_id = exam_subject.id AND mark.student_id = p_student_id
    WHERE exam_subject.exam_id = p_exam_id
  ), graded AS (
    SELECT scored.*,
      (NOT is_absent AND obtained >= pass_mark) AS passed,
      CASE WHEN is_absent OR obtained < pass_mark THEN 'F'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 80 THEN 'A+'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 70 THEN 'A'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 60 THEN 'A-'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 50 THEN 'B'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 40 THEN 'C'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 33 THEN 'D' ELSE 'F' END AS letter_grade,
      CASE WHEN is_absent OR obtained < pass_mark THEN 0
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 80 THEN 5
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 70 THEN 4
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 60 THEN 3.5
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 50 THEN 3
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 40 THEN 2
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 33 THEN 1 ELSE 0 END::numeric AS grade_point
    FROM scored
  ), summary AS (
    SELECT COALESCE(sum(obtained), 0) AS total_obtained,
           COALESCE(sum(total_max), 0) AS total_max,
           count(*) FILTER (WHERE NOT passed) AS failed_subjects,
           CASE WHEN count(*) = 0 OR count(*) FILTER (WHERE NOT passed) > 0 THEN 0
                ELSE round(avg(grade_point), 2) END AS gpa
    FROM graded
  ), all_totals AS (
    SELECT mark.student_id,
           sum(COALESCE(mark.creative_marks, 0) + COALESCE(mark.written_marks, 0) + COALESCE(mark.practical_marks, 0)) AS obtained
    FROM public.result_marks AS mark
    JOIN public.result_exam_subjects AS exam_subject ON exam_subject.id = mark.exam_subject_id
    WHERE exam_subject.exam_id = p_exam_id
    GROUP BY mark.student_id
  ), ranking AS (
    SELECT student_id, rank() OVER (ORDER BY obtained DESC) AS position,
           count(*) OVER () AS total_students
    FROM all_totals
  )
  SELECT jsonb_build_object(
    'exam', (SELECT to_jsonb(exam_info) FROM exam_info),
    'student', (SELECT to_jsonb(student_info) FROM student_info),
    'subjects', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'code', code,
      'creative_max', creative_max, 'creative_marks', creative_marks,
      'written_max', written_max, 'written_marks', written_marks,
      'practical_max', practical_max, 'practical_marks', practical_marks,
      'pass_mark', pass_mark, 'obtained', obtained, 'total_max', total_max,
      'is_absent', is_absent, 'remarks', remarks, 'passed', passed,
      'letter_grade', letter_grade, 'grade_point', grade_point
    ) ORDER BY sort_order, name) FROM graded), '[]'::jsonb),
    'summary', (SELECT jsonb_build_object(
      'total_obtained', total_obtained, 'total_max', total_max,
      'failed_subjects', failed_subjects, 'gpa', gpa,
      'letter_grade', CASE WHEN failed_subjects > 0 OR gpa < 1 THEN 'F'
        WHEN gpa >= 5 THEN 'A+' WHEN gpa >= 4 THEN 'A' WHEN gpa >= 3.5 THEN 'A-'
        WHEN gpa >= 3 THEN 'B' WHEN gpa >= 2 THEN 'C' ELSE 'D' END,
      'position', ranking.position, 'total_students', ranking.total_students
    ) FROM summary LEFT JOIN ranking ON ranking.student_id = p_student_id)
  );
$$;

COMMENT ON COLUMN public.result_exams.combine_subject_papers IS
  'When true, every configured first/second-paper pair is represented by one combined subject.';
COMMENT ON TABLE public.result_subject_paper_groups IS
  'Maps first and second paper catalogue subjects to the single subject shown in combined-paper examinations.';
