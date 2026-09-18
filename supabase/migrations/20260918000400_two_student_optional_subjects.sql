ALTER TABLE public.students
  ADD COLUMN optional_subject_2_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD CONSTRAINT students_optional_subjects_distinct
    CHECK (fourth_subject_id IS NULL OR optional_subject_2_id IS NULL
      OR fourth_subject_id <> optional_subject_2_id);

CREATE INDEX students_optional_subject_2_id_idx ON public.students(optional_subject_2_id);

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
  v_subject_id uuid;
  v_slot integer;
BEGIN
  IF NEW.class_id IS NOT NULL THEN
    SELECT class_group INTO v_class_group FROM public.classes WHERE id = NEW.class_id;
    IF v_class_group IS NULL THEN
      RAISE EXCEPTION 'Student class does not exist';
    END IF;

    IF TG_OP = 'INSERT' OR NEW.class_id IS DISTINCT FROM OLD.class_id THEN
      NEW.class_group := v_class_group;
    ELSIF NEW.class_group IS DISTINCT FROM v_class_group THEN
      RAISE EXCEPTION 'Student group must match the assigned class group';
    END IF;
  END IF;

  FOR v_slot IN 1..2 LOOP
    v_subject_id := CASE WHEN v_slot = 1 THEN NEW.fourth_subject_id ELSE NEW.optional_subject_2_id END;
    IF v_subject_id IS NULL THEN CONTINUE; END IF;

    SELECT class_group, is_fourth_subject AND is_active
      INTO v_subject_group, v_subject_available
    FROM public.subjects WHERE id = v_subject_id;

    IF v_subject_group IS NULL OR v_subject_group <> NEW.class_group THEN
      IF TG_OP = 'UPDATE' AND NEW.class_id IS DISTINCT FROM OLD.class_id THEN
        IF v_slot = 1 THEN
          NEW.fourth_subject_id := NULL;
        ELSE
          NEW.optional_subject_2_id := NULL;
        END IF;
      ELSE
        RAISE EXCEPTION 'Optional subjects must belong to the student group';
      END IF;
    ELSIF NOT v_subject_available AND
      (TG_OP = 'INSERT' OR
        (v_slot = 1 AND NEW.fourth_subject_id IS DISTINCT FROM OLD.fourth_subject_id) OR
        (v_slot = 2 AND NEW.optional_subject_2_id IS DISTINCT FROM OLD.optional_subject_2_id)) THEN
      RAISE EXCEPTION 'Select an active optional-subject option';
    END IF;
  END LOOP;

  IF NEW.fourth_subject_id IS NOT NULL AND NEW.fourth_subject_id = NEW.optional_subject_2_id THEN
    RAISE EXCEPTION 'Choose two different optional subjects';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER students_group_and_fourth_subject ON public.students;
CREATE TRIGGER students_group_and_fourth_subject
  BEFORE INSERT OR UPDATE OF class_id, class_group, fourth_subject_id, optional_subject_2_id
  ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.validate_student_group_and_fourth_subject();

CREATE OR REPLACE FUNCTION public.sync_students_after_class_group_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.students AS student
  SET class_group = NEW.class_group,
      fourth_subject_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.subjects
          WHERE id = student.fourth_subject_id AND class_group = NEW.class_group
        ) THEN student.fourth_subject_id ELSE NULL
      END,
      optional_subject_2_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.subjects
          WHERE id = student.optional_subject_2_id AND class_group = NEW.class_group
        ) THEN student.optional_subject_2_id ELSE NULL
      END
  WHERE student.class_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_assigned_fourth_subject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NOT NEW.is_fourth_subject OR NOT NEW.is_active OR NEW.class_group IS DISTINCT FROM OLD.class_group)
    AND EXISTS (
      SELECT 1 FROM public.students
      WHERE fourth_subject_id = OLD.id OR optional_subject_2_id = OLD.id
    ) THEN
    RAISE EXCEPTION 'Reassign students before removing this optional-subject option';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.students.fourth_subject_id IS
  'First optional subject from the student group; grading does not use it yet.';
COMMENT ON COLUMN public.students.optional_subject_2_id IS
  'Second, distinct optional subject from the student group; grading does not use it yet.';
