BEGIN;
DO $test$
DECLARE
 v_admin uuid; v_type uuid; v_year uuid; v_class uuid; v_student uuid; v_subject uuid; v_exam uuid; v_config uuid;
 v_payload jsonb; v_blocked boolean; sample record;
 suffix text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
BEGIN
 SELECT id INTO STRICT v_admin FROM public.profiles WHERE role='admin' AND is_active ORDER BY id LIMIT 1;
 SELECT id INTO STRICT v_type FROM public.result_exam_types WHERE name='Tutorial exam' AND marks_mode='total_pass';
 PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 INSERT INTO public.academic_years(name,start_date,end_date,is_current)
   VALUES('Single section test '||suffix,'2035-01-01','2035-12-31',false) RETURNING id INTO v_year;
 INSERT INTO public.classes(name,grade,section,class_group,academic_year_id)
   VALUES('Single section test '||suffix,'11','A','science',v_year) RETURNING id INTO v_class;
 PERFORM set_config('app.promotion_effective_date','2035-01-01',true);
 INSERT INTO public.students(admission_number,first_name,last_name,class_id,class_group)
   VALUES('SINGLE-'||suffix,'Single section','Test',v_class,'science') RETURNING id INTO v_student;
 INSERT INTO public.subjects(name,code,class_group,is_fourth_subject,is_active)
   VALUES('Single section '||suffix,'single-'||suffix,'science',false,true) RETURNING id INTO v_subject;
 INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,exam_date,title)
   VALUES(v_class,v_year,v_type,'2035-03-05','Single section test') RETURNING id INTO v_exam;
 INSERT INTO public.result_exam_subjects(exam_id,subject_id,creative_max,written_max,practical_max,pass_mark)
   VALUES(v_exam,v_subject,20,0,0,6.6) RETURNING id INTO v_config;
 FOR sample IN SELECT * FROM (VALUES(20::numeric,0::numeric),(0,20),(10,10)) AS cases(cq,mcq) LOOP
   DELETE FROM public.result_marks WHERE exam_subject_id=v_config;
   UPDATE public.result_exam_subjects SET creative_max=sample.cq,written_max=sample.mcq WHERE id=v_config;
   INSERT INTO public.result_marks(exam_subject_id,student_id,creative_marks,written_marks)
     VALUES(v_config,v_student,CASE WHEN sample.cq=0 THEN NULL ELSE 6.6 END,CASE WHEN sample.cq=0 THEN 6.6 WHEN sample.mcq=0 THEN NULL ELSE 0 END);
   v_payload:=public.get_student_result(v_exam,v_student);
   IF (v_payload->'subjects'->0->>'obtained')::numeric<>6.6
     OR NOT (v_payload->'subjects'->0->>'passed')::boolean
     OR (v_payload->'subjects'->0->>'total_max')::numeric<>20 THEN
     RAISE EXCEPTION 'Passing result incorrect for CQ %, MCQ %',sample.cq,sample.mcq;
   END IF;
   UPDATE public.result_marks SET creative_marks=CASE WHEN sample.cq=0 THEN NULL ELSE 6.5 END,
     written_marks=CASE WHEN sample.cq=0 THEN 6.5 WHEN sample.mcq=0 THEN NULL ELSE 0 END WHERE exam_subject_id=v_config;
   v_payload:=public.get_student_result(v_exam,v_student);
   IF (v_payload->'subjects'->0->>'passed')::boolean THEN RAISE EXCEPTION 'A total below 6.6 passed'; END IF;
 END LOOP;
 v_blocked:=false;
 BEGIN UPDATE public.result_exam_subjects SET creative_max=0,written_max=0 WHERE id=v_config;
 EXCEPTION WHEN check_violation OR raise_exception THEN v_blocked:=true; END;
 IF NOT v_blocked THEN RAISE EXCEPTION 'Zero total was accepted'; END IF;
 v_blocked:=false;
 BEGIN UPDATE public.result_exam_subjects SET creative_max=-1,written_max=21 WHERE id=v_config;
 EXCEPTION WHEN check_violation OR raise_exception THEN v_blocked:=true; END;
 IF NOT v_blocked THEN RAISE EXCEPTION 'Negative maximum was accepted'; END IF;
 v_blocked:=false;
 BEGIN UPDATE public.result_exam_subjects SET written_pass_mark=1 WHERE id=v_config;
 EXCEPTION WHEN check_violation OR raise_exception THEN v_blocked:=true; END;
 IF NOT v_blocked THEN RAISE EXCEPTION 'Separate section pass mark was accepted'; END IF;
END;
$test$;
ROLLBACK;
SELECT 'Verified CQ-only 20/0, MCQ-only 0/20 and mixed 10/10 configurations and total-based grading. Invalid totals and section pass marks remain blocked. All fixtures rolled back.' AS verification;
