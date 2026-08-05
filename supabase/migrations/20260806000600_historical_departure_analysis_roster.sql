/* Make the existing departure analyzer use the class roster for the selected date. */

DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated_definition text;
BEGIN
  SELECT to_regprocedure('public.analyze_student_departures(uuid,date,time)')::oid
  INTO v_function_oid;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'analyze_student_departures(uuid,date,time) was not found';
  END IF;

  SELECT pg_get_functiondef(v_function_oid) INTO v_definition;

  v_updated_definition := regexp_replace(
    v_definition,
    'FROM public\.students AS student[[:space:]]+WHERE student\.class_id = p_class_id AND student\.is_active = true',
    'FROM public.get_class_students_for_period(p_class_id, p_date, p_date) AS student',
    'g'
  );

  v_updated_definition := regexp_replace(
    v_updated_definition,
    'WHERE cls\.id = p_class_id AND cls\.is_active = true;',
    'WHERE cls.id = p_class_id;',
    'g'
  );

  v_updated_definition := replace(
    v_updated_definition,
    '''status'', ''class_not_found'', ''message'', ''Active class not found''',
    '''status'', ''class_not_found'', ''message'', ''Class not found'''
  );

  IF v_updated_definition = v_definition
     OR position('student.class_id = p_class_id' IN v_updated_definition) > 0 THEN
    RAISE EXCEPTION 'Departure analyzer definition did not match the expected roster query';
  END IF;

  EXECUTE v_updated_definition;
END;
$migration$;

COMMENT ON FUNCTION public.analyze_student_departures(uuid, date, time) IS
  'Analyzes the selected date using that date''s enrollment roster, including promoted students in their historical class.';
