/* Match Business Studies and Humanities subject choices to the official forms. */

ALTER TABLE public.subject_course_options
  ADD COLUMN available_as_elective boolean NOT NULL DEFAULT false,
  ADD COLUMN available_as_fourth boolean NOT NULL DEFAULT false;

ALTER TABLE public.students
  ADD COLUMN group_elective_option_id uuid
    REFERENCES public.subject_course_options(id) ON DELETE SET NULL;

CREATE INDEX students_group_elective_option_id_idx
  ON public.students(group_elective_option_id);

WITH curriculum(class_group, name, code, is_optional) AS (
  VALUES
    ('business'::public.class_group, 'Bangla 1st Paper', '101', false),
    ('business'::public.class_group, 'Bangla 2nd Paper', '102', false),
    ('business'::public.class_group, 'English 1st Paper', '107', false),
    ('business'::public.class_group, 'English 2nd Paper', '108', false),
    ('business'::public.class_group, 'Information & Communication Technology', '275', false),
    ('business'::public.class_group, 'Accounting 1st Paper', '253', false),
    ('business'::public.class_group, 'Accounting 2nd Paper', '254', false),
    ('business'::public.class_group, 'Business Organization & Management 1st Paper', '277', false),
    ('business'::public.class_group, 'Business Organization & Management 2nd Paper', '278', false),
    ('business'::public.class_group, 'Production Management & Marketing 1st Paper', '286', true),
    ('business'::public.class_group, 'Production Management & Marketing 2nd Paper', '287', true),
    ('business'::public.class_group, 'Finance, Banking & Insurance 1st Paper', '292', true),
    ('business'::public.class_group, 'Finance, Banking & Insurance 2nd Paper', '293', true),
    ('business'::public.class_group, 'Home Science 1st Paper', '273', true),
    ('business'::public.class_group, 'Home Science 2nd Paper', '274', true)
)
INSERT INTO public.subjects (name, code, class_group, is_fourth_subject, is_active)
SELECT name, code, class_group, is_optional, true
FROM curriculum
WHERE NOT EXISTS (
  SELECT 1 FROM public.subjects AS subject
  WHERE subject.class_group = curriculum.class_group
    AND lower(btrim(subject.code)) = lower(curriculum.code)
);

WITH humanities_curriculum(name, code, is_optional) AS (
  VALUES
    ('Bangla 1st Paper', '101', false), ('Bangla 2nd Paper', '102', false),
    ('English 1st Paper', '107', false), ('English 2nd Paper', '108', false),
    ('Information & Communication Technology', '275', false),
    ('Civics & Good Governance 1st Paper', '269', false),
    ('Civics & Good Governance 2nd Paper', '270', false),
    ('Social Work 1st Paper', '271', false), ('Social Work 2nd Paper', '272', false),
    ('Islamic History & Culture 1st Paper', '267', true),
    ('Islamic History & Culture 2nd Paper', '268', true),
    ('Economics 1st Paper', '109', true), ('Economics 2nd Paper', '110', true),
    ('Islamic Studies 1st Paper', '249', true), ('Islamic Studies 2nd Paper', '250', true),
    ('Home Science 1st Paper', '273', true), ('Home Science 2nd Paper', '274', true),
    ('Logic 1st Paper', '121', true), ('Logic 2nd Paper', '122', true)
)
INSERT INTO public.subjects (name, code, class_group, is_fourth_subject, is_active)
SELECT name, code, 'humanities'::public.class_group, is_optional, true
FROM humanities_curriculum
WHERE NOT EXISTS (
  SELECT 1 FROM public.subjects AS subject
  WHERE subject.class_group = 'humanities'
    AND lower(btrim(subject.code)) = lower(humanities_curriculum.code)
);

UPDATE public.subjects
SET is_active = true,
    is_fourth_subject = code IN ('286','287','292','293','273','274')
WHERE class_group = 'business'
  AND code IN ('101','102','107','108','275','253','254','277','278','286','287','292','293','273','274');

UPDATE public.subjects
SET is_active = true,
    is_fourth_subject = code IN ('267','268','109','110','249','250','273','274','121','122')
WHERE class_group = 'humanities'
  AND code IN ('101','102','107','108','275','269','270','271','272','267','268','109','110','249','250','273','274','121','122');

UPDATE public.subject_course_options
SET available_as_elective = false,
    available_as_fourth = false;

UPDATE public.subject_course_options
SET available_as_fourth = true
WHERE class_group = 'science' AND is_active = true;

UPDATE public.subject_course_options
SET available_as_elective = true,
    available_as_fourth = true,
    is_active = true
WHERE class_group = 'business'
  AND name IN ('Production Management & Marketing', 'Finance, Banking & Insurance');

UPDATE public.subject_course_options
SET available_as_elective = true,
    is_active = true
WHERE class_group = 'humanities'
  AND name IN ('Islamic History & Culture', 'Economics');

UPDATE public.subject_course_options
SET available_as_fourth = true,
    is_active = true
WHERE class_group = 'humanities'
  AND name IN ('Islamic Studies', 'Logic');

INSERT INTO public.subject_course_options (
  class_group, name, first_paper_subject_id, second_paper_subject_id,
  exclusive_group, available_as_elective, available_as_fourth, is_active
)
SELECT
  requested.class_group::public.class_group,
  'Home Science',
  first_paper.id,
  second_paper.id,
  NULL,
  false,
  true,
  true
FROM (VALUES ('business'), ('humanities')) AS requested(class_group)
JOIN public.subjects AS first_paper
  ON first_paper.class_group = requested.class_group::public.class_group
 AND first_paper.code = '273'
