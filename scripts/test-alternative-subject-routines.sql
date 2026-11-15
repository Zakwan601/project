BEGIN;
DO $$
DECLARE
  v_admin uuid;
  v_class uuid;
  v_year public.academic_years%ROWTYPE;
  v_students uuid[];
  v_profiles uuid[];
  v_type uuid;
  v_separate_type uuid;
  v_exam uuid;
  v_separate_exam uuid;
  v_group uuid;
  v_date date;
  v_first uuid;
  v_second uuid;
  v_firsts uuid[] := ARRAY[]::uuid[];
  v_seconds uuid[] := ARRAY[]::uuid[];
  v_options uuid[] := ARRAY[]::uuid[];
  v_option uuid;
  v_session uuid;
  v_schedule uuid;
  v_count integer;
  v_i integer;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_name text;
  v_details jsonb;
BEGIN
  IF has_function_privilege('authenticated', 'public.student_takes_routine_subject(uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.student_takes_routine_subject(uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Internal curriculum lookup must not expose other student choices';
  END IF;
  SELECT id INTO STRICT v_admin FROM public.profiles WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SELECT student.class_id INTO STRICT v_class FROM public.students AS student
  JOIN public.classes AS class ON class.id = student.class_id
  WHERE class.class_group = 'humanities' AND class.is_active AND student.is_active AND student.profile_id IS NOT NULL
  GROUP BY student.class_id HAVING count(*) >= 3 ORDER BY student.class_id LIMIT 1;
  SELECT year.* INTO STRICT v_year FROM public.academic_years AS year
  JOIN public.classes AS class ON class.academic_year_id = year.id WHERE class.id = v_class;
  SELECT array_agg(id ORDER BY id), array_agg(profile_id ORDER BY id) INTO v_students, v_profiles
  FROM (SELECT student.id, student.profile_id FROM public.students AS student
    WHERE student.class_id = v_class AND student.is_active AND student.profile_id IS NOT NULL ORDER BY student.id LIMIT 3) AS selected;
  SELECT day::date INTO STRICT v_date FROM generate_series(v_year.start_date, v_year.end_date, interval '1 day') AS dates(day)
  WHERE NOT EXISTS (SELECT 1 FROM public.attendance_sessions WHERE class_id = v_class AND date = day::date)
    AND NOT EXISTS (SELECT 1 FROM public.result_exam_schedules AS schedule
      JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
      JOIN public.result_exams AS exam ON exam.id = link.exam_id WHERE exam.class_id = v_class AND schedule.exam_date = day::date)
  ORDER BY day DESC LIMIT 1;

  FOR v_i IN 1..3 LOOP
    v_name := 'Routine alternative ' || v_suffix || ' ' || v_i;
    INSERT INTO public.subjects (name, code, class_group, is_active, is_fourth_subject)
    VALUES (v_name || ' First Paper (পরীক্ষা)', 'TMP' || v_suffix || v_i || '1', 'humanities', true, true) RETURNING id INTO v_first;
    INSERT INTO public.subjects (name, code, class_group, is_active, is_fourth_subject)
    VALUES (v_name || ' Second Paper (পরীক্ষা)', 'TMP' || v_suffix || v_i || '2', 'humanities', true, true) RETURNING id INTO v_second;
    INSERT INTO public.subject_course_options (class_group, name, first_paper_subject_id, second_paper_subject_id,
      is_active, available_as_elective, available_as_fourth)
    VALUES ('humanities', v_name, v_first, v_second, true, true, true) RETURNING id INTO v_option;
    v_firsts := array_append(v_firsts, v_first);
    v_seconds := array_append(v_seconds, v_second);
    v_options := array_append(v_options, v_option);
  END LOOP;
  UPDATE public.students SET humanities_main_option_1_id = CASE id WHEN v_students[1] THEN v_options[1] WHEN v_students[2] THEN v_options[2] ELSE NULL END,
    humanities_main_option_2_id = NULL, humanities_main_option_3_id = NULL, group_fourth_option_id = NULL,
    humanities_fourth_option_id = NULL, group_elective_option_id = NULL
  WHERE id = ANY(v_students);
  INSERT INTO public.result_exam_types (name, is_active) VALUES ('Alternative routine ' || v_suffix, true) RETURNING id INTO v_type;
  SELECT created.exam_id INTO STRICT v_exam FROM public.create_result_exams_for_classes(
    ARRAY[v_class], v_type, 'Alternative routine test', v_date, false, true, false
  ) AS created;
  SELECT exam_group_id INTO v_group FROM public.result_exams WHERE id = v_exam;

  SELECT count(*) INTO v_count FROM public.create_result_exam_routine_entries(v_exam, v_firsts, v_date, '09:00'::time);
  IF v_count <> 3 THEN RAISE EXCEPTION 'Expected three alternative subjects at one date/time'; END IF;
  PERFORM public.create_result_exam_routine_entries(v_exam, v_firsts, v_date, '09:00'::time);
  SELECT count(*) INTO v_count FROM public.result_exam_schedules AS schedule
  JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id WHERE link.exam_id = v_exam;
  IF v_count <> 3 THEN RAISE EXCEPTION 'Retry duplicated or overwrote alternative subjects'; END IF;
  SELECT count(*) INTO v_count FROM public.create_result_exam_routine_entries(v_exam, ARRAY[v_firsts[1], v_seconds[1]], v_date, '09:00'::time);
  IF v_count <> 1 THEN RAISE EXCEPTION 'Combined papers were not deduplicated to one course'; END IF;
  PERFORM public.create_result_exam_routine_entry(ARRAY[v_exam], v_firsts[1], v_date, '09:00'::time);
  IF EXISTS (SELECT 1 FROM public.result_exam_schedules AS schedule
    JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
    WHERE link.exam_id = v_exam AND (schedule.subject_name LIKE '%First Paper%' OR schedule.subject_name LIKE '%Second Paper%')) THEN
    RAISE EXCEPTION 'Combined routine exposed individual paper names';
  END IF;

  BEGIN
    PERFORM public.create_result_exam_routine_entries(v_exam, ARRAY[v_firsts[1], gen_random_uuid()], v_date, '11:00'::time);
    RAISE EXCEPTION 'Invalid subject batch was accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Select active subjects from the examination class group' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_result_exam_routine_entries(v_exam, v_firsts, v_date, NULL);
    RAISE EXCEPTION 'Exam-only time requirement was bypassed' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Exam time is required for an exam-only examination' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.result_exam_schedules (exam_group_id, subject_id, subject_name, exam_date, exam_time, has_regular_classes)
    VALUES (v_group, v_firsts[1], 'Duplicate test', v_date, '09:00', false) RETURNING id INTO v_schedule;
    INSERT INTO public.result_exam_schedule_classes (schedule_id, exam_id) VALUES (v_schedule, v_exam);
    RAISE EXCEPTION 'Duplicate subject slot was accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'This subject is already scheduled at that date and time' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_count FROM public.result_exam_schedules AS schedule
  JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id WHERE link.exam_id = v_exam;
  IF v_count <> 3 THEN RAISE EXCEPTION 'A rejected request retained partial schedule records'; END IF;

  INSERT INTO public.attendance_sessions (class_id, date, taken_by) VALUES (v_class, v_date, v_admin) RETURNING id INTO v_session;
  INSERT INTO public.attendance_records (session_id, student_id, status)
  SELECT v_session, selected.id, 'absent'::public.attendance_status FROM unnest(v_students) AS selected(id);

  FOR v_i IN 1..3 LOOP
    PERFORM set_config('request.jwt.claim.sub', v_profiles[v_i]::text, true);
    SELECT count(*) INTO v_count FROM public.get_student_exam_routine(v_exam);
    IF v_count <> (CASE WHEN v_i = 3 THEN 0 ELSE 1 END) THEN
      RAISE EXCEPTION 'Student % received the wrong number of alternative-subject exams: %', v_i, v_count;
    END IF;
    IF v_i < 3 AND NOT EXISTS (SELECT 1 FROM public.get_student_exam_routine(v_exam)
      WHERE subject_name LIKE ('Routine alternative ' || v_suffix || ' ' || v_i || '%')) THEN
      RAISE EXCEPTION 'Student routine did not match the chosen subject';
    END IF;
    v_details := public.get_student_attendance_fine_details(v_students[v_i], v_date, v_date);
    IF (v_details->>'examMissedCount')::integer <> (CASE WHEN v_i = 3 THEN 0 ELSE 1 END) THEN
      RAISE EXCEPTION 'Student % was charged for unrelated alternatives: %', v_i, v_details;
    END IF;
    IF (v_details->>'recordedAbsences')::integer <> 0 THEN
      RAISE EXCEPTION 'An exam-only day incorrectly added a class-absence fine';
    END IF;
    v_details := public.get_student_attendance_exceptions(v_students[v_i]);
    SELECT count(*) INTO v_count FROM jsonb_array_elements(v_details->'missedExams') AS missed(item)
    WHERE (item->>'date')::date = v_date AND item->>'exam' = 'Alternative routine test';
    IF v_count <> (CASE WHEN v_i = 3 THEN 0 ELSE 1 END) THEN
      RAISE EXCEPTION 'Missed-exam details included an unrelated alternative';
    END IF;
  END LOOP;
  BEGIN
    PERFORM public.create_result_exam_routine_entries(v_exam, v_firsts, v_date, '11:00'::time);
    RAISE EXCEPTION 'Student was allowed to schedule examinations' USING ERRCODE = 'XX000';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  FOR v_i IN 1..3 LOOP
    SELECT exam_missed_count INTO STRICT v_count FROM public.get_class_attendance_fine_details(v_class, v_date, v_date)
    WHERE student_id = v_students[v_i];
    IF v_count <> (CASE WHEN v_i = 3 THEN 0 ELSE 1 END) THEN
      RAISE EXCEPTION 'Class fine report does not respect each student subject choice';
    END IF;
  END LOOP;
  PERFORM public.create_result_exam_routine_entries(v_exam, ARRAY[v_firsts[1]], v_date, '10:00'::time);
  v_details := public.get_student_attendance_fine_details(v_students[1], v_date, v_date);
  IF (v_details->>'examMissedCount')::integer <> 1 THEN
    RAISE EXCEPTION 'Multiple routine entries on one exam date multiplied the daily exam fine';
  END IF;

  INSERT INTO public.result_exam_types (name, is_active) VALUES ('Separate alternatives ' || v_suffix, true) RETURNING id INTO v_separate_type;
  SELECT created.exam_id INTO STRICT v_separate_exam FROM public.create_result_exams_for_classes(
    ARRAY[v_class], v_separate_type, 'Separate alternative test', v_date, true, false, false
  ) AS created;
  SELECT count(*) INTO v_count FROM public.create_result_exam_routine_entries(v_separate_exam, ARRAY[v_firsts[1], v_seconds[1]], v_date, NULL);
  IF v_count <> 2 THEN RAISE EXCEPTION 'Separate-paper mode did not keep distinct papers'; END IF;
END;
$$;
ROLLBACK;
SELECT 'Passed alternative slots, retries, duplicate protection, atomic errors, student curriculum filtering, fine counts, authorization, and separate/combined paper modes. All fixtures rolled back.' AS verification;
