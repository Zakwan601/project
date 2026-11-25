-- Tutorial assessments have CQ and MCQ, with a single overall pass threshold.
-- Keep the old total_only mode available for existing non-tutorial assessments.
BEGIN;
LOCK TABLE public.result_exam_types, public.result_exams, public.result_exam_subjects, public.result_marks IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.result_exam_types DROP CONSTRAINT result_exam_types_marks_mode_check;
ALTER TABLE public.result_exam_types ADD CONSTRAINT result_exam_types_marks_mode_check
 CHECK (marks_mode IN ('sectioned','total_only','total_pass'));

CREATE OR REPLACE FUNCTION public.validate_tutorial_exam_subject()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE mode text;
BEGIN
 SELECT t.marks_mode INTO mode FROM public.result_exams e
 JOIN public.result_exam_types t ON t.id=e.exam_type_id WHERE e.id=NEW.exam_id;
 IF mode='total_only' AND (NEW.creative_max<>0 OR NEW.practical_max<>0 OR NEW.written_max<=0
   OR NEW.pass_mark<>0 OR NEW.creative_pass_mark<>0 OR NEW.written_pass_mark<>0 OR NEW.practical_pass_mark<>0) THEN
   RAISE EXCEPTION 'Total-only assessments require a positive total and no section or pass marks';
 END IF;
 IF mode='total_pass' AND (NEW.creative_max<=0 OR NEW.written_max<=0 OR NEW.practical_max<>0
   OR NEW.pass_mark<=0 OR NEW.pass_mark>NEW.creative_max+NEW.written_max
   OR NEW.creative_pass_mark<>0 OR NEW.written_pass_mark<>0 OR NEW.practical_pass_mark<>0) THEN
   RAISE EXCEPTION 'Tutorial exams require positive CQ and MCQ maximums and one total pass mark; separate section pass marks are not allowed';
 END IF;
 RETURN NEW;
END;
$$;

DO $$
DECLARE tutorial_type uuid := '0737ffd0-9e8c-4e98-91bd-6376ef836e6b';
 targets uuid[] := ARRAY['63fa5e73-93a0-4902-9b15-188edbdbc297','396cfcb7-f51f-4ccd-999a-fbc64bcd20c0','17b07c7d-34a8-4831-bab9-11f641358d46']::uuid[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.result_exam_types WHERE id=tutorial_type AND name='Tutorial exam' AND marks_mode='total_only') THEN
   RAISE EXCEPTION 'Expected original tutorial exam type not found';
 END IF;
 IF (SELECT count(*) FROM public.result_exams WHERE id=ANY(targets) AND exam_type_id=tutorial_type
   AND title='Tutorial Exam - 1' AND status='draft')<>3 THEN
   RAISE EXCEPTION 'Expected three ongoing Tutorial Exam - 1 exams';
 END IF;
 IF EXISTS(SELECT 1 FROM public.result_exam_subjects s JOIN public.result_exams e ON e.id=s.exam_id
   WHERE e.exam_type_id=tutorial_type AND NOT (e.id=ANY(targets))) THEN
   RAISE EXCEPTION 'Unexpected tutorial exam configurations require review before changing the type';
 END IF;
 IF EXISTS(SELECT 1 FROM public.result_marks m JOIN public.result_exam_subjects s ON s.id=m.exam_subject_id WHERE s.exam_id=ANY(targets)) THEN
   RAISE EXCEPTION 'Marks were entered since the preflight; do not reinterpret existing totals as CQ or MCQ';
 END IF;
 UPDATE public.result_exam_types SET marks_mode='total_pass' WHERE id=tutorial_type;
 UPDATE public.result_exam_subjects SET creative_max=10,written_max=10,practical_max=0,
   pass_mark=6.60,creative_pass_mark=0,written_pass_mark=0,practical_pass_mark=0 WHERE exam_id=ANY(targets);
END;
$$;

COMMENT ON COLUMN public.result_exam_types.marks_mode IS
 'sectioned: separate section and total passing; total_pass: CQ/MCQ with only overall passing; total_only: legacy ungraded total.';
COMMIT;
