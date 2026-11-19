BEGIN;
DO $test$
DECLARE
  v_admin uuid;
  v_teacher uuid := gen_random_uuid();
  v_subadmin uuid := gen_random_uuid();
  v_profile_a uuid := gen_random_uuid();
  v_profile_b uuid := gen_random_uuid();
  v_year_a uuid;
  v_year_b uuid;
  v_class_a uuid;
  v_class_b uuid;
  v_student_a uuid;
  v_student_b uuid;
  v_session_a uuid;
  v_session_b uuid;
  v_exam_type uuid;
  v_exam_a uuid;
  v_exam_b uuid;
  v_subject uuid;
  v_exam_subject_a uuid;
  v_exam_subject_b uuid;
  v_schedule_a uuid;
  v_schedule_b uuid;
  v_date date;
  v_data jsonb;
  v_blocked boolean;
  v_count integer;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
BEGIN
  SELECT id INTO STRICT v_admin FROM public.profiles WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_teacher,'teacher-scope-'||v_suffix||'@example.invalid','{"full_name":"Scope teacher"}'),
    (v_subadmin,'subadmin-scope-'||v_suffix||'@example.invalid','{"full_name":"Scope subadmin"}'),
    (v_profile_a,'student-a-scope-'||v_suffix||'@example.invalid','{"full_name":"Scope student A"}'),
    (v_profile_b,'student-b-scope-'||v_suffix||'@example.invalid','{"full_name":"Scope student B"}');
  UPDATE public.profiles SET role = 'sub_admin', sub_admin_label = 'teacher' WHERE id = v_teacher;
  UPDATE public.profiles SET role = 'sub_admin' WHERE id = v_subadmin;
  INSERT INTO public.sub_admin_permissions(profile_id,permission_key,can_read,can_write)
    SELECT p.id, key, true, key <> 'dashboard' FROM unnest(ARRAY[v_teacher,v_subadmin]) p(id)
    CROSS JOIN unnest(ARRAY['dashboard','students','classes','attendance','reports','results','punches','departure_anomalies','devices','announcements','vacations','complaints','sms_messages']) permission(key);
  INSERT INTO public.academic_years(name,start_date,end_date,is_current) VALUES ('Scope A '||v_suffix,'2035-01-01','2035-12-31',false) RETURNING id INTO v_year_a;
  INSERT INTO public.academic_years(name,start_date,end_date,is_current) VALUES ('Scope B '||v_suffix,'2035-01-01','2035-12-31',false) RETURNING id INTO v_year_b;
  INSERT INTO public.classes(name,grade,section,class_group,academic_year_id,is_active) VALUES ('Scope A '||v_suffix,'11','A','science',v_year_a,true) RETURNING id INTO v_class_a;
  INSERT INTO public.classes(name,grade,section,class_group,academic_year_id,is_active) VALUES ('Scope B '||v_suffix,'11','B','science',v_year_b,true) RETURNING id INTO v_class_b;
  SELECT day::date INTO STRICT v_date FROM generate_series('2035-03-01'::date,'2035-03-30'::date,interval '1 day') day
    WHERE extract(dow FROM day) NOT IN (5,6) AND NOT EXISTS (SELECT 1 FROM public.holidays WHERE date=day::date) ORDER BY day LIMIT 1;
  PERFORM set_config('app.promotion_effective_date', '2035-01-01', true);
  INSERT INTO public.students(profile_id,admission_number,first_name,last_name,class_id,class_group,is_active)
    VALUES(v_profile_a,'SCOPE-A-'||v_suffix,'Scope','A',v_class_a,'science',true) RETURNING id INTO v_student_a;
  INSERT INTO public.students(profile_id,admission_number,first_name,last_name,class_id,class_group,is_active)
    VALUES(v_profile_b,'SCOPE-B-'||v_suffix,'Scope','B',v_class_b,'science',true) RETURNING id INTO v_student_b;
  INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by) VALUES(v_class_a,v_date,'full_day',v_admin) RETURNING id INTO v_session_a;
  INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by) VALUES(v_class_b,v_date,'full_day',v_admin) RETURNING id INTO v_session_b;
  INSERT INTO public.attendance_records(session_id,student_id,status) VALUES(v_session_a,v_student_a,'too_late'),(v_session_b,v_student_b,'present');
  INSERT INTO public.subjects(name,code,class_group,is_fourth_subject,is_active) VALUES('Scope subject '||v_suffix,'scope-'||v_suffix,'science',false,true) RETURNING id INTO v_subject;
  INSERT INTO public.result_exam_types(name) VALUES('Scope exam '||v_suffix) RETURNING id INTO v_exam_type;
  INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,title,exam_date,status) VALUES(v_class_a,v_year_a,v_exam_type,'Scope A',v_date,'draft') RETURNING id INTO v_exam_a;
  INSERT INTO public.result_exams(class_id,academic_year_id,exam_type_id,title,exam_date,status) VALUES(v_class_b,v_year_b,v_exam_type,'Scope B',v_date,'draft') RETURNING id INTO v_exam_b;
  INSERT INTO public.result_exam_subjects(exam_id,subject_id,creative_max,written_max,practical_max,pass_mark) VALUES(v_exam_a,v_subject,0,100,0,33) RETURNING id INTO v_exam_subject_a;
  INSERT INTO public.result_exam_subjects(exam_id,subject_id,creative_max,written_max,practical_max,pass_mark) VALUES(v_exam_b,v_subject,0,100,0,33) RETURNING id INTO v_exam_subject_b;
  INSERT INTO public.result_marks(exam_subject_id,student_id,written_marks) VALUES(v_exam_subject_a,v_student_a,70),(v_exam_subject_b,v_student_b,90);
  SELECT id INTO v_schedule_a FROM public.create_result_exam_routine_entries(v_exam_a,ARRAY[v_subject],v_date,'10:00') id;
  SELECT id INTO v_schedule_b FROM public.create_result_exam_routine_entries(v_exam_b,ARRAY[v_subject],v_date,'10:00') id;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.set_teacher_classes(v_teacher,ARRAY[v_class_a]);
  -- Invalid replacements are atomic and cannot erase existing assignments.
  v_blocked := false;
  BEGIN PERFORM public.set_teacher_classes(v_teacher,ARRAY[gen_random_uuid()]);
  EXCEPTION WHEN raise_exception THEN v_blocked := true; END;
  IF NOT v_blocked OR NOT EXISTS(SELECT 1 FROM public.teacher_class_assignments WHERE profile_id=v_teacher AND class_id=v_class_a) THEN RAISE EXCEPTION 'Invalid assignment erased valid access'; END IF;

  PERFORM set_config('request.jwt.claim.sub',v_teacher::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF NOT public.is_class_restricted_teacher() OR NOT public.teacher_can_access_class(v_class_a) OR public.teacher_can_access_class(v_class_b) THEN RAISE EXCEPTION 'Teacher class membership is wrong'; END IF;
  IF (SELECT count(*) FROM public.classes WHERE id IN(v_class_a,v_class_b)) <> 1
    OR (SELECT count(*) FROM public.students WHERE id IN(v_student_a,v_student_b)) <> 1
    OR (SELECT count(*) FROM public.academic_years WHERE id IN(v_year_a,v_year_b)) <> 1
    OR (SELECT count(*) FROM public.profiles WHERE id IN(v_teacher,v_profile_a,v_profile_b,v_admin,v_subadmin)) <> 2
    OR (SELECT count(*) FROM public.attendance_sessions WHERE id IN(v_session_a,v_session_b)) <> 1
    OR (SELECT count(*) FROM public.attendance_records WHERE student_id IN(v_student_a,v_student_b)) <> 1
    OR (SELECT count(*) FROM public.result_exams WHERE id IN(v_exam_a,v_exam_b)) <> 1
    OR (SELECT count(*) FROM public.result_marks WHERE student_id IN(v_student_a,v_student_b)) <> 1
    OR (SELECT count(*) FROM public.result_exam_schedules WHERE id IN(v_schedule_a,v_schedule_b)) <> 1 THEN
    RAISE EXCEPTION 'Direct table access leaked an unassigned class, profile, student, attendance or result';
  END IF;
  IF EXISTS(SELECT 1 FROM public.get_class_students_for_period(v_class_b,v_date,v_date)) THEN RAISE EXCEPTION 'Unassigned roster was exposed'; END IF;
  v_data := public.get_admin_dashboard(v_date,v_date,v_date);
  IF (v_data->'stats'->>'totalStudents')::int <> 1 OR (v_data->'stats'->>'totalClasses')::int <> 1
    OR (v_data->'stats'->>'presentToday')::int <> 0 OR (v_data->'stats'->>'tooLateToday')::int <> 1 THEN RAISE EXCEPTION 'Dashboard totals include unassigned classes: %',v_data; END IF;
  v_data := public.get_admin_daily_presence(v_date);
  IF jsonb_array_length(v_data->'classes') <> 1 OR v_data->'classes'->0->>'class_id' <> v_class_a::text THEN RAISE EXCEPTION 'Daily presence leaked other classes: %',v_data; END IF;
  IF public.can_view_result_exam(v_exam_b) OR public.can_view_exam_routine(v_exam_b) OR public.can_view_result_mark(v_exam_subject_b,v_student_b) THEN RAISE EXCEPTION 'Exam visibility helper leaked another class'; END IF;
  v_data := public.build_student_result(v_exam_b,v_student_b);
  IF v_data->'student' <> 'null'::jsonb OR jsonb_array_length(v_data->'subjects') <> 0 THEN RAISE EXCEPTION 'Direct result builder exposed another student'; END IF;
  v_data := public.get_student_result(v_exam_a,v_student_a);
  IF v_data->'student'->>'id' <> v_student_a::text THEN RAISE EXCEPTION 'Assigned student result is inaccessible'; END IF;
  v_data := public.get_student_attendance_statistics(v_student_a);
  IF (v_data->'stats'->>'absentCount')::int <> 1 THEN RAISE EXCEPTION 'Assigned attendance statistics are inaccessible'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.get_class_attendance_fine_details(v_class_a,v_date,v_date)) THEN RAISE EXCEPTION 'Assigned class fines are inaccessible'; END IF;

  v_blocked := false;
  BEGIN PERFORM public.get_student_result(v_exam_b,v_student_b); EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Out-of-scope result RPC succeeded'; END IF;
  v_blocked := false;
  BEGIN PERFORM public.get_student_attendance_fine_details(v_student_b); EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Out-of-scope fine RPC succeeded'; END IF;
  v_blocked := false;
  BEGIN PERFORM public.correct_attendance_records(v_session_b,jsonb_build_array(jsonb_build_object('student_id',v_student_b,'status','absent')),'Scope test reason'); EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Out-of-scope correction RPC succeeded'; END IF;
  v_blocked := false;
  BEGIN PERFORM public.assign_students_to_class(ARRAY[v_student_a,v_student_b],v_class_a,v_date); EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Mixed bulk assignment succeeded'; END IF;
  v_blocked := false;
  BEGIN PERFORM public.create_result_exam_routine_entries(v_exam_b,ARRAY[v_subject],v_date,'11:00'); EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Out-of-scope routine RPC succeeded'; END IF;
  v_blocked := false;
  BEGIN PERFORM public.sync_daily_attendance(v_date); EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'School-wide sync was available to a teacher'; END IF;
  IF public.has_permission('vacations','write') OR public.has_permission('devices','read') THEN RAISE EXCEPTION 'Teacher retained school-wide controls'; END IF;
  v_blocked := false;
  BEGIN PERFORM public.set_teacher_classes(v_teacher,ARRAY[v_class_b]); EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Teacher could assign their own classes'; END IF;
  v_blocked := false;
  BEGIN UPDATE public.profiles SET sub_admin_label='sub_admin' WHERE id=v_teacher; EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Teacher could remove their class restriction'; END IF;
  UPDATE public.students SET first_name='Forbidden' WHERE id=v_student_b;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>0 THEN RAISE EXCEPTION 'Direct edit reached an unassigned student'; END IF;
  PERFORM public.correct_attendance_records(v_session_a,jsonb_build_array(jsonb_build_object('student_id',v_student_a,'status','late')),'Scope test reason');
  IF NOT EXISTS(SELECT 1 FROM public.attendance_records WHERE student_id=v_student_a AND status='late') THEN RAISE EXCEPTION 'Assigned attendance cannot be edited'; END IF;
  PERFORM public.create_result_exam_routine_entries(v_exam_a,ARRAY[v_subject],v_date,'11:00');
  UPDATE public.result_marks SET written_marks=75 WHERE exam_subject_id=v_exam_subject_a AND student_id=v_student_a;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION 'Assigned marks cannot be edited'; END IF;
  UPDATE public.result_marks SET written_marks=0 WHERE exam_subject_id=v_exam_subject_b AND student_id=v_student_b;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>0 THEN RAISE EXCEPTION 'Unassigned marks could be edited directly'; END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM public.set_teacher_classes(v_teacher,ARRAY[]::uuid[]);
  PERFORM set_config('request.jwt.claim.sub',v_teacher::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF EXISTS(SELECT 1 FROM public.classes) OR EXISTS(SELECT 1 FROM public.students) THEN RAISE EXCEPTION 'No assignments granted class or student access'; END IF;
  v_data:=public.get_admin_dashboard(v_date,v_date,v_date);
  IF (v_data->'stats'->>'totalStudents')::int<>0 OR (v_data->'stats'->>'totalClasses')::int<>0 THEN RAISE EXCEPTION 'No assignments exposed dashboard totals'; END IF;
  EXECUTE 'RESET ROLE';

  -- An ordinary sub-admin remains governed by module grants across classes.
  PERFORM set_config('request.jwt.claim.sub',v_subadmin::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF public.is_class_restricted_teacher() OR (SELECT count(*) FROM public.students WHERE id IN(v_student_a,v_student_b))<>2 THEN RAISE EXCEPTION 'Ordinary sub-admin access changed'; END IF;
  EXECUTE 'RESET ROLE';
  -- Student ownership policies and administrator access remain intact.
  PERFORM set_config('request.jwt.claim.sub',v_profile_b::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF NOT EXISTS(SELECT 1 FROM public.students WHERE id=v_student_b) OR EXISTS(SELECT 1 FROM public.students WHERE id=v_student_a) THEN RAISE EXCEPTION 'Student ownership access changed'; END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF (SELECT count(*) FROM public.students WHERE id IN(v_student_a,v_student_b))<>2 THEN RAISE EXCEPTION 'Administrator access changed'; END IF;
  EXECUTE 'RESET ROLE';
END;
$test$;
ROLLBACK;
SELECT 'Passed teacher-only class assignments, table and RPC scope, dashboard totals, assigned-class editing, bulk request rejection, empty assignments, privilege escalation protection, and admin/sub-admin/student regressions. All fixtures rolled back.' AS verification;
