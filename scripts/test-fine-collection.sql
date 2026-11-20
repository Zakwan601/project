BEGIN;
DO $test$
<<testcase>>
DECLARE
 admin_id uuid; teacher_id uuid:=gen_random_uuid(); pupil uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid();
 year_id uuid; class_id uuid; student_id uuid; other_student uuid; session_id uuid; event record;
 subject_id uuid; exam_id uuid; exam_subject uuid; exam_type uuid;
 account jsonb; quote jsonb; paid jsonb; again jsonb; first_paid jsonb; request_id uuid:=gen_random_uuid();
 blocked boolean; count_rows integer; suffix text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
BEGIN
 SELECT id INTO STRICT admin_id FROM public.profiles WHERE role='admin' AND is_active ORDER BY id LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (teacher_id,'fine-teacher-'||suffix||'@example.invalid','{"full_name":"Fine teacher"}'),
 (pupil,'fine-student-'||suffix||'@example.invalid','{"full_name":"Fine student"}'),
 (other_user,'fine-other-'||suffix||'@example.invalid','{"full_name":"Other student"}');
 UPDATE public.profiles SET role='sub_admin',sub_admin_label='teacher' WHERE id=teacher_id;
 INSERT INTO public.sub_admin_permissions(profile_id,permission_key,can_read,can_write) VALUES(teacher_id,'reports',true,true),(teacher_id,'students',true,true);
 INSERT INTO public.academic_years(name,start_date,end_date,is_current) VALUES('Collection test '||suffix,'2020-01-01','2020-12-31',false) RETURNING id INTO year_id;
 INSERT INTO public.classes(name,grade,section,class_group,academic_year_id) VALUES('Collection test '||suffix,'11','A','science',year_id) RETURNING id INTO class_id;
 INSERT INTO public.teacher_class_assignments(profile_id,class_id) VALUES(teacher_id,class_id);
 PERFORM set_config('app.promotion_effective_date','2020-01-01',true);
 INSERT INTO public.students(profile_id,admission_number,first_name,last_name,class_id,class_group,student_phone)
 VALUES(pupil,'COLLECT-'||suffix,'Original','Student',class_id,'science','01712345678') RETURNING id INTO student_id;
 INSERT INTO public.students(profile_id,admission_number,first_name,last_name,class_id,class_group)
 VALUES(other_user,'COLLECT-OTHER-'||suffix,'Other','Student',class_id,'science') RETURNING id INTO other_student;
 UPDATE public.attendance_fine_settings SET fine_per_absent_day=50,exam_missed_fine=100 WHERE id=true;
 FOR event IN SELECT * FROM (VALUES('2020-01-12'::date,'absent'),('2020-01-13'::date,'late'),('2020-01-21'::date,'late'),
   ('2020-01-26'::date,'absent'),('2020-02-02'::date,'absent'),('2020-02-03'::date,'too_late'),('2020-02-25'::date,'absent')) dates(day,status) LOOP
   INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by) VALUES(class_id,event.day,'full_day',admin_id) RETURNING id INTO session_id;
   INSERT INTO public.attendance_records(session_id,student_id,status) VALUES(session_id,student_id,event.status::public.attendance_status);
 END LOOP;
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 account:=public.get_student_fine_account(student_id,'2020-01-20'); quote:=account->'quote';
 IF quote->>'from_date'<>'2020-01-12' OR (quote->>'gross_amount')::numeric<>50 THEN RAISE EXCEPTION 'Initial fine quote wrong: %',quote; END IF;
 blocked:=false;
 BEGIN PERFORM public.collect_student_fine(student_id,'2020-01-20',51,'2020-01-12',50,gen_random_uuid()); EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Excess waiver accepted'; END IF;
 paid:=public.collect_student_fine(student_id,'2020-01-20',10,'2020-01-12',50,request_id); first_paid:=paid;
 IF (paid->>'paid_amount')::numeric<>40 OR paid->>'period_end'<>'2020-01-20' OR paid->'student_snapshot'->>'name'<>'Original Student' THEN RAISE EXCEPTION 'Payment amount or receipt snapshot wrong'; END IF;
 again:=public.collect_student_fine(student_id,'2020-01-20',10,'2020-01-12',50,request_id);
 IF again->>'id'<>paid->>'id' THEN RAISE EXCEPTION 'Retry created a second payment'; END IF;
 account:=public.get_student_fine_account(student_id,'2020-01-21'); quote:=account->'quote';
 IF account->>'next_start'<>'2020-01-21' OR (quote->>'gross_amount')::numeric<>50 THEN RAISE EXCEPTION 'Paid cutoff or late-day carry was lost: %',account; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(account->'months') m WHERE m->>'month'='2020-01-01' AND m->>'status'='partial') THEN RAISE EXCEPTION 'Partial month status missing'; END IF;
 blocked:=false;
 BEGIN PERFORM public.collect_student_fine(student_id,'2020-01-20',0,'2020-01-12',50,gen_random_uuid()); EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Overlapping collection accepted'; END IF;
 blocked:=false;
 BEGIN PERFORM public.collect_student_fine(student_id,'2020-01-21',0,'2020-01-21',999,gen_random_uuid()); EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Stale/tampered amount accepted'; END IF;
 PERFORM public.collect_student_fine(student_id,'2020-01-21',0,'2020-01-21',50,gen_random_uuid());
 paid:=public.collect_student_fine(student_id,'2020-02-20',10,'2020-01-22',150,gen_random_uuid());
 IF (paid->>'paid_amount')::numeric<>140 OR (SELECT sum((m->>'waiver_amount')::numeric) FROM jsonb_array_elements(paid->'monthly_breakdown') m)<>10
   OR (SELECT sum((m->>'paid_amount')::numeric) FROM jsonb_array_elements(paid->'monthly_breakdown') m)<>140 THEN RAISE EXCEPTION 'Monthly allocation/rounding mismatch'; END IF;
 paid:=public.collect_student_fine(student_id,'2020-02-25',50,'2020-02-21',50,gen_random_uuid());
 IF (paid->>'paid_amount')::numeric<>0 THEN RAISE EXCEPTION 'Full waiver did not settle to zero'; END IF;
 account:=public.get_student_fine_account(student_id,'2020-02-25');
 IF account->>'next_start'<>'2020-02-26' OR (account->'quote'->>'eligible')::boolean THEN RAISE EXCEPTION 'Paid dates still collectible'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(account->'months') m WHERE m->>'month'='2020-01-01' AND m->>'status'='paid' AND (m->>'unpaid_amount')::numeric=0) THEN RAISE EXCEPTION 'Paid month status wrong'; END IF;
 blocked:=false;
 BEGIN PERFORM public.collect_student_fine(student_id,(now() AT TIME ZONE 'Asia/Dhaka')::date+1,0,'2020-02-26',0,gen_random_uuid()); EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Future payment accepted'; END IF;
 blocked:=false;
 BEGIN UPDATE public.fine_collections SET waiver_amount=0 WHERE id=(first_paid->>'id')::uuid; EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Receipt was editable directly'; END IF;
 UPDATE public.students SET first_name='Changed' WHERE id=student_id;
 IF (SELECT student_snapshot->>'name' FROM public.fine_collections WHERE id=(first_paid->>'id')::uuid)<>'Original Student' THEN RAISE EXCEPTION 'Receipt snapshot changed with profile'; END IF;
 IF jsonb_array_length(public.get_student_fine_month_details(student_id,'2020-01-01')->'attendance')<>4 THEN RAISE EXCEPTION 'Month detail records missing'; END IF;
 SELECT id INTO STRICT exam_type FROM public.result_exam_types WHERE marks_mode='total_only' AND is_active ORDER BY id LIMIT 1;
 INSERT INTO public.subjects(name,code,class_group,is_fourth_subject,is_active) VALUES('Collection exam '||suffix,'collect-'||suffix,'science',false,true) RETURNING id INTO subject_id;
 INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,title,exam_date,has_regular_classes)
 VALUES(class_id,year_id,exam_type,'Collection missed exam','2020-03-01',false) RETURNING id INTO exam_id;
 INSERT INTO public.result_exam_subjects(exam_id,subject_id,creative_max,written_max,practical_max,pass_mark)
 VALUES(exam_id,subject_id,0,20,0,0) RETURNING id INTO exam_subject;
 PERFORM public.create_result_exam_routine_entries(exam_id,ARRAY[subject_id],'2020-03-01','10:00');
 INSERT INTO public.result_marks(exam_subject_id,student_id,is_absent) VALUES(exam_subject,other_student,true);
 account:=public.get_student_fine_account(other_student,'2020-03-01');
 IF (account->'quote'->>'gross_amount')::numeric<>100 THEN RAISE EXCEPTION 'Exam-only fine missing from collection quote'; END IF;
 paid:=public.collect_student_fine(other_student,'2020-03-01',25,'2020-03-01',100,gen_random_uuid());
 IF (paid->>'paid_amount')::numeric<>75 OR (paid->'fine_snapshot'->>'examMissedFine')::numeric<>100 THEN RAISE EXCEPTION 'Exam fine receipt is wrong'; END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',teacher_id::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 blocked:=false;
 BEGIN PERFORM public.collect_student_fine(student_id,'2020-03-01',0,'2020-02-26',0,gen_random_uuid()); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Teacher collected a fine'; END IF;
 blocked:=false;
 BEGIN PERFORM public.get_student_fine_account(student_id); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Teacher accessed collection account'; END IF;
 SELECT count(*) INTO count_rows FROM public.fine_collections c WHERE c.student_id=testcase.student_id;
 IF count_rows<>0 THEN RAISE EXCEPTION 'Teacher read receipt table'; END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',pupil::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 account:=public.get_student_fine_account(student_id,'2020-02-25');
 IF jsonb_array_length(account->'payments')<>4 OR account->>'paid_through'<>'2020-02-25' THEN RAISE EXCEPTION 'Student cannot see own paid history'; END IF;
 SELECT count(*) INTO count_rows FROM public.fine_collections c WHERE c.student_id=testcase.other_student;
 IF count_rows<>0 THEN RAISE EXCEPTION 'Student read another receipt directly'; END IF;
 blocked:=false;
 BEGIN PERFORM public.get_student_fine_account(other_student); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Student read another account'; END IF;
 blocked:=false;
 BEGIN PERFORM public.collect_student_fine(student_id,'2020-03-01',0,'2020-02-26',0,gen_random_uuid()); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Student collected a fine'; END IF;
 EXECUTE 'RESET ROLE';
END;
$test$;
ROLLBACK;
SELECT 'Passed fine/waiver/net amounts, idempotent retries, nonoverlapping paid dates, late carry, receipt snapshots, monthly allocations, full waivers, future/stale rejection and admin/student/teacher permissions. All fixtures rolled back.' AS verification;
