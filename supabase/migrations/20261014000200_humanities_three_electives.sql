/* Humanities: three compulsory courses, three selected electives and one fourth course. */
DROP TRIGGER students_validate_curriculum_options ON public.students;

UPDATE public.subjects
SET is_fourth_subject = code NOT IN ('101','102','107','108','275')
WHERE class_group = 'humanities';

INSERT INTO public.subject_course_options (
  class_group, name, first_paper_subject_id, second_paper_subject_id,
  available_as_elective, available_as_fourth, is_active
)
SELECT 'humanities'::public.class_group, course.name, first_paper.id, second_paper.id, true, true, true
FROM (VALUES
  ('Civics & Good Governance', '269', '270'),
  ('Social Work', '271', '272'),
  ('Islamic History & Culture', '267', '268'),
  ('Economics', '109', '110'),
  ('Islamic Studies', '249', '250'),
  ('Home Science', '273', '274'),
  ('Logic', '121', '122')
) AS course(name, first_code, second_code)
JOIN public.subjects AS first_paper ON first_paper.class_group = 'humanities' AND first_paper.code = course.first_code
JOIN public.subjects AS second_paper ON second_paper.class_group = 'humanities' AND second_paper.code = course.second_code
ON CONFLICT (class_group, name) DO UPDATE SET
  first_paper_subject_id = EXCLUDED.first_paper_subject_id,
  second_paper_subject_id = EXCLUDED.second_paper_subject_id,
  available_as_elective = true, available_as_fourth = true, is_active = true;

UPDATE public.subject_course_options SET
  is_active = name IN ('Civics & Good Governance','Social Work','Islamic History & Culture','Economics','Islamic Studies','Home Science','Logic'),
  available_as_elective = name IN ('Civics & Good Governance','Social Work','Islamic History & Culture','Economics','Islamic Studies','Home Science','Logic'),
  available_as_fourth = name IN ('Civics & Good Governance','Social Work','Islamic History & Culture','Economics','Islamic Studies','Home Science','Logic')
WHERE class_group = 'humanities';

/* Preserve the previous two fixed courses and chosen elective, without guessing missing choices. */
UPDATE public.students AS student SET
  humanities_main_option_1_id = (SELECT id FROM public.subject_course_options WHERE class_group = 'humanities' AND name = 'Civics & Good Governance'),
  humanities_main_option_2_id = (SELECT id FROM public.subject_course_options WHERE class_group = 'humanities' AND name = 'Social Work'),
  humanities_main_option_3_id = student.group_elective_option_id,
  humanities_fourth_option_id = student.group_fourth_option_id,
  group_elective_option_id = NULL
WHERE student.class_group = 'humanities';

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
  IF NEW.class_group = 'humanities' THEN
    NEW.group_elective_option_id := NULL;
    IF v_group_changed THEN
      IF NOT EXISTS (SELECT 1 FROM public.subject_course_options WHERE id = NEW.humanities_main_option_1_id AND class_group = 'humanities' AND is_active) THEN NEW.humanities_main_option_1_id := NULL; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.subject_course_options WHERE id = NEW.humanities_main_option_2_id AND class_group = 'humanities' AND is_active) THEN NEW.humanities_main_option_2_id := NULL; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.subject_course_options WHERE id = NEW.humanities_main_option_3_id AND class_group = 'humanities' AND is_active) THEN NEW.humanities_main_option_3_id := NULL; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.subject_course_options WHERE id = NEW.group_fourth_option_id AND class_group = 'humanities' AND is_active) THEN NEW.group_fourth_option_id := NULL; END IF;
    END IF;
    IF (SELECT count(*) FROM unnest(ARRAY[NEW.humanities_main_option_1_id,
      NEW.humanities_main_option_2_id, NEW.humanities_main_option_3_id,
      NEW.group_fourth_option_id]) AS choice(id) WHERE id IS NOT NULL)
      <> (SELECT count(DISTINCT id) FROM unnest(ARRAY[NEW.humanities_main_option_1_id,
      NEW.humanities_main_option_2_id, NEW.humanities_main_option_3_id,
      NEW.group_fourth_option_id]) AS choice(id) WHERE id IS NOT NULL) THEN
      RAISE EXCEPTION 'All three electives and the fourth subject must be different';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY[NEW.humanities_main_option_1_id,
        NEW.humanities_main_option_2_id, NEW.humanities_main_option_3_id,
        NEW.group_fourth_option_id]) AS choice(id)
      WHERE choice.id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.subject_course_options AS option
        WHERE option.id = choice.id AND option.class_group = 'humanities'
          AND option.is_active AND option.available_as_elective AND option.available_as_fourth
      )
    ) THEN
      RAISE EXCEPTION 'Choose an active Humanities course';
    END IF;
    NEW.humanities_fourth_option_id := NEW.group_fourth_option_id;
    SELECT * INTO v_option FROM public.subject_course_options WHERE id = NEW.group_fourth_option_id;
    NEW.fourth_subject_id := v_option.first_paper_subject_id;
    NEW.optional_subject_2_id := v_option.second_paper_subject_id;
    RETURN NEW;
  END IF;
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
  BEFORE INSERT OR UPDATE OF class_id, class_group, group_elective_option_id, group_fourth_option_id,
    humanities_main_option_1_id, humanities_main_option_2_id, humanities_main_option_3_id, humanities_fourth_option_id
  ON public.students FOR EACH ROW EXECUTE FUNCTION public.validate_student_curriculum_options();

CREATE OR REPLACE FUNCTION public.student_exam_subject_role(
  p_student_id uuid,
  p_exam_subject_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT subject.is_fourth_subject THEN 'main'
    WHEN exam_subject.subject_id IN (
      fourth_option.first_paper_subject_id,
      fourth_option.second_paper_subject_id,
      student.fourth_subject_id,
      student.optional_subject_2_id
    ) THEN 'fourth'
    WHEN exam_subject.subject_id IN (
      elective.first_paper_subject_id,
      elective.second_paper_subject_id
    ) OR EXISTS (
      SELECT 1 FROM public.subject_course_options AS selected
      WHERE selected.id IN (student.humanities_main_option_1_id,
        student.humanities_main_option_2_id, student.humanities_main_option_3_id)
        AND exam_subject.subject_id IN (selected.first_paper_subject_id, selected.second_paper_subject_id)
    ) THEN 'main'
    ELSE NULL
  END
  FROM public.result_exam_subjects AS exam_subject
  JOIN public.subjects AS subject ON subject.id = exam_subject.subject_id
  JOIN public.students AS student ON student.id = p_student_id
  LEFT JOIN public.subject_course_options AS elective
    ON elective.id = student.group_elective_option_id
  LEFT JOIN public.subject_course_options AS fourth_option
    ON fourth_option.id = student.group_fourth_option_id
  WHERE exam_subject.id = p_exam_subject_id;
$$;

