BEGIN;
DO $test$
DECLARE
 admin_id uuid; type_id uuid; year_id uuid; class_id uuid; exam_id uuid; subject_id uuid; config_id uuid;
 student_ids uuid[] := '{}'; student_id uuid; payload jsonb; n int; j int; score numeric;
 suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,12);
 expected int[] := ARRAY[3,1,1,NULL,NULL];
BEGIN
 SELECT id INTO STRICT admin_id FROM public.profiles WHERE role='admin' AND is_active LIMIT 1;
 SELECT id INTO STRICT type_id FROM public.result_exam_types WHERE marks_mode='total_pass' AND is_active LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 INSERT INTO public.academic_years(name,start_date,end_date,is_current) VALUES('Rank '||suffix,'2035-01-01','2035-12-31',false) RETURNING id INTO year_id;
 INSERT INTO public.classes(name,grade,section,class_group,academic_year_id) VALUES('Rank '||suffix,'11','A','science',year_id) RETURNING id INTO class_id;
 PERFORM set_config('app.promotion_effective_date','2035-01-01',true);
 FOR n IN 1..5 LOOP
   INSERT INTO public.students(admission_number,first_name,last_name,class_id,class_group)
   VALUES('RANK-'||n||'-'||suffix,'Rank',n::text,class_id,'science') RETURNING id INTO student_id;
   student_ids := array_append(student_ids,student_id);
 END LOOP;
 INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,exam_date,title)
 VALUES(class_id,year_id,type_id,'2035-03-05','Rank verification') RETURNING id INTO exam_id;
 FOR j IN 1..6 LOOP
   INSERT INTO public.subjects(name,code,class_group,is_fourth_subject,is_active)
   VALUES('Rank subject '||j||suffix,'rank-'||j||suffix,'science',false,true) RETURNING id INTO subject_id;
   INSERT INTO public.result_exam_subjects(exam_id,subject_id,creative_max,written_max,practical_max,pass_mark)
   VALUES(exam_id,subject_id,20,0,0,6.6) RETURNING id INTO config_id;
   FOR n IN 1..5 LOOP
     IF n=5 AND j=6 THEN CONTINUE; END IF;
     score := CASE n WHEN 1 THEN CASE WHEN j<=3 THEN 20 ELSE 7 END WHEN 2 THEN 13 WHEN 3 THEN 12 ELSE CASE WHEN j=6 THEN 0 ELSE 20 END END;
     INSERT INTO public.result_marks(exam_subject_id,student_id,creative_marks) VALUES(config_id,student_ids[n],score);
   END LOOP;
 END LOOP;
 FOR n IN 1..5 LOOP
   payload := public.get_student_result(exam_id,student_ids[n]);
   IF (payload->'summary'->>'position')::int IS DISTINCT FROM expected[n] THEN
     RAISE EXCEPTION 'GPA ranking failed for student %: %',n,payload->'summary';
   END IF;
   IF (payload->'summary'->>'total_students')::int<>5 THEN RAISE EXCEPTION 'Ranking changed class population'; END IF;
   IF NOT payload ? 'attendance' THEN RAISE EXCEPTION 'Attendance payload was lost'; END IF;
 END LOOP;
 IF has_function_privilege('anon','public.result_student_rank_score(uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.result_student_rank_score(uuid,uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'Private ranking helper is publicly executable';
 END IF;
END;
$test$;
ROLLBACK;
SELECT 'Passed GPA priority over marks, shared GPA positions, failed/incomplete exclusion, preserved population and attendance. Fixtures rolled back.' AS verification;
