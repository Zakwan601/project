BEGIN;
DO $$
DECLARE
  v_student public.students%ROWTYPE;
  v_other uuid;
  v_admin uuid;
  v_count integer;
  v_bad text;
  v_field text;
  v_rejected boolean;
BEGIN
  SELECT * INTO STRICT v_student FROM public.students WHERE profile_id IS NOT NULL AND is_active ORDER BY id LIMIT 1;
  SELECT id INTO STRICT v_other FROM public.students WHERE profile_id IS NOT NULL AND profile_id <> v_student.profile_id AND is_active ORDER BY id LIMIT 1;
  SELECT id INTO STRICT v_admin FROM public.profiles WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1;
  DELETE FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key IN ('student_phone', 'present_address', 'permanent_address');
  PERFORM set_config('request.jwt.claim.sub', v_student.profile_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.students SET student_phone = '+8801812345678', present_address = 'Current address, Dhaka', permanent_address = E'Home address\nChattogram' WHERE id = v_student.id AND profile_id = v_student.profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Student cannot save own contact details'; END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE id = v_student.id AND guardian_phone IS DISTINCT FROM v_student.guardian_phone) THEN RAISE EXCEPTION 'Student phone overwrote guardian phone'; END IF;
  UPDATE public.students SET student_phone = '01812345678' WHERE id = v_other;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Student can change another student contact details'; END IF;
  FOREACH v_bad IN ARRAY ARRAY['', '123', '01212345678', '018123456789'] LOOP
    v_rejected := false;
    BEGIN UPDATE public.students SET student_phone = v_bad WHERE id = v_student.id;
    EXCEPTION WHEN check_violation THEN v_rejected := true; END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'Invalid student mobile accepted'; END IF;
  END LOOP;
  FOREACH v_field IN ARRAY ARRAY['present_address', 'permanent_address'] LOOP
    FOREACH v_bad IN ARRAY ARRAY['', '   ', E'\t\n', repeat('x', 1001)] LOOP
      v_rejected := false;
      BEGIN EXECUTE format('UPDATE public.students SET %I = $1 WHERE id = $2', v_field) USING v_bad, v_student.id;
      EXCEPTION WHEN check_violation THEN v_rejected := true; END;
      IF NOT v_rejected THEN RAISE EXCEPTION 'Blank or oversized address accepted'; END IF;
    END LOOP;
  END LOOP;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.remove_student_profile_details(v_student.id, ARRAY['student_phone', 'present_address', 'permanent_address'], 'Please correct your contact details');
  IF (SELECT count(*) FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key IN ('student_phone', 'present_address', 'permanent_address')) <> 3 THEN RAISE EXCEPTION 'Removal did not produce three private notices'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = v_student.id AND student_phone IS NULL AND present_address IS NULL AND permanent_address IS NULL) THEN RAISE EXCEPTION 'Admin cannot leave new details empty for student completion'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_student.profile_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.students SET student_phone = '01812345678' WHERE id = v_student.id;
  IF EXISTS (SELECT 1 FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key = 'student_phone') THEN RAISE EXCEPTION 'Student phone notice did not clear'; END IF;
  IF (SELECT count(*) FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key IN ('present_address', 'permanent_address')) <> 2 THEN RAISE EXCEPTION 'Correcting phone cleared address notices'; END IF;
  UPDATE public.students SET present_address = 'Corrected current address', permanent_address = 'Corrected permanent address' WHERE id = v_student.id;
  IF EXISTS (SELECT 1 FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key IN ('student_phone', 'present_address', 'permanent_address')) THEN RAISE EXCEPTION 'Corrected addresses did not clear notices'; END IF;
  EXECUTE 'RESET ROLE';
END;
$$;
ROLLBACK;
SELECT 'Passed student contact saves, guardian phone preservation, row privacy, validation, admin clearing and field-specific correction notices. All changes rolled back.' AS verification;
