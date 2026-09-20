/* Select Science and Business fourth subjects once at the course level. */

INSERT INTO public.subject_course_options (
  class_group, name, first_paper_subject_id, second_paper_subject_id, exclusive_group
)
SELECT
  option.class_group::public.class_group,
  option.name,
  first_paper.id,
  second_paper.id,
  NULL
FROM (
  VALUES
    ('science', 'Biology', '178', '179'),
    ('science', 'Higher Mathematics', '265', '266'),
    ('business', 'Finance, Banking & Insurance', '292', '293'),
    ('business', 'Production Management & Marketing', '286', '287')
) AS option(class_group, name, first_code, second_code)
JOIN public.subjects first_paper
  ON first_paper.class_group = option.class_group::public.class_group
 AND first_paper.code = option.first_code
JOIN public.subjects second_paper
  ON second_paper.class_group = option.class_group::public.class_group
 AND second_paper.code = option.second_code
ON CONFLICT (class_group, name) DO UPDATE SET
  first_paper_subject_id = EXCLUDED.first_paper_subject_id,
  second_paper_subject_id = EXCLUDED.second_paper_subject_id,
  is_active = true;

ALTER TABLE public.students
  ADD COLUMN group_fourth_option_id uuid REFERENCES public.subject_course_options(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.apply_group_fourth_subject_option()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_option_group public.class_group;
  v_first_paper_id uuid;
  v_second_paper_id uuid;
BEGIN
  IF NEW.class_group = 'humanities' THEN
    NEW.group_fourth_option_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.group_fourth_option_id IS NULL THEN
    NEW.fourth_subject_id := NULL;
    NEW.optional_subject_2_id := NULL;
    RETURN NEW;
  END IF;

  SELECT class_group, first_paper_subject_id, second_paper_subject_id
  INTO v_option_group, v_first_paper_id, v_second_paper_id
  FROM public.subject_course_options
  WHERE id = NEW.group_fourth_option_id
    AND is_active = true;

  IF v_option_group IS NULL OR v_option_group <> NEW.class_group THEN
    IF TG_OP = 'UPDATE' AND NEW.class_group IS DISTINCT FROM OLD.class_group THEN
      NEW.group_fourth_option_id := NULL;
      NEW.fourth_subject_id := NULL;
      NEW.optional_subject_2_id := NULL;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Fourth-subject option must belong to the student group';
  END IF;

  NEW.fourth_subject_id := v_first_paper_id;
  NEW.optional_subject_2_id := v_second_paper_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER students_apply_group_fourth_option
  BEFORE INSERT OR UPDATE OF class_group, group_fourth_option_id
  ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_group_fourth_subject_option();

UPDATE public.students AS student
SET group_fourth_option_id = option.id
FROM public.subject_course_options AS option
WHERE student.class_group IN ('science', 'business')
  AND option.class_group = student.class_group
  AND (
    (student.fourth_subject_id = option.first_paper_subject_id
      AND student.optional_subject_2_id = option.second_paper_subject_id)
    OR
    (student.fourth_subject_id = option.second_paper_subject_id
      AND student.optional_subject_2_id = option.first_paper_subject_id)
  );

COMMENT ON COLUMN public.students.group_fourth_option_id IS
  'Course-level fourth-subject selection for Science and Business; both paper IDs are synchronized automatically.';
