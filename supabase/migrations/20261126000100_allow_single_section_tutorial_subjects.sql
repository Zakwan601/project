-- An unused CQ or MCQ section may have a zero maximum. Passing still uses
-- only the combined total, and a subject must have a positive maximum overall.
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
 IF mode='total_pass' AND (NEW.creative_max<0 OR NEW.written_max<0 OR NEW.creative_max+NEW.written_max<=0 OR NEW.practical_max<>0
   OR NEW.pass_mark<=0 OR NEW.pass_mark>NEW.creative_max+NEW.written_max
   OR NEW.creative_pass_mark<>0 OR NEW.written_pass_mark<>0 OR NEW.practical_pass_mark<>0) THEN
   RAISE EXCEPTION 'Tutorial exams require a positive CQ/MCQ total and one total pass mark; either section may be zero, with no separate section pass marks';
 END IF;
 RETURN NEW;
END;
$$;
