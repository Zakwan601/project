BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $$
DECLARE
  v_id uuid := 'ebd5a931-a3a9-4a1e-9703-a0858b7d8d6e';
  v_name text;
  v_records bigint;
  v_marks bigint;
  v_subjects bigint;
  v_options bigint;
  v_students bigint;
BEGIN
  SELECT name INTO v_name FROM public.classes WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF btrim(v_name) <> 'Test Purpose' THEN RAISE EXCEPTION 'Unexpected class name; no deletion performed'; END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE class_id = v_id)
    OR EXISTS (SELECT 1 FROM public.student_enrollments WHERE class_id = v_id)
    OR EXISTS (SELECT 1 FROM public.result_exams WHERE class_id = v_id)
    OR EXISTS (SELECT 1 FROM public.attendance_records record JOIN public.attendance_sessions session ON session.id = record.session_id WHERE session.class_id = v_id)
    OR EXISTS (SELECT 1 FROM public.class_daily_dismissal_times WHERE class_id = v_id)
    OR EXISTS (SELECT 1 FROM public.student_departure_anomaly_reports WHERE class_id = v_id)
    OR EXISTS (SELECT 1 FROM public.device_log_archive_runs WHERE class_id = v_id)
  THEN RAISE EXCEPTION 'Class has substantive linked data; no deletion performed'; END IF;
  SELECT count(*) INTO v_records FROM public.attendance_records;
  SELECT count(*) INTO v_marks FROM public.result_marks;
  SELECT count(*) INTO v_subjects FROM public.subjects;
  SELECT count(*) INTO v_options FROM public.subject_course_options;
  SELECT count(*) INTO v_students FROM public.students;
  -- These subjects are used by real students and exams. Preserve their IDs and curriculum.
  UPDATE public.subjects SET class_id = NULL WHERE class_id = v_id;
  DELETE FROM public.classes WHERE id = v_id;
  IF v_records <> (SELECT count(*) FROM public.attendance_records)
    OR v_marks <> (SELECT count(*) FROM public.result_marks)
    OR v_subjects <> (SELECT count(*) FROM public.subjects)
    OR v_options <> (SELECT count(*) FROM public.subject_course_options)
    OR v_students <> (SELECT count(*) FROM public.students)
  THEN RAISE EXCEPTION 'Deletion affected protected records; all changes rolled back'; END IF;
END;
$$;
SELECT NOT EXISTS (SELECT 1 FROM public.classes WHERE id = 'ebd5a931-a3a9-4a1e-9703-a0858b7d8d6e') AS test_class_removed,
  (SELECT count(*) FROM public.students) AS students_preserved,
  (SELECT count(*) FROM public.result_marks) AS marks_preserved,
  (SELECT count(*) FROM public.subject_course_options) AS course_options_preserved;
COMMIT;
