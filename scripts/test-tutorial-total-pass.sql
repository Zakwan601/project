BEGIN;
DO $test$
DECLARE
 admin_id uuid; test_student_id uuid; test_exam_id uuid := '63fa5e73-93a0-4902-9b15-188edbdbc297';
 config_id uuid; payload jsonb; subject_payload jsonb; blocked boolean; sample record;
BEGIN
 IF (SELECT count(*) FROM public.result_exam_subjects s JOIN public.result_exams e ON e.id=s.exam_id
   JOIN public.result_exam_types t ON t.id=e.exam_type_id
   WHERE e.id IN ('63fa5e73-93a0-4902-9b15-188edbdbc297','396cfcb7-f51f-4ccd-999a-fbc64bcd20c0','17b07c7d-34a8-4831-bab9-11f641358d46')
   AND t.marks_mode='total_pass' AND s.creative_max=10 AND s.written_max=10 AND s.practical_max=0
   AND s.pass_mark=6.6 AND s.creative_pass_mark=0 AND s.written_pass_mark=0 AND s.practical_pass_mark=0)<>25 THEN
   RAISE EXCEPTION 'Expected all 25 existing subjects with CQ 10, MCQ 10 and total passing at 6.6';
 END IF;
 SELECT id INTO STRICT admin_id FROM public.profiles WHERE role='admin' AND is_active ORDER BY id LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 SELECT s.id INTO STRICT config_id FROM public.result_exam_subjects s
   WHERE s.exam_id=test_exam_id AND s.paper_group_id IS NULL LIMIT 1;
 SELECT s.id INTO STRICT test_student_id FROM public.students s JOIN public.result_exams e ON e.class_id=s.class_id
   WHERE e.id=test_exam_id AND public.student_takes_exam_subject(s.id,config_id) ORDER BY s.id LIMIT 1;
 INSERT INTO public.result_marks(exam_subject_id,student_id,creative_marks,written_marks,is_absent)
   VALUES(config_id,test_student_id,0,0,false)
   ON CONFLICT(exam_subject_id,student_id) DO UPDATE SET creative_marks=0,written_marks=0,practical_marks=NULL,is_absent=false;
 FOR sample IN SELECT * FROM (VALUES(0::numeric,6.6::numeric,true),(6.6,0,true),(3,3.6,true),(3,3.5,false),(0,0,false),(10,0,true),(0,10,true)) AS samples(cq,mcq,passed) LOOP
   UPDATE public.result_marks m SET creative_marks=sample.cq,written_marks=sample.mcq
     WHERE m.exam_subject_id=config_id AND m.student_id=test_student_id;
   payload:=public.get_student_result(test_exam_id,test_student_id);
   SELECT value INTO STRICT subject_payload FROM jsonb_array_elements(payload->'subjects') WHERE value->>'id'=config_id::text;
   IF payload->'exam'->>'marks_mode'<>'total_pass'
     OR (subject_payload->>'passed')::boolean IS DISTINCT FROM sample.passed
     OR (subject_payload->>'obtained')::numeric<>sample.cq+sample.mcq
     OR (subject_payload->>'pass_mark')::numeric<>6.6 THEN
     RAISE EXCEPTION 'Tutorial total-pass result incorrect for CQ %, MCQ %',sample.cq,sample.mcq;
   END IF;
 END LOOP;
 blocked:=false;
 BEGIN UPDATE public.result_exam_subjects SET creative_pass_mark=1 WHERE id=config_id; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Separate CQ pass mark accepted'; END IF;
 blocked:=false;
 BEGIN UPDATE public.result_exam_subjects SET written_pass_mark=1 WHERE id=config_id; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Separate MCQ pass mark accepted'; END IF;
 blocked:=false;
 BEGIN UPDATE public.result_exam_subjects SET practical_max=1 WHERE id=config_id; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Tutorial practical component accepted'; END IF;
 blocked:=false;
 BEGIN UPDATE public.result_exam_subjects SET pass_mark=0 WHERE id=config_id; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Missing total pass mark accepted'; END IF;
 blocked:=false;
 BEGIN UPDATE public.result_marks m SET creative_marks=11 WHERE m.exam_subject_id=config_id AND m.student_id=test_student_id; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'CQ above maximum accepted'; END IF;
 blocked:=false;
 BEGIN UPDATE public.result_marks m SET written_marks=11 WHERE m.exam_subject_id=config_id AND m.student_id=test_student_id; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'MCQ above maximum accepted'; END IF;
 UPDATE public.result_marks m SET is_absent=true WHERE m.exam_subject_id=config_id AND m.student_id=test_student_id;
 payload:=public.get_student_result(test_exam_id,test_student_id);
 SELECT value INTO STRICT subject_payload FROM jsonb_array_elements(payload->'subjects') WHERE value->>'id'=config_id::text;
 IF NOT (subject_payload->>'is_absent')::boolean OR (subject_payload->>'passed')::boolean THEN RAISE EXCEPTION 'Absent tutorial student passed'; END IF;
END;
$test$;
ROLLBACK;
SELECT 'Verified all 25 subjects, CQ/MCQ limits, exact 33 percent passing, zero in either section, failing totals, no section pass marks and absence. All test marks rolled back.' AS verification;
