BEGIN;
DO $test$
DECLARE
  admin_id uuid; tutorial_type uuid; regular_type uuid; year_id uuid; class_id uuid;
  student_a uuid; student_b uuid; subject_id uuid; tutorial_id uuid; regular_id uuid;
  tutorial_subject uuid; regular_subject uuid; payload jsonb; blocked boolean;
  suffix text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
BEGIN
  SELECT id INTO STRICT admin_id FROM public.profiles WHERE role='admin' AND is_active ORDER BY id LIMIT 1;
  SELECT id INTO STRICT tutorial_type FROM public.result_exam_types WHERE name='Tutorial exam' AND marks_mode='total_only' AND is_active;
  SELECT id INTO STRICT regular_type FROM public.result_exam_types WHERE marks_mode='sectioned' AND is_active ORDER BY sort_order,id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  INSERT INTO public.academic_years(name,start_date,end_date,is_current) VALUES('Tutorial test '||suffix,'2035-01-01','2035-12-31',false) RETURNING id INTO year_id;
  INSERT INTO public.classes(name,grade,section,class_group,academic_year_id) VALUES('Tutorial test '||suffix,'11','A','science',year_id) RETURNING id INTO class_id;
  PERFORM set_config('app.promotion_effective_date','2035-01-01',true);
  INSERT INTO public.students(admission_number,first_name,last_name,class_id,class_group) VALUES('TUTORIAL-A-'||suffix,'Tutorial','A',class_id,'science') RETURNING id INTO student_a;
  INSERT INTO public.students(admission_number,first_name,last_name,class_id,class_group) VALUES('TUTORIAL-B-'||suffix,'Tutorial','B',class_id,'science') RETURNING id INTO student_b;
  INSERT INTO public.subjects(name,code,class_group,is_fourth_subject,is_active) VALUES('Tutorial subject '||suffix,'tut-'||suffix,'science',false,true) RETURNING id INTO subject_id;
  INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,exam_date,title)
    VALUES(class_id,year_id,tutorial_type,'2035-03-05','Tutorial test') RETURNING id INTO tutorial_id;
  INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,exam_date,title)
    VALUES(class_id,year_id,regular_type,'2035-03-05','Regular regression') RETURNING id INTO regular_id;
  INSERT INTO public.result_exam_subjects(exam_id,subject_id,creative_max,written_max,practical_max,pass_mark)
    VALUES(tutorial_id,subject_id,0,20,0,0) RETURNING id INTO tutorial_subject;
  INSERT INTO public.result_exam_subjects(exam_id,subject_id,creative_max,written_max,practical_max,pass_mark,creative_pass_mark,written_pass_mark)
    VALUES(regular_id,subject_id,70,30,0,33,23,10) RETURNING id INTO regular_subject;
  blocked:=false;
  BEGIN UPDATE public.result_exam_subjects SET creative_max=5 WHERE id=tutorial_subject; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Tutorial accepted section distribution'; END IF;
  blocked:=false;
  BEGIN UPDATE public.result_exam_subjects SET pass_mark=1 WHERE id=tutorial_subject; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Tutorial accepted a pass threshold'; END IF;
  blocked:=false;
  BEGIN UPDATE public.result_exam_subjects SET written_max=0 WHERE id=tutorial_subject; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Tutorial accepted a nonpositive maximum'; END IF;
  INSERT INTO public.result_marks(exam_subject_id,student_id,written_marks) VALUES(tutorial_subject,student_a,0),(tutorial_subject,student_b,12.5);
  INSERT INTO public.result_marks(exam_subject_id,student_id,creative_marks,written_marks) VALUES(regular_subject,student_a,70,9);
  payload:=public.get_student_result(tutorial_id,student_a);
  IF payload->'exam'->>'marks_mode'<>'total_only' OR (payload->'summary'->>'total_obtained')::numeric<>0
    OR (payload->'summary'->>'total_max')::numeric<>20 OR (payload->'summary'->>'position')::int<>2
    OR payload->'summary'->'gpa'<>'null'::jsonb OR payload->'summary'->'letter_grade'<>'null'::jsonb
    OR payload->'subjects'->0->'passed'<>'null'::jsonb OR payload->'subjects'->0->'grade_point'<>'null'::jsonb
    OR payload->'subjects'->0->'letter_grade'<>'null'::jsonb THEN RAISE EXCEPTION 'Zero tutorial marks were graded, lost, or ranked incorrectly: %',payload; END IF;
  payload:=public.get_student_result(tutorial_id,student_b);
  IF (payload->'summary'->>'total_obtained')::numeric<>12.5 OR (payload->'summary'->>'position')::int<>1 THEN RAISE EXCEPTION 'Tutorial fractional total or rank is wrong'; END IF;
  blocked:=false;
  BEGIN UPDATE public.result_marks SET written_marks=21 WHERE exam_subject_id=tutorial_subject AND student_id=student_a; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Tutorial accepted marks above its maximum'; END IF;
  UPDATE public.result_marks SET written_marks=NULL,is_absent=true WHERE exam_subject_id=tutorial_subject AND student_id=student_a;
  payload:=public.get_student_result(tutorial_id,student_a);
  IF NOT (payload->'subjects'->0->>'is_absent')::boolean OR payload->'subjects'->0->'passed'<>'null'::jsonb THEN RAISE EXCEPTION 'Tutorial absence was turned into pass/fail'; END IF;
  payload:=public.get_student_result(regular_id,student_a);
  IF payload->'exam'->>'marks_mode'<>'sectioned' OR payload->'subjects'->0->>'letter_grade'<>'F'
    OR (payload->'summary'->>'failed_subjects')::int<>1 THEN RAISE EXCEPTION 'Regular section-pass grading changed: %',payload; END IF;
  blocked:=false;
  BEGIN UPDATE public.result_exams SET exam_type_id=regular_type WHERE id=tutorial_id; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Configured tutorial marks could be silently reinterpreted as section marks'; END IF;
END;
$test$;
ROLLBACK;
SELECT 'Passed tutorial type creation, total-only configuration, zero and fractional marks, no pass/GPA grading, absence, ranking, bounds checks, safe type changes and unchanged regular section grading. All fixtures rolled back.' AS verification;