JOIN public.subjects AS second_paper
  ON second_paper.class_group = requested.class_group::public.class_group
 AND second_paper.code = '274'
ON CONFLICT (class_group, name) DO UPDATE SET
  first_paper_subject_id = EXCLUDED.first_paper_subject_id,
  second_paper_subject_id = EXCLUDED.second_paper_subject_id,
  available_as_elective = false,
  available_as_fourth = true,
  is_active = true;

UPDATE public.subject_course_options
SET is_active = false
WHERE class_group = 'humanities'
  AND name NOT IN (
    'Islamic History & Culture', 'Economics',
    'Islamic Studies', 'Home Science', 'Logic'
  );

DROP TRIGGER IF EXISTS students_validate_humanities_subject_choices ON public.students;
DROP TRIGGER IF EXISTS students_apply_group_fourth_option ON public.students;
DROP FUNCTION IF EXISTS public.validate_humanities_subject_choices();
DROP FUNCTION IF EXISTS public.apply_group_fourth_subject_option();

CREATE OR REPLACE FUNCTION public.validate_student_curriculum_options()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_option public.subject_course_options%ROWTYPE;
  v_group_changed boolean :=
    TG_OP = 'UPDATE'
    AND (NEW.class_id IS DISTINCT FROM OLD.class_id
      OR NEW.class_group IS DISTINCT FROM OLD.class_group);
BEGIN
  IF NEW.class_group = 'science' THEN
    NEW.group_elective_option_id := NULL;
  END IF;

  IF NEW.group_elective_option_id IS NOT NULL THEN
    SELECT * INTO v_option
    FROM public.subject_course_options
    WHERE id = NEW.group_elective_option_id
      AND is_active = true
      AND available_as_elective = true;

    IF NOT FOUND OR v_option.class_group <> NEW.class_group THEN
      IF v_group_changed THEN
        NEW.group_elective_option_id := NULL;
      ELSE
        RAISE EXCEPTION 'Elective subject must be an active option for the student group';
      END IF;
    END IF;
  END IF;

  IF NEW.group_fourth_option_id IS NOT NULL THEN
    SELECT * INTO v_option
    FROM public.subject_course_options
    WHERE id = NEW.group_fourth_option_id
      AND is_active = true
      AND available_as_fourth = true;

    IF NOT FOUND OR v_option.class_group <> NEW.class_group THEN
      IF v_group_changed THEN
        NEW.group_fourth_option_id := NULL;
        NEW.fourth_subject_id := NULL;
        NEW.optional_subject_2_id := NULL;
      ELSE
        RAISE EXCEPTION 'Fourth subject must be an active option for the student group';
      END IF;
    ELSE
      NEW.fourth_subject_id := v_option.first_paper_subject_id;
      NEW.optional_subject_2_id := v_option.second_paper_subject_id;
    END IF;
  ELSE
    NEW.fourth_subject_id := NULL;
    NEW.optional_subject_2_id := NULL;
  END IF;

  IF NEW.group_elective_option_id IS NOT NULL
     AND NEW.group_elective_option_id = NEW.group_fourth_option_id THEN
    RAISE EXCEPTION 'Elective and fourth subjects must be different';
  END IF;

  NEW.humanities_main_option_1_id := NULL;
  NEW.humanities_main_option_2_id := NULL;
  NEW.humanities_main_option_3_id := NULL;
  NEW.humanities_fourth_option_id := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER students_validate_curriculum_options
  BEFORE INSERT OR UPDATE OF class_id, class_group,
    group_elective_option_id, group_fourth_option_id
  ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.validate_student_curriculum_options();

UPDATE public.students AS student
SET
  group_elective_option_id = CASE
    WHEN student.class_group = 'humanities' THEN (
      SELECT option.id
      FROM public.subject_course_options AS option
      WHERE option.id = ANY(ARRAY[
          student.humanities_main_option_1_id,
          student.humanities_main_option_2_id,
          student.humanities_main_option_3_id
        ])
        AND option.available_as_elective = true
        AND option.is_active = true
      ORDER BY array_position(ARRAY[
          student.humanities_main_option_1_id,
          student.humanities_main_option_2_id,
          student.humanities_main_option_3_id
        ], option.id)
      LIMIT 1
    )
    WHEN student.class_group = 'business' THEN (
      SELECT option.id
      FROM public.subject_course_options AS option
      WHERE student.group_fourth_option_id IS NOT NULL
        AND option.class_group = 'business'
        AND option.available_as_elective = true
        AND option.is_active = true
        AND option.id IS DISTINCT FROM student.group_fourth_option_id
      ORDER BY option.name
      LIMIT 1
    )
    ELSE NULL
  END,
  group_fourth_option_id = CASE
    WHEN student.class_group = 'humanities' THEN (
      SELECT option.id
      FROM public.subject_course_options AS option
      WHERE option.id = student.humanities_fourth_option_id
        AND option.available_as_fourth = true
        AND option.is_active = true
    )
    ELSE student.group_fourth_option_id
  END;

UPDATE public.subjects
SET is_active = false
WHERE class_group = 'humanities'
  AND code IN ('304','305','117','118','125','126');

COMMENT ON COLUMN public.subject_course_options.available_as_elective IS
  'Whether this two-paper course may be selected as the group elective.';
COMMENT ON COLUMN public.subject_course_options.available_as_fourth IS
  'Whether this two-paper course may be selected as the fourth subject.';
COMMENT ON COLUMN public.students.group_elective_option_id IS
  'Selected two-paper elective course for Business Studies or Humanities.';
COMMENT ON COLUMN public.students.group_fourth_option_id IS
  'Selected two-paper fourth subject for the student group.';
