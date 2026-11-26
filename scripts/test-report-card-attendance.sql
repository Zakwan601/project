BEGIN;
DO $test$
DECLARE
 v_admin uuid; v_teacher uuid; v_type uuid; v_year uuid; v_class uuid; v_other_class uuid;
 v_student uuid; v_late_student uuid; v_subject uuid; v_exam uuid; v_other_exam uuid; v_only_exam uuid; v_fallback_exam uuid;
 v_config uuid; v_group uuid; v_schedule uuid; v_token uuid; v_payload jsonb; v_attendance jsonb; v_blocked boolean;
 suffix text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
BEGIN
 SELECT id INTO STRICT v_admin FROM public.profiles WHERE role='admin' AND is_active ORDER BY id LIMIT 1;
 SELECT id INTO STRICT v_type FROM public.result_exam_types WHERE name='Tutorial exam' AND marks_mode='total_pass';
 PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 IF has_function_privilege('anon','public.result_report_attendance(uuid,uuid)','EXECUTE')
   OR has_function_privilege('authenticated','public.result_report_attendance(uuid,uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'Private attendance helper is publicly callable';
 END IF;
 INSERT INTO public.academic_years(name,start_date,end_date,is_current)
   VALUES('Report attendance '||suffix,'2035-01-01','2035-12-31',false) RETURNING id INTO v_year;
 INSERT INTO public.classes(name,grade,section,class_group,academic_year_id)
   VALUES('Report attendance A '||suffix,'11','A','science',v_year) RETURNING id INTO v_class;
 INSERT INTO public.classes(name,grade,section,class_group,academic_year_id)
   VALUES('Report attendance B '||suffix,'11','B','science',v_year) RETURNING id INTO v_other_class;
 PERFORM set_config('app.promotion_effective_date','2035-01-01',true);
 INSERT INTO public.students(admission_number,first_name,last_name,class_id,class_group,created_at)
   VALUES('REPORT-'||suffix,'Report','Attendance',v_class,'science','2035-01-07 20:00:00+00') RETURNING id INTO v_student;
 INSERT INTO public.students(admission_number,first_name,last_name,class_id,class_group,created_at)
   VALUES('REPORT-LATE-'||suffix,'Report','After exam',v_class,'science','2035-01-17 00:00:00+06') RETURNING id INTO v_late_student;
 INSERT INTO public.subjects(name,code,class_group,is_fourth_subject,is_active)
   VALUES('Report subject '||suffix,'report-'||suffix,'science',false,true) RETURNING id INTO v_subject;
 INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,exam_date,title,has_regular_classes)
   VALUES(v_class,v_year,v_type,'2035-01-08','Report attendance',true) RETURNING id,exam_group_id INTO v_exam,v_group;
 INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,exam_date,title,has_regular_classes,exam_group_id)
   VALUES(v_other_class,v_year,v_type,'2035-01-08','Other class routine',true,v_group) RETURNING id INTO v_other_exam;
 INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,exam_date,title,has_regular_classes)
   VALUES(v_class,v_year,v_type,'2035-01-15','Exam without classes',false) RETURNING id INTO v_only_exam;
 INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,exam_date,title)
   VALUES(v_class,v_year,v_type,'2035-01-09','No routine fallback') RETURNING id INTO v_fallback_exam;
 INSERT INTO public.result_exam_subjects(exam_id,subject_id,creative_max,written_max,practical_max,pass_mark)
   VALUES(v_exam,v_subject,10,10,0,6.6) RETURNING id INTO v_config;
 INSERT INTO public.result_exam_subjects(exam_id,subject_id,creative_max,written_max,practical_max,pass_mark)
   VALUES(v_other_exam,v_subject,10,10,0,6.6),(v_only_exam,v_subject,10,10,0,6.6),(v_fallback_exam,v_subject,10,10,0,6.6);
 INSERT INTO public.result_exam_schedules(exam_group_id,subject_name,subject_id,exam_date,has_regular_classes)
   VALUES(v_group,'Report subject',v_subject,'2035-01-16',true) RETURNING id INTO v_schedule;
 INSERT INTO public.result_exam_schedule_classes(schedule_id,exam_id) VALUES(v_schedule,v_exam);
 INSERT INTO public.result_exam_schedules(exam_group_id,subject_name,subject_id,exam_date,has_regular_classes)
   VALUES(v_group,'Other class later exam',v_subject,'2035-01-18',true) RETURNING id INTO v_schedule;
 INSERT INTO public.result_exam_schedule_classes(schedule_id,exam_id) VALUES(v_schedule,v_other_exam);
 INSERT INTO public.result_exam_schedules(exam_group_id,subject_name,subject_id,exam_date,has_regular_classes,exam_time)
   SELECT exam_group_id,'Exam only',v_subject,'2035-01-15',false,'09:00'::time FROM public.result_exams WHERE id=v_only_exam RETURNING id INTO v_schedule;
 INSERT INTO public.result_exam_schedule_classes(schedule_id,exam_id) VALUES(v_schedule,v_only_exam);
 -- A holiday for a different class must not remove this student's class day.
 INSERT INTO public.holidays(date,name,class_ids) VALUES('2035-01-11','Report test vacation',ARRAY[v_class]),('2035-01-09','Other class vacation',ARRAY[v_other_class]);
 INSERT INTO public.attendance_sessions(class_id,date,session_type,source,notes)
   SELECT v_class,day::date,'full_day','manual','Report attendance test'
   FROM generate_series('2035-01-07'::date,'2035-01-18'::date,'1 day') day;
 INSERT INTO public.attendance_records(session_id,student_id,status)
   SELECT session.id,v_student,CASE session.date
     WHEN '2035-01-09' THEN 'late'::public.attendance_status
     WHEN '2035-01-10' THEN 'excused'::public.attendance_status
     WHEN '2035-01-14' THEN 'too_late'::public.attendance_status
     WHEN '2035-01-15' THEN 'absent'::public.attendance_status
     ELSE 'present'::public.attendance_status END
   FROM public.attendance_sessions session WHERE session.class_id=v_class AND session.date<>'2035-01-16';
 INSERT INTO public.result_marks(exam_subject_id,student_id,creative_marks,written_marks) VALUES(v_config,v_student,8,8);
 v_payload:=public.get_student_result(v_exam,v_student);
 v_attendance:=v_payload->'attendance';
 IF v_attendance->>'start_date'<>'2035-01-08' OR v_attendance->>'end_date'<>'2035-01-16'
   OR (v_attendance->>'total_classes')::int<>5 OR (v_attendance->>'present_count')::int<>3
   OR (v_attendance->>'present_percentage')::numeric<>60 THEN
   RAISE EXCEPTION 'Attendance period, class cutoff, calendar exclusions, statuses or missing record handling incorrect: %',v_attendance;
 END IF;
 v_payload:=public.get_student_result(v_fallback_exam,v_student);
 IF v_payload->'attendance'->>'end_date'<>'2035-01-09'
   OR (v_payload->'attendance'->>'total_classes')::int<>2
   OR (v_payload->'attendance'->>'present_percentage')::numeric<>100 THEN RAISE EXCEPTION 'Exam reference date fallback incorrect'; END IF;
 v_payload:=public.get_student_result(v_exam,v_late_student);
 IF (v_payload->'attendance'->>'total_classes')::int<>0 OR (v_payload->'attendance'->>'present_count')::int<>0
   OR (v_payload->'attendance'->>'present_percentage')::numeric<>0 THEN RAISE EXCEPTION 'Student created after the cutoff must have zero class days'; END IF;
 -- Existing teacher scope must continue to reject an unassigned class report.
 SELECT id INTO v_teacher FROM public.profiles WHERE role='sub_admin' AND sub_admin_label='teacher' AND is_active LIMIT 1;
 IF v_teacher IS NOT NULL THEN
   PERFORM set_config('request.jwt.claim.sub',v_teacher::text,true);
   v_blocked:=false;
   BEGIN PERFORM public.get_student_result(v_exam,v_student); EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true; END;
   IF NOT v_blocked THEN RAISE EXCEPTION 'Unassigned teacher accessed the report'; END IF;
 END IF;
 PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
 INSERT INTO public.result_marks(exam_subject_id,student_id,is_absent) VALUES(v_config,v_late_student,true);
 UPDATE public.result_exams SET status='published' WHERE id=v_exam;
 v_token:=public.create_result_share_link(v_exam,v_student,now()+interval '1 day');
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','anon',true);
 v_payload:=public.get_shared_student_result(v_token);
 IF v_payload->'attendance' IS DISTINCT FROM v_attendance THEN RAISE EXCEPTION 'Guardian report attendance differs from administrator report'; END IF;
END;
$test$;
ROLLBACK;
SELECT 'Verified creation date in Dhaka, final class exam date, day counts, present/late/leave, too-late absence, holidays, exam-only days, fallback/empty periods, teacher scope, private helper and guardian report. All fixtures rolled back.' AS verification;
