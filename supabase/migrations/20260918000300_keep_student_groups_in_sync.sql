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
        WHEN subject.class_group = NEW.class_group THEN student.fourth_subject_id
        ELSE NULL
      END
  FROM public.subjects AS subject
  WHERE student.class_id = NEW.id
    AND student.fourth_subject_id = subject.id;

  UPDATE public.students
  SET class_group = NEW.class_group
  WHERE class_id = NEW.id
    AND fourth_subject_id IS NULL;

  RETURN NEW;
END;
$$;

CREATE TRIGGER classes_sync_student_groups
  AFTER UPDATE OF class_group ON public.classes
  FOR EACH ROW
  WHEN (OLD.class_group IS DISTINCT FROM NEW.class_group)
  EXECUTE FUNCTION public.sync_students_after_class_group_change();

CREATE OR REPLACE FUNCTION public.protect_assigned_fourth_subject()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NOT NEW.is_fourth_subject OR NOT NEW.is_active OR NEW.class_group IS DISTINCT FROM OLD.class_group)
    AND EXISTS (SELECT 1 FROM public.students WHERE fourth_subject_id = OLD.id) THEN
    RAISE EXCEPTION 'Reassign students before removing this fourth-subject option';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subjects_protect_assigned_fourth_subject
  BEFORE UPDATE OF class_group, is_fourth_subject, is_active ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.protect_assigned_fourth_subject();
