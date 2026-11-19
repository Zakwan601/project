BEGIN ISOLATION LEVEL REPEATABLE READ;
-- Independent reference keeps the previous grouping-before-pagination semantics.
CREATE FUNCTION pg_temp.reference_punch_page(p_class_id uuid,p_date date,p_page int,p_size int,p_admission text,p_search text)
RETURNS TABLE(student_biometric_id text,punch_date date,punch_ids uuid[],punch_times timestamptz[],first_name text,last_name text,photo_url text,attendance_status public.attendance_status,total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH daily AS (
    SELECT log.student_biometric_id,(log.punched_at AT TIME ZONE 'Asia/Dhaka')::date AS punch_date,
      array_agg(log.id ORDER BY log.punched_at,log.id) AS punch_ids,
      array_agg(log.punched_at ORDER BY log.punched_at,log.id) AS punch_times,
      student.id AS student_id,student.first_name,student.last_name,student.photo_url
    FROM public.device_logs log LEFT JOIN public.students student ON student.admission_number=log.student_biometric_id
    WHERE (p_admission IS NULL OR log.student_biometric_id=p_admission)
      AND (p_date IS NULL OR (log.punched_at >= (p_date::timestamp AT TIME ZONE 'Asia/Dhaka') AND log.punched_at < ((p_date+1)::timestamp AT TIME ZONE 'Asia/Dhaka')))
      AND (p_class_id IS NULL OR public.get_student_class_on_date(student.id,(log.punched_at AT TIME ZONE 'Asia/Dhaka')::date)=p_class_id)
      AND (coalesce(btrim(p_search),'')='' OR strpos(lower(concat_ws(' ',log.student_biometric_id,student.first_name,student.last_name)),lower(btrim(p_search)))>0)
    GROUP BY log.student_biometric_id,(log.punched_at AT TIME ZONE 'Asia/Dhaka')::date,student.id,student.first_name,student.last_name,student.photo_url
  ) SELECT daily.student_biometric_id,daily.punch_date,daily.punch_ids,daily.punch_times,daily.first_name,daily.last_name,daily.photo_url,
    public.get_punch_attendance_status(daily.student_id,daily.punch_date),count(*) OVER()
  FROM daily ORDER BY daily.punch_date DESC,daily.punch_times[1] DESC,daily.student_biometric_id
  LIMIT least(greatest(p_size,1),100) OFFSET (greatest(p_page,1)::bigint-1)*least(greatest(p_size,1),100);
$$;
DO $test$
DECLARE
  admin_id uuid; teacher_id uuid:=gen_random_uuid(); profile_a uuid:=gen_random_uuid();
  year_id uuid; class_a uuid; class_b uuid; student_a uuid; student_b uuid; session_a uuid;
  fixture_date date; suffix text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
  admission_a text; admission_b text; admission_unknown text;
  actual jsonb; expected jsonb; scenario record; n integer;
BEGIN
  SELECT id INTO STRICT admin_id FROM public.profiles WHERE role='admin' AND is_active ORDER BY id LIMIT 1;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (teacher_id,'punch-teacher-'||suffix||'@example.invalid','{"full_name":"Punch teacher"}'),
    (profile_a,'punch-student-'||suffix||'@example.invalid','{"full_name":"Punch Alpha"}');
  UPDATE public.profiles SET role='sub_admin',sub_admin_label='teacher' WHERE id=teacher_id;
  INSERT INTO public.sub_admin_permissions(profile_id,permission_key,can_read) VALUES(teacher_id,'punches',true);
  INSERT INTO public.academic_years(name,start_date,end_date,is_current) VALUES('Punch test '||suffix,'2035-01-01','2035-12-31',false) RETURNING id INTO year_id;
  INSERT INTO public.classes(name,grade,section,class_group,academic_year_id) VALUES('Punch A '||suffix,'11','A','science',year_id) RETURNING id INTO class_a;
  INSERT INTO public.classes(name,grade,section,class_group,academic_year_id) VALUES('Punch B '||suffix,'11','B','science',year_id) RETURNING id INTO class_b;
  SELECT day::date INTO STRICT fixture_date FROM generate_series('2035-03-01'::date,'2035-03-30'::date,interval '1 day') day
    WHERE extract(dow FROM day) NOT IN(5,6) AND NOT EXISTS(SELECT 1 FROM public.holidays WHERE date=day::date) ORDER BY day LIMIT 1;
  admission_a:='PUNCH_A_'||suffix; admission_b:='PUNCH_B_'||suffix; admission_unknown:='PUNCH_UNKNOWN_'||suffix;
  PERFORM set_config('app.promotion_effective_date','2035-01-01',true);
  INSERT INTO public.students(profile_id,admission_number,first_name,last_name,class_id,class_group)
    VALUES(profile_a,admission_a,'Punch Alpha','O''Neil',class_a,'science') RETURNING id INTO student_a;
  INSERT INTO public.students(admission_number,first_name,last_name,class_id,class_group)
    VALUES(admission_b,'Punch Beta','Test',class_b,'science') RETURNING id INTO student_b;
  INSERT INTO public.attendance_sessions(class_id,date,session_type,taken_by) VALUES(class_a,fixture_date,'full_day',admin_id) RETURNING id INTO session_a;
  INSERT INTO public.attendance_records(session_id,student_id,status,manually_corrected) VALUES(session_a,student_a,'present',true);
  INSERT INTO public.device_logs(student_biometric_id,punched_at) VALUES
    (admission_a,(fixture_date::timestamp+time '09:30') AT TIME ZONE 'Asia/Dhaka'),
    (admission_a,(fixture_date::timestamp+time '09:30') AT TIME ZONE 'Asia/Dhaka'),
    (admission_a,(fixture_date::timestamp+time '14:00') AT TIME ZONE 'Asia/Dhaka'),
    (admission_a,(fixture_date::timestamp+time '23:59:59') AT TIME ZONE 'Asia/Dhaka'),
    (admission_a,((fixture_date+1)::timestamp+time '00:00') AT TIME ZONE 'Asia/Dhaka'),
    (admission_b,(fixture_date::timestamp+time '09:30') AT TIME ZONE 'Asia/Dhaka'),
    (admission_b,(fixture_date::timestamp+time '15:00') AT TIME ZONE 'Asia/Dhaka'),
    (admission_unknown,(fixture_date::timestamp+time '09:30') AT TIME ZONE 'Asia/Dhaka');
  -- A later transfer must not change the earlier punch day's class filter.
  PERFORM set_config('app.promotion_effective_date',(fixture_date+2)::text,true);
  UPDATE public.students SET class_id=class_a WHERE id=student_b;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM public.set_teacher_classes(teacher_id,ARRAY[class_a]);
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOR scenario IN SELECT * FROM (VALUES
    (NULL::uuid,NULL::date,1,1,NULL::text,suffix), (NULL,NULL,2,1,NULL,suffix),
    (NULL,NULL,1,25,NULL,suffix), (NULL,NULL,1,0,NULL,suffix), (NULL,NULL,0,500,NULL,suffix),
    (NULL,NULL,99999,25,NULL,suffix), (NULL,fixture_date,1,25,NULL,suffix),
    (NULL,fixture_date+1,1,25,NULL,suffix), (NULL,fixture_date-1,1,25,NULL,suffix),
    (class_a,fixture_date,1,25,NULL,suffix), (class_b,fixture_date,1,25,NULL,suffix),
    (class_a,fixture_date+2,1,25,NULL,suffix), (NULL,NULL,1,25,admission_a,''),
    (NULL,NULL,1,25,admission_unknown,''), (NULL,NULL,1,25,NULL,'  PUNCH ALPHA  '),
    (NULL,NULL,1,25,NULL,'O''NEIL'), (NULL,NULL,1,25,NULL,'%'), (NULL,NULL,1,25,NULL,'PUNCH_A_')
  ) cases(class_id,report_date,page,size,admission,search) LOOP
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') INTO actual FROM public.search_daily_punches_page(scenario.class_id,scenario.report_date,scenario.page,scenario.size,scenario.admission,scenario.search) r;
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') INTO expected FROM pg_temp.reference_punch_page(scenario.class_id,scenario.report_date,scenario.page,scenario.size,scenario.admission,scenario.search) r;
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Paging or filters changed for %: actual %, expected %',scenario,actual,expected; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.search_daily_punches_page(NULL,fixture_date,1,25,admission_a,'') r WHERE attendance_status='present' AND cardinality(punch_ids)=4;
  IF n<>1 THEN RAISE EXCEPTION 'Authoritative attendance status or same-time punch ordering changed'; END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub',teacher_id::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF EXISTS(SELECT 1 FROM public.search_daily_punches_page(NULL,NULL,1,25,admission_unknown,'')) THEN RAISE EXCEPTION 'Teacher saw an unknown user punch'; END IF;
  -- Student B is currently assigned to this teacher, but historical class B stays filtered out.
  IF EXISTS(SELECT 1 FROM public.search_daily_punches_page(class_b,NULL,1,25,NULL,suffix)) THEN RAISE EXCEPTION 'Teacher saw an unassigned historical class'; END IF;
  SELECT count(*) INTO n FROM public.search_daily_punches_page(NULL,NULL,1,25,admission_a,'');
  IF n<>2 THEN RAISE EXCEPTION 'Teacher could not page assigned student punch days'; END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',profile_a::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF EXISTS(SELECT 1 FROM public.search_daily_punches_page(NULL,NULL,1,25,admission_b,'')) THEN RAISE EXCEPTION 'Student saw another student punches'; END IF;
  SELECT count(*) INTO n FROM public.search_daily_punches_page(NULL,NULL,1,25,admission_a,'');
  IF n<>2 THEN RAISE EXCEPTION 'Student own punch access changed'; END IF;
  EXECUTE 'RESET ROLE';
END;
$test$;
ROLLBACK;
SELECT 'Passed pagination equivalence, exact totals, page bounds, literal ID/name search, historical classes, Dhaka midnight boundaries, unknown IDs, duplicate times, authoritative status, and teacher/student access restrictions. All fixtures rolled back.' AS verification;
