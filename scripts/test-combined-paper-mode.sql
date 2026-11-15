BEGIN;
-- Test against the linked schema without retaining any fixture or record changes.
DO $$
DECLARE
  v_pair public.result_subject_paper_groups%ROWTYPE;
  v_new_pair public.result_subject_paper_groups%ROWTYPE;
  v_exam public.result_exams%ROWTYPE;
  v_admin uuid;
  v_first uuid;
  v_second uuid;
  v_combined_exam uuid;
  v_separate_exam uuid;
  v_combined_type uuid;
  v_separate_type uuid;
  v_schedule uuid;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_test_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.result_subject_paper_identity('Bangla  1st Paper (বাংলা)')
    WHERE base_name = 'bangla' AND paper_number = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.result_subject_paper_identity('Home Science Second Paper (গার্হস্থ্য বিজ্ঞান)')
    WHERE base_name = 'home science' AND paper_number = 2
  ) THEN RAISE EXCEPTION 'Bilingual paper identity parsing failed'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.result_subject_paper_groups AS g
    JOIN public.subjects AS f ON f.id = g.first_paper_subject_id
    JOIN public.subjects AS s ON s.id = g.second_paper_subject_id
    WHERE g.is_active IS DISTINCT FROM (f.is_active AND s.is_active
      AND f.class_group = g.class_group AND s.class_group = g.class_group)
  ) THEN RAISE EXCEPTION 'Paper-group activation does not match the linked papers'; END IF;

  SELECT * INTO STRICT v_pair FROM public.result_subject_paper_groups
  WHERE class_group = 'science' AND is_active ORDER BY id LIMIT 1;
  UPDATE public.subjects SET name = name || ' ' WHERE id = v_pair.first_paper_subject_id;
  IF NOT EXISTS (SELECT 1 FROM public.result_subject_paper_groups
    WHERE id = v_pair.id AND name = v_pair.name AND is_active) THEN
    RAISE EXCEPTION 'Editing a bilingual paper disabled the pair or replaced its name';
  END IF;
  v_test_name := 'Paper mode check ' || v_suffix;
  INSERT INTO public.subjects (name, code, class_group, is_active)
  VALUES (v_test_name || ' First Paper (পরীক্ষা)', 'TMP' || v_suffix || '1', 'science', true)
  RETURNING id INTO v_first;
  INSERT INTO public.subjects (name, code, class_group, is_active)
  VALUES (v_test_name || ' Second Paper (পরীক্ষা)', 'TMP' || v_suffix || '2', 'science', true)
  RETURNING id INTO v_second;
  SELECT * INTO STRICT v_new_pair FROM public.result_subject_paper_groups
  WHERE first_paper_subject_id = v_first AND second_paper_subject_id = v_second;
  IF NOT v_new_pair.is_active OR v_new_pair.name <> (v_test_name || ' (পরীক্ষা)') THEN
    RAISE EXCEPTION 'New bilingual papers did not produce a combined course';
  END IF;
  -- Exercise activation using unassigned fixtures, respecting protections on real choices.
  UPDATE public.subjects SET is_active = false WHERE id = v_first;
  IF EXISTS (SELECT 1 FROM public.result_subject_paper_groups WHERE id = v_new_pair.id AND is_active) THEN
    RAISE EXCEPTION 'Disabling a paper did not disable its pair';
  END IF;
  UPDATE public.subjects SET is_active = true WHERE id = v_first;
  IF NOT EXISTS (SELECT 1 FROM public.result_subject_paper_groups WHERE id = v_new_pair.id AND is_active AND name = v_new_pair.name) THEN
    RAISE EXCEPTION 'Re-enabling a paper failed to restore the named pair';
  END IF;

  SELECT id INTO STRICT v_admin FROM public.profiles WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SELECT exam.* INTO STRICT v_exam FROM public.result_exams AS exam
  JOIN public.classes AS class ON class.id = exam.class_id
  JOIN public.result_exam_types AS exam_type ON exam_type.id = exam.exam_type_id
  WHERE class.class_group = 'science' AND class.is_active AND exam_type.is_active
  ORDER BY exam.id LIMIT 1;
  INSERT INTO public.result_exam_types (name, is_active)
  VALUES (v_test_name || ' combined', true) RETURNING id INTO v_combined_type;
  INSERT INTO public.result_exam_types (name, is_active)
  VALUES (v_test_name || ' separate', true) RETURNING id INTO v_separate_type;

  SELECT created.exam_id INTO STRICT v_combined_exam
  FROM public.create_result_exams_for_classes(ARRAY[v_exam.class_id], v_combined_type,
    v_test_name || ' combined', v_exam.exam_date, true, true, false) AS created;
  INSERT INTO public.result_exam_subjects (exam_id, subject_id, paper_group_id,
    creative_max, written_max, practical_max, pass_mark, creative_pass_mark, written_pass_mark)
  VALUES (v_combined_exam, v_first, v_new_pair.id, 70, 30, 0, 33, 23, 10);

  BEGIN
    INSERT INTO public.result_exam_subjects (exam_id, subject_id, creative_max, written_max, practical_max, pass_mark)
    VALUES (v_combined_exam, v_second, 70, 30, 0, 33);
    RAISE EXCEPTION 'Individual paper was accepted in combined mode' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Choose the combined subject instead of an individual paper' THEN RAISE; END IF;
  END;

  v_schedule := public.create_result_exam_routine_entry(ARRAY[v_combined_exam], v_second, v_exam.exam_date, '09:00'::time);
  IF NOT EXISTS (SELECT 1 FROM public.result_exam_schedules
    WHERE id = v_schedule AND subject_id = v_first AND subject_name = v_new_pair.name) THEN
    RAISE EXCEPTION 'Combined routine did not use the canonical course name and first-paper ID';
  END IF;

  SELECT created.exam_id INTO STRICT v_separate_exam
  FROM public.create_result_exams_for_classes(ARRAY[v_exam.class_id], v_separate_type,
    v_test_name || ' separate', v_exam.exam_date, true, false, false) AS created;
  INSERT INTO public.result_exam_subjects (exam_id, subject_id, creative_max, written_max, practical_max, pass_mark)
  VALUES (v_separate_exam, v_first, 70, 30, 0, 33), (v_separate_exam, v_second, 70, 30, 0, 33);
  v_schedule := public.create_result_exam_routine_entry(ARRAY[v_separate_exam], v_second, v_exam.exam_date, '10:00'::time);
  IF NOT EXISTS (SELECT 1 FROM public.result_exam_schedules
    WHERE id = v_schedule AND subject_id = v_second AND subject_name LIKE '%Second Paper%') THEN
    RAISE EXCEPTION 'Separate-paper routine no longer preserves individual paper names';
  END IF;
END;
$$;
ROLLBACK;
SELECT 'Passed bilingual pairing, activation, combined configuration/routine, and separate-paper configuration/routine; all test writes rolled back.' AS verification;
