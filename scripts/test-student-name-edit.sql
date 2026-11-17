BEGIN;
DO $$
DECLARE
  v_student public.students%ROWTYPE;
  v_other uuid;
  v_count integer;
BEGIN
  SELECT * INTO STRICT v_student FROM public.students WHERE profile_id IS NOT NULL AND is_active ORDER BY id LIMIT 1;
  SELECT id INTO STRICT v_other FROM public.students WHERE profile_id IS NOT NULL AND profile_id <> v_student.profile_id AND is_active ORDER BY id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_student.profile_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.students SET first_name = 'StudentNameTest', last_name = 'Multiple Family Names' WHERE id = v_student.id AND profile_id = v_student.profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Student cannot update own name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_student.profile_id AND full_name = 'StudentNameTest Multiple Family Names') THEN RAISE EXCEPTION 'Name did not synchronize to login profile'; END IF;
  UPDATE public.students SET first_name = 'StudentNameTest', last_name = '' WHERE id = v_student.id;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_student.profile_id AND full_name = 'StudentNameTest') THEN RAISE EXCEPTION 'Single-word name did not synchronize'; END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE id = v_student.id AND (guardian_phone IS DISTINCT FROM v_student.guardian_phone OR admission_number IS DISTINCT FROM v_student.admission_number OR class_id IS DISTINCT FROM v_student.class_id OR group_fourth_option_id IS DISTINCT FROM v_student.group_fourth_option_id)) THEN RAISE EXCEPTION 'Name update changed unrelated student data'; END IF;
  UPDATE public.students SET first_name = 'StudentNameTest' WHERE id = v_other;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Student can update another student name'; END IF;
  EXECUTE 'RESET ROLE';
END;
$$;
ROLLBACK;
SELECT 'Passed student name editing, multi-part and single-word name synchronization, unchanged unrelated fields, and prevention of edits to other students. All changes rolled back.' AS verification;
