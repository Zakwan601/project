BEGIN;
DO $test$
DECLARE
 admin_id uuid; teacher_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); student_profile uuid:=gen_random_uuid();
 year_id uuid; class_a uuid; class_b uuid; student_a uuid; student_b uuid;
 subject_id uuid; exam_id uuid; hidden_exam uuid; exam_subject uuid; exam_type uuid; session_id uuid;
 payload jsonb; entry jsonb; expected jsonb; blocked boolean; attendance jsonb;
 suffix text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
BEGIN
 SELECT id INTO STRICT admin_id FROM public.profiles WHERE role='admin' AND is_active ORDER BY id LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (teacher_id,'month-teacher-'||suffix||'@example.invalid','{"full_name":"Month teacher"}'),
 (staff_id,'month-staff-'||suffix||'@example.invalid','{"full_name":"Month staff"}'),
 (student_profile,'month-student-'||suffix||'@example.invalid','{"full_name":"Month student"}');
 UPDATE public.profiles SET role='sub_admin',sub_admin_label='teacher' WHERE id=teacher_id;
 UPDATE public.profiles SET role='sub_admin' WHERE id=staff_id;
 INSERT INTO public.sub_admin_permissions(profile_id,permission_key,can_read,can_write) VALUES
 (teacher_id,'reports',true,false),(staff_id,'students',true,true);
 INSERT INTO public.academic_years(name,start_date,end_date,is_current)
 VALUES('Monthly fine test '||suffix,'2035-01-01','2035-12-31',false) RETURNING id INTO year_id;
 INSERT INTO public.classes(name,grade,section,class_group,academic_year_id)
 VALUES('Month A '||suffix,'11','A','science',year_id) RETURNING id INTO class_a;
 INSERT INTO public.classes(name,grade,section,class_group,academic_year_id)
 VALUES('Month B '||suffix,'11','B','science',year_id) RETURNING id INTO class_b;
 INSERT INTO public.teacher_class_assignments(profile_id,class_id) VALUES(teacher_id,class_a);
 PERFORM set_config('app.promotion_effective_date','2035-01-01',true);
 INSERT INTO public.students(admission_number,first_name,last_name,class_id,class_group)
 VALUES('MONTH-A-'||suffix,'Month','A',class_a,'science') RETURNING id INTO student_a;
 UPDATE public.students SET profile_id=student_profile WHERE id=student_a;
 INSERT INTO public.students(admission_number,first_name,last_name,class_id,class_group)
 VALUES('MONTH-B-'||suffix,'Month','B',class_b,'science') RETURNING id INTO student_b;
 INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by)
 VALUES(class_b,'2035-01-10','full_day',admin_id) RETURNING id INTO session_id;
 INSERT INTO public.attendance_records(session_id,student_id,status) VALUES(session_id,student_a,'absent');
 INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by)
 VALUES(class_b,'2035-01-11','full_day',admin_id) RETURNING id INTO session_id;
 INSERT INTO public.attendance_records(session_id,student_id,status) VALUES(session_id,student_a,'present');
 INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by)
 VALUES(class_a,'2035-03-04','full_day',admin_id) RETURNING id INTO session_id;
 INSERT INTO public.attendance_records(session_id,student_id,status) VALUES(session_id,student_a,'too_late');
 INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by)
 VALUES(class_a,'2035-03-05','full_day',admin_id) RETURNING id INTO session_id;
 INSERT INTO public.attendance_records(session_id,student_id,status) VALUES(session_id,student_a,'late');
 INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by)
 VALUES(class_a,'2035-04-03','full_day',admin_id) RETURNING id INTO session_id;
 INSERT INTO public.attendance_records(session_id,student_id,status) VALUES(session_id,student_a,'late');
 INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by)
 VALUES(class_a,'2035-06-03','full_day',admin_id) RETURNING id INTO session_id;
 INSERT INTO public.attendance_records(session_id,student_id,status) VALUES(session_id,student_a,'present');
 INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by)
 VALUES(class_a,'2035-06-04','full_day',admin_id) RETURNING id INTO session_id;
 INSERT INTO public.attendance_records(session_id,student_id,status) VALUES(session_id,student_a,'excused');
 SELECT id INTO STRICT exam_type FROM public.result_exam_types WHERE marks_mode='total_only' AND is_active ORDER BY id LIMIT 1;
 INSERT INTO public.subjects(name,code,class_group,is_fourth_subject,is_active)
 VALUES('Month subject '||suffix,'month-'||suffix,'science',false,true) RETURNING id INTO subject_id;
 INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,title,exam_date,has_regular_classes)
 VALUES(class_a,year_id,exam_type,'Month exam','2035-05-03',false) RETURNING id INTO exam_id;
 INSERT INTO public.result_exam_subjects(exam_id,subject_id,creative_max,written_max,practical_max,pass_mark)
 VALUES(exam_id,subject_id,0,20,0,0) RETURNING id INTO exam_subject;
 PERFORM public.create_result_exam_routine_entries(exam_id,ARRAY[subject_id],'2035-05-03','10:00');
 INSERT INTO public.result_marks(exam_subject_id,student_id,is_absent) VALUES(exam_subject,student_a,true);
 INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,title,exam_date,has_regular_classes)
 VALUES(class_b,year_id,exam_type,'Hidden month exam','2035-01-10',false) RETURNING id INTO hidden_exam;
 INSERT INTO public.result_exam_subjects(exam_id,subject_id,creative_max,written_max,practical_max,pass_mark)
 VALUES(hidden_exam,subject_id,0,20,0,0) RETURNING id INTO exam_subject;
 PERFORM public.create_result_exam_routine_entries(hidden_exam,ARRAY[subject_id],'2035-01-10','10:00');
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 expected:=public.get_student_attendance_exceptions(student_a);
 IF jsonb_array_length(expected->'missedExams')<>2 OR expected->'missedExams'->0->>'date'<>'2035-05-03'
   OR expected->'missedExams'->0->>'exam'<>'Month exam' THEN
   RAISE EXCEPTION 'Admin missed exam details are wrong: %',expected;
 END IF;
 attendance:=public.get_student_attendance_breakdown(student_a);
 IF attendance-'months' IS DISTINCT FROM public.get_student_attendance_statistics(student_a)
   OR jsonb_array_length(attendance->'months')<>4
   OR attendance->'months'->0->>'month'<>'2035-06-01'
   OR (attendance->'months'->0->>'present')::integer<>1
   OR (attendance->'months'->0->>'excused')::integer<>1
   OR (attendance->'months'->0->>'percentage')::integer<>100
   OR (attendance->'months'->2->>'absent')::integer<>1
   OR (attendance->'months'->2->>'percentage')::integer<>50 THEN
   RAISE EXCEPTION 'Monthly attendance counts, approved leave, too late or ordering is wrong: %',attendance;
 END IF;
 IF public.get_student_attendance_breakdown(student_b)->'months'<>'[]'::jsonb THEN
   RAISE EXCEPTION 'Empty student has monthly attendance';
 END IF;
 payload:=public.get_student_attendance_fine_breakdown(student_a);
 IF jsonb_array_length(payload->'months')<>5 OR payload->'total' IS DISTINCT FROM public.get_student_attendance_fine_details(student_a)
 THEN RAISE EXCEPTION 'Admin monthly history or all-time fine is wrong: %',payload; END IF;
 IF payload->'months'->0->>'month'<>'2035-06-01' OR payload->'months'->1->>'month'<>'2035-05-01'
   OR (payload->'months'->1->>'examMissedCount')::integer<>1
   OR (payload->'months'->0->>'totalFine')::numeric<>0
   OR (payload->'months'->0->>'presentDays')::integer<>1
   OR (payload->'months'->1->>'presentDays')::integer<>0
   OR (payload->'months'->4->>'presentDays')::integer<>1 THEN
   RAISE EXCEPTION 'Newest-first ordering, exam-only absence or zero-fine month is wrong: %',payload;
 END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(payload->'months') LOOP
   expected:=public.get_student_attendance_fine_details(student_a,(entry->>'month')::date,
     ((entry->>'month')::date+interval '1 month - 1 day')::date);
   IF entry-'month'-'presentDays' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Monthly calculator disagrees: %',entry; END IF;
 END LOOP;
 IF public.get_student_attendance_fine_breakdown(student_b)->'months'<>'[]'::jsonb THEN RAISE EXCEPTION 'Empty student has monthly records'; END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',teacher_id::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 expected:=public.get_student_attendance_exceptions(student_a);
 IF jsonb_array_length(expected->'missedExams')<>1 OR expected->'missedExams'->0->>'exam'<>'Month exam' THEN
   RAISE EXCEPTION 'Teacher missed exam details leaked unassigned exams: %',expected;
 END IF;
 payload:=public.get_student_attendance_fine_breakdown(student_a);
 attendance:=public.get_student_attendance_breakdown(student_a);
 IF jsonb_array_length(attendance->'months')<>3 OR (attendance->'stats'->>'attendanceRate')::integer<>80 THEN
   RAISE EXCEPTION 'Monthly attendance leaked unassigned-class history: %',attendance;
 END IF;
 blocked:=false;
 BEGIN PERFORM public.get_student_attendance_breakdown(student_b); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Teacher accessed unassigned monthly attendance'; END IF;
 IF jsonb_array_length(payload->'months')<>4 OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'months') m WHERE m->>'month'='2035-01-01') THEN
   RAISE EXCEPTION 'Teacher saw records from an unassigned class';
 END IF;
 blocked:=false;
 BEGIN PERFORM public.get_student_attendance_fine_breakdown(student_b); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Teacher accessed an unassigned student'; END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',staff_id::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 blocked:=false;
 BEGIN PERFORM public.get_student_attendance_fine_breakdown(student_b); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Missing report permission was accepted for an empty student'; END IF;
 blocked:=false;
 BEGIN PERFORM public.get_student_attendance_breakdown(student_b); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Monthly attendance accepted missing report permission'; END IF;
 blocked:=false;
 BEGIN PERFORM public.get_student_attendance_exceptions(student_a); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Missed exam details accepted missing report permission'; END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',student_profile::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF jsonb_array_length(public.get_student_attendance_exceptions(student_a)->'missedExams')<>2 THEN
   RAISE EXCEPTION 'Linked student lost access to own missed exam details';
 END IF;
 blocked:=false;
 BEGIN PERFORM public.get_student_attendance_exceptions(student_b); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Student accessed another student missed exam details'; END IF;
 EXECUTE 'RESET ROLE';
END;
$test$;
ROLLBACK;
SELECT 'Passed monthly attendance counts and rates, fine calculator equivalence, ordering, empty months, exam-only absence and teacher/report permission isolation. All fixtures rolled back.' AS verification;
