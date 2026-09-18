ALTER TABLE public.students
  ADD COLUMN class_group public.class_group NOT NULL DEFAULT 'science',
  ADD COLUMN fourth_subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;

UPDATE public.students AS student
SET class_group = class.class_group
FROM public.classes AS class
WHERE student.class_id = class.id;

CREATE INDEX students_fourth_subject_id_idx ON public.students(fourth_subject_id);

CREATE OR REPLACE FUNCTION public.validate_student_group_and_fourth_subject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_group public.class_group;
  v_subject_group public.class_group;
  v_subject_available boolean;
BEGIN
  IF NEW.class_id IS NOT NULL THEN
    SELECT class_group INTO v_class_group FROM public.classes WHERE id = NEW.class_id;
    IF v_class_group IS NULL THEN
      RAISE EXCEPTION 'Student class does not exist';
    END IF;

    -- The class determines the group, including when an existing student is promoted.
    IF TG_OP = 'INSERT' OR NEW.class_id IS DISTINCT FROM OLD.class_id THEN
      NEW.class_group := v_class_group;
    ELSIF NEW.class_group IS DISTINCT FROM v_class_group THEN
      RAISE EXCEPTION 'Student group must match the assigned class group';
    END IF;
  END IF;

  IF NEW.fourth_subject_id IS NOT NULL THEN
    SELECT class_group, is_fourth_subject AND is_active
    INTO v_subject_group, v_subject_available
    FROM public.subjects WHERE id = NEW.fourth_subject_id;

    IF v_subject_group IS NULL OR v_subject_group <> NEW.class_group THEN
      IF TG_OP = 'UPDATE' AND NEW.class_id IS DISTINCT FROM OLD.class_id THEN
        NEW.fourth_subject_id := NULL;
      ELSE
        RAISE EXCEPTION 'Fourth subject must belong to the student group';
      END IF;
    ELSIF NOT v_subject_available AND
      (TG_OP = 'INSERT' OR NEW.fourth_subject_id IS DISTINCT FROM OLD.fourth_subject_id) THEN
      RAISE EXCEPTION 'Select an active fourth-subject option';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER students_group_and_fourth_subject
  BEFORE INSERT OR UPDATE OF class_id, class_group, fourth_subject_id
  ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.validate_student_group_and_fourth_subject();

COMMENT ON COLUMN public.students.class_group IS
  'Academic group; follows the assigned class when the student changes class.';
COMMENT ON COLUMN public.students.fourth_subject_id IS
  'One optional fourth subject from the student group; grading does not use it yet.';
