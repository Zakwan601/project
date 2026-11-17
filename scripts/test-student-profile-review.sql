BEGIN;
DO $$
DECLARE
  v_admin uuid;
  v_student public.students%ROWTYPE;
  v_other_profile uuid;
  v_count integer;
  v_failed boolean;
  v_option uuid;
BEGIN
  SELECT id INTO STRICT v_admin FROM public.profiles WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1;
  SELECT * INTO STRICT v_student FROM public.students WHERE profile_id IS NOT NULL AND is_active ORDER BY (group_fourth_option_id IS NOT NULL) DESC, id LIMIT 1;
  SELECT profile_id INTO STRICT v_other_profile FROM public.students WHERE profile_id IS NOT NULL AND profile_id <> v_student.profile_id AND is_active ORDER BY id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  DELETE FROM public.student_profile_review_notices WHERE student_id = v_student.id;
  UPDATE public.students SET photo_url = 'https://example.invalid/review-test.jpg', father_name = 'Review test father', mother_name = 'Review test mother', birth_certificate_path = 'test/review.pdf' WHERE id = v_student.id;
  PERFORM public.remove_student_profile_details(v_student.id, ARRAY['photo_url','father_name'], 'Please correct these details');
  SELECT count(*) INTO v_count FROM public.student_profile_review_notices WHERE student_id = v_student.id AND reason = 'Please correct these details';
  IF v_count <> 2 THEN RAISE EXCEPTION 'Expected two private field notices'; END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE id = v_student.id AND (photo_url IS NOT NULL OR father_name IS NOT NULL)) THEN RAISE EXCEPTION 'Student data not removed'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_student.profile_id AND (avatar_url IS NOT NULL OR father_name IS NOT NULL)) THEN RAISE EXCEPTION 'Profile data not synchronized'; END IF;
  v_failed := false;
  BEGIN PERFORM public.remove_student_profile_details(v_student.id, ARRAY['mother_name','guardian_phone'], NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed OR (SELECT mother_name IS NULL FROM public.students WHERE id = v_student.id) THEN RAISE EXCEPTION 'Unsupported fields must reject atomically'; END IF;
  PERFORM public.remove_student_profile_details(v_student.id, ARRAY['photo_url','photo_url'], NULL);
  IF (SELECT count(*) FROM public.student_profile_review_notices WHERE student_id = v_student.id) <> 2 THEN RAISE EXCEPTION 'Repeated removal must not duplicate notices'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_other_profile::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.student_profile_review_notices WHERE student_id = v_student.id;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Another student can read private notices'; END IF;
  v_failed := false;
  BEGIN PERFORM public.remove_student_profile_details(v_student.id, ARRAY['mother_name'], NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Student can invoke administrator removal'; END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', v_student.profile_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.student_profile_review_notices WHERE student_id = v_student.id;
  IF v_count <> 2 THEN RAISE EXCEPTION 'Student cannot read own notices'; END IF;
  v_failed := false;
  BEGIN DELETE FROM public.student_profile_review_notices WHERE student_id = v_student.id;
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Student can dismiss notices without corrections'; END IF;
  UPDATE public.profiles SET avatar_url = 'https://example.invalid/corrected.jpg' WHERE id = v_student.profile_id;
  IF EXISTS (SELECT 1 FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key = 'photo_url') THEN RAISE EXCEPTION 'Photo correction did not clear its notice'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key = 'father_name') THEN RAISE EXCEPTION 'Correcting photo cleared unrelated notice'; END IF;
  UPDATE public.profiles SET mother_name = 'Unrelated edit' WHERE id = v_student.profile_id;
  IF NOT EXISTS (SELECT 1 FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key = 'father_name') THEN RAISE EXCEPTION 'Unrelated edit cleared notice'; END IF;
  UPDATE public.profiles SET father_name = 'Corrected father' WHERE id = v_student.profile_id;
  IF EXISTS (SELECT 1 FROM public.student_profile_review_notices WHERE student_id = v_student.id) THEN RAISE EXCEPTION 'Corrected personal field did not clear notice'; END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  UPDATE public.students SET birth_certificate_path = NULL WHERE id = v_student.id;
  IF NOT EXISTS (SELECT 1 FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key = 'birth_certificate_path') THEN RAISE EXCEPTION 'Existing document removal path did not generate notice'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_student.profile_id::text, true);
  UPDATE public.students SET birth_certificate_path = 'test/replaced.pdf' WHERE id = v_student.id;
  IF EXISTS (SELECT 1 FROM public.student_profile_review_notices WHERE student_id = v_student.id) THEN RAISE EXCEPTION 'Document replacement did not clear notice'; END IF;

  -- Use the saved curriculum to test full subject removal and restoration.
  IF v_student.group_fourth_option_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    PERFORM public.remove_student_profile_details(v_student.id, ARRAY['subjects'], 'Choose the correct subjects');
    IF EXISTS (SELECT 1 FROM public.students WHERE id = v_student.id AND (fourth_subject_id IS NOT NULL OR optional_subject_2_id IS NOT NULL OR group_elective_option_id IS NOT NULL OR group_fourth_option_id IS NOT NULL OR humanities_main_option_1_id IS NOT NULL OR humanities_main_option_2_id IS NOT NULL OR humanities_main_option_3_id IS NOT NULL OR humanities_fourth_option_id IS NOT NULL)) THEN RAISE EXCEPTION 'Subject removal left stale choices'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key = 'subjects') THEN RAISE EXCEPTION 'Subject removal did not create notice'; END IF;
    PERFORM set_config('request.jwt.claim.sub', v_student.profile_id::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF v_student.class_group <> 'science' THEN
      UPDATE public.students SET group_fourth_option_id = v_student.group_fourth_option_id WHERE id = v_student.id;
      IF NOT EXISTS (SELECT 1 FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key = 'subjects') THEN RAISE EXCEPTION 'Incomplete curriculum cleared its notice'; END IF;
    END IF;
    UPDATE public.students SET group_elective_option_id = v_student.group_elective_option_id,
      group_fourth_option_id = v_student.group_fourth_option_id,
      humanities_main_option_1_id = v_student.humanities_main_option_1_id,
      humanities_main_option_2_id = v_student.humanities_main_option_2_id,
      humanities_main_option_3_id = v_student.humanities_main_option_3_id,
      humanities_fourth_option_id = v_student.humanities_fourth_option_id WHERE id = v_student.id;
    IF EXISTS (SELECT 1 FROM public.student_profile_review_notices WHERE student_id = v_student.id AND field_key = 'subjects') THEN RAISE EXCEPTION 'Restoring curriculum did not clear notice'; END IF;
    EXECUTE 'RESET ROLE';
  ELSE RAISE EXCEPTION 'Test requires one linked student with completed subject choices'; END IF;
END;
$$;
ROLLBACK;
SELECT 'Passed atomic removal, media/profile synchronization, private student visibility, admin-only access, field-specific resolution, legacy document paths and subject restoration. All fixtures rolled back.' AS verification;
