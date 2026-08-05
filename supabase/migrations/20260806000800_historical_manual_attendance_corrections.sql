/* Allow audited corrections for students who belonged to the session class on its date. */

DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated_definition text;
BEGIN
  SELECT to_regprocedure('public.correct_attendance_records(uuid,jsonb,text)')::oid
  INTO v_function_oid;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'correct_attendance_records(uuid,jsonb,text) was not found';
  END IF;

  SELECT pg_get_functiondef(v_function_oid) INTO v_definition;

  v_updated_definition := regexp_replace(
    v_definition,
    'JOIN public\.students student ON student\.class_id = session\.class_id[[:space:]]+WHERE session\.id = p_session_id AND student\.id = v_student_id',
    'JOIN public.students student ON student.id = v_student_id
      WHERE session.id = p_session_id
        AND public.get_student_class_on_date(student.id, session.date) = session.class_id',
    'g'
  );

  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'Attendance correction definition did not match the expected membership check';
  END IF;

  EXECUTE v_updated_definition;
END;
$migration$;

COMMENT ON FUNCTION public.correct_attendance_records(uuid, jsonb, text) IS
  'Atomically applies audited admin corrections using class membership on the session date.';
