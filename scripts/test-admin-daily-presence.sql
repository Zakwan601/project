BEGIN;
DO $$
DECLARE
  v_admin uuid;
  v_student_profile uuid;
  v_year_a uuid;
  v_year_b uuid;
  v_class_a uuid;
  v_class_a2 uuid;
  v_class_b uuid;
  v_empty_class uuid;
  v_students uuid[] := ARRAY[]::uuid[];
  v_student uuid;
  v_session_a uuid;
  v_session_a2 uuid;
  v_session_b uuid;
  v_data jsonb;
  v_row jsonb;
  v_i integer;
  v_denied boolean;
  v_date date;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
BEGIN
  SELECT id INTO STRICT v_admin FROM public.profiles WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1;
  SELECT profile_id INTO STRICT v_student_profile FROM public.students WHERE profile_id IS NOT NULL AND is_active ORDER BY id LIMIT 1;
  SELECT day::date INTO STRICT v_date FROM generate_series('2035-03-01'::date, '2035-03-30'::date, interval '1 day') day
  WHERE extract(dow FROM day) NOT IN (5,6) AND NOT EXISTS (SELECT 1 FROM public.holidays WHERE date=day::date)
  ORDER BY day LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('app.promotion_effective_date', '2035-01-01', true);
  INSERT INTO public.academic_years(name,start_date,end_date,is_current) VALUES ('Presence A '||v_suffix,'2035-01-01','2035-12-31',false) RETURNING id INTO v_year_a;
  INSERT INTO public.academic_years(name,start_date,end_date,is_current) VALUES ('Presence B '||v_suffix,'2035-01-01','2035-12-31',false) RETURNING id INTO v_year_b;
  INSERT INTO public.classes(name,grade,section,class_group,academic_year_id,is_active) VALUES ('Presence class A '||v_suffix,'11','A','science',v_year_a,false) RETURNING id INTO v_class_a;
  INSERT INTO public.classes(name,grade,section,class_group,academic_year_id,is_active) VALUES ('Presence class A2 '||v_suffix,'11','A2','science',v_year_a,false) RETURNING id INTO v_class_a2;
  INSERT INTO public.classes(name,grade,section,class_group,academic_year_id,is_active) VALUES ('Presence class B '||v_suffix,'11','B','science',v_year_b,false) RETURNING id INTO v_class_b;
  INSERT INTO public.classes(name,grade,section,class_group,academic_year_id,is_active) VALUES ('Presence empty '||v_suffix,'11','Empty','science',v_year_a,true) RETURNING id INTO v_empty_class;
  FOR v_i IN 1..7 LOOP
    INSERT INTO public.students(admission_number,first_name,last_name,class_id,class_group,is_active)
    VALUES ('PRESENCE-'||v_suffix||v_i,'Presence','Test',CASE WHEN v_i <= 3 THEN v_class_a WHEN v_i=4 THEN v_class_a2 WHEN v_i<=6 THEN v_class_b ELSE NULL END,'science',true)
    RETURNING id INTO v_student;
    v_students := array_append(v_students,v_student);
  END LOOP;
  INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by) VALUES (v_class_a,v_date,'full_day',v_admin) RETURNING id INTO v_session_a;
  INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by) VALUES (v_class_a2,v_date,'full_day',v_admin) RETURNING id INTO v_session_a2;
  INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by) VALUES (v_class_b,v_date,'full_day',v_admin) RETURNING id INTO v_session_b;
  IF v_session_a IS NULL OR v_session_a2 IS NULL OR v_session_b IS NULL THEN RAISE EXCEPTION 'Fixture day was excluded from attendance'; END IF;
  INSERT INTO public.attendance_records(session_id,student_id,status,marked_at) VALUES
    (v_session_a,v_students[1],'late',v_date::timestamp + interval '8 hours'),
    (v_session_a2,v_students[1],'present',v_date::timestamp + interval '9 hours'),
    (v_session_a,v_students[2],'excused',v_date::timestamp + interval '9 hours'),
    (v_session_a2,v_students[4],'absent',v_date::timestamp + interval '9 hours'),
    (v_session_b,v_students[5],'present',v_date::timestamp + interval '9 hours'),
    (v_session_b,v_students[6],'too_late',v_date::timestamp + interval '9 hours');
  v_data := public.get_admin_dashboard(v_date, v_date, v_date);
  IF (v_data->'stats'->>'tooLateToday')::int IS DISTINCT FROM 1
     OR (v_data->'stats'->>'absentToday')::int IS DISTINCT FROM 2
     OR (v_data->'stats'->>'todayAttendanceRate')::int IS DISTINCT FROM 67 THEN
    RAISE EXCEPTION 'Snapshot too-late count, absence total or attendance rate is wrong: %', v_data;
  END IF;
  v_data := public.get_admin_daily_presence(v_date);
  SELECT row INTO STRICT v_row FROM jsonb_array_elements(v_data->'classes') row WHERE row->>'class_id'=v_class_a::text;
  IF (v_row->>'students')::int <> 2 OR (v_row->>'excused')::int <> 1 OR (v_row->>'unmarked')::int <> 1 OR (v_row->>'absent')::int <> 0 THEN RAISE EXCEPTION 'Roster, deduplication or unmarked handling is wrong: %',v_row; END IF;
  SELECT row INTO STRICT v_row FROM jsonb_array_elements(v_data->'sessions') row WHERE row->>'session_id'=v_year_a::text;
  IF (v_row->>'students')::int <> 4 OR (v_row->>'present')::int <> 1 OR (v_row->>'late')::int <> 0 OR (v_row->>'absent')::int <> 1 OR (v_row->>'excused')::int <> 1 OR (v_row->>'unmarked')::int <> 1 OR (v_row->>'rate')::int <> 67 THEN RAISE EXCEPTION 'Session A totals or weighted rate is wrong: %',v_row; END IF;
  SELECT row INTO STRICT v_row FROM jsonb_array_elements(v_data->'sessions') row WHERE row->>'session_id'=v_year_b::text;
  IF (v_row->>'students')::int <> 2 OR (v_row->>'present')::int <> 1 OR (v_row->>'absent')::int <> 1 OR (v_row->>'rate')::int <> 50 THEN RAISE EXCEPTION 'Session B isolation or too-late handling is wrong: %',v_row; END IF;
  SELECT row INTO STRICT v_row FROM jsonb_array_elements(v_data->'classes') row WHERE row->>'class_id'=v_empty_class::text;
  IF (v_row->>'students')::int <> 0 OR v_row->>'rate' IS NOT NULL THEN RAISE EXCEPTION 'Empty class must have no attendance percentage'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_data->'classes') row WHERE row->>'class_id' IS NULL AND (row->>'unmarked')::int >= 1) THEN RAISE EXCEPTION 'Unassigned students were lost'; END IF;
  -- Moving a student later must not move the earlier day's roster.
  PERFORM set_config('app.promotion_effective_date',(v_date+1)::text,true);
  UPDATE public.students SET class_id=v_class_b WHERE id=v_students[3];
  v_data := public.get_admin_daily_presence(v_date);
  SELECT row INTO STRICT v_row FROM jsonb_array_elements(v_data->'classes') row WHERE row->>'class_id'=v_class_a::text;
  IF (v_row->>'unmarked')::int <> 1 THEN RAISE EXCEPTION 'Later transfer rewrote historical class membership'; END IF;
  v_data := public.get_admin_daily_presence(v_date+1);
  SELECT row INTO STRICT v_row FROM jsonb_array_elements(v_data->'classes') row WHERE row->>'class_id'=v_class_b::text;
  IF (v_row->>'students')::int <> 3 OR (v_row->>'unmarked')::int <> 3 OR v_row->>'rate' IS NOT NULL THEN RAISE EXCEPTION 'Following-day roster or record date filtering is wrong'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_student_profile::text,true);
  v_denied := false;
  BEGIN PERFORM public.get_admin_daily_presence(v_date); EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Student can read school-wide report'; END IF;
END;
$$;
ROLLBACK;
SELECT 'Passed daily deduplication, separate class/session totals, weighted rates, leave and too-late rules, unmarked and unassigned students, historical transfers, date filtering and student access denial. All fixtures rolled back.' AS verification;
