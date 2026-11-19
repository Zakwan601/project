ALTER TABLE public.result_exam_types ADD COLUMN marks_mode text NOT NULL DEFAULT 'sectioned'
  CHECK (marks_mode IN ('sectioned','total_only'));
INSERT INTO public.result_exam_types(name,marks_mode,sort_order)
  VALUES ('Tutorial exam','total_only',50);

-- Reuse the existing mark storage: written_max/written_marks hold a tutorial's
-- single total. The UI and result payload describe this as Total, never MCQ.
CREATE FUNCTION public.validate_tutorial_exam_subject()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.result_exams e JOIN public.result_exam_types t ON t.id=e.exam_type_id
    WHERE e.id=NEW.exam_id AND t.marks_mode='total_only') AND (
      NEW.creative_max<>0 OR NEW.practical_max<>0 OR NEW.written_max<=0
      OR NEW.pass_mark<>0 OR NEW.creative_pass_mark<>0 OR NEW.written_pass_mark<>0 OR NEW.practical_pass_mark<>0
    ) THEN
    RAISE EXCEPTION 'Tutorial exams require only a positive total mark, with no section distribution or pass marks';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_tutorial_exam_subject BEFORE INSERT OR UPDATE ON public.result_exam_subjects
  FOR EACH ROW EXECUTE FUNCTION public.validate_tutorial_exam_subject();
REVOKE ALL ON FUNCTION public.validate_tutorial_exam_subject() FROM PUBLIC, anon, authenticated;

-- Avoid silently reinterpreting marks already entered in a different format.
CREATE FUNCTION public.protect_configured_exam_marks_mode()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (SELECT marks_mode FROM public.result_exam_types WHERE id=OLD.exam_type_id)
    IS DISTINCT FROM (SELECT marks_mode FROM public.result_exam_types WHERE id=NEW.exam_type_id)
    AND EXISTS(SELECT 1 FROM public.result_exam_subjects WHERE exam_id=OLD.id) THEN
    RAISE EXCEPTION 'Create a new examination to switch between tutorial and section-based marks after subjects are configured';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_configured_exam_marks_mode BEFORE UPDATE OF exam_type_id ON public.result_exams
  FOR EACH ROW EXECUTE FUNCTION public.protect_configured_exam_marks_mode();
REVOKE ALL ON FUNCTION public.protect_configured_exam_marks_mode() FROM PUBLIC, anon, authenticated;

-- Preserve curriculum, teacher scope, paper grouping, totals and ranking. Only
-- grade-related payload fields are suppressed for a total-only assessment.
DO $patch$
DECLARE definition text; rule record;
BEGIN
  SELECT pg_get_functiondef('public.build_student_result(uuid,uuid)'::regprocedure) INTO definition;
  FOR rule IN SELECT * FROM (VALUES
    ('exam.count_fourth_subject,', 'exam.count_fourth_subject, type.marks_mode,'),
    ($$'passed', passed$$, $$'passed', CASE WHEN (SELECT marks_mode FROM exam_info)='total_only' THEN NULL ELSE passed END$$),
    ($$'letter_grade', letter_grade$$, $$'letter_grade', CASE WHEN (SELECT marks_mode FROM exam_info)='total_only' THEN NULL ELSE letter_grade END$$),
    ($$'grade_point', grade_point$$, $$'grade_point', CASE WHEN (SELECT marks_mode FROM exam_info)='total_only' THEN NULL ELSE grade_point END$$),
    ($$'gpa', gpa$$, $$'gpa', CASE WHEN (SELECT marks_mode FROM exam_info)='total_only' THEN NULL ELSE gpa END$$),
    ($$'failed_subjects', failed_subjects$$, $$'failed_subjects', CASE WHEN (SELECT marks_mode FROM exam_info)='total_only' THEN 0 ELSE failed_subjects END$$),
    ($$'letter_grade', CASE WHEN failed_subjects$$, $$'letter_grade', CASE WHEN (SELECT marks_mode FROM exam_info)='total_only' THEN NULL WHEN failed_subjects$$)
  ) replacements(old_value,new_value) LOOP
    IF strpos(definition,rule.old_value)=0 THEN RAISE EXCEPTION 'Result builder anchor missing: %',rule.old_value; END IF;
    definition:=replace(definition,rule.old_value,rule.new_value);
  END LOOP;
  EXECUTE definition;
END;
$patch$;
