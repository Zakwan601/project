/* Resolve biometric attendance against the student's class on the requested date. */

CREATE OR REPLACE FUNCTION public.get_student_class_on_date(
  p_student_id uuid,
  p_date date
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT candidate.class_id
  FROM (
    SELECT enrollment.class_id, 1 AS priority
    FROM public.student_enrollments AS enrollment
    WHERE enrollment.student_id = p_student_id
      AND enrollment.started_on <= p_date
      AND (enrollment.ended_on IS NULL OR enrollment.ended_on >= p_date)

    UNION ALL

    SELECT session.class_id, 2 AS priority
    FROM public.attendance_records AS record
    JOIN public.attendance_sessions AS session ON session.id = record.session_id
    WHERE record.student_id = p_student_id AND session.date = p_date

    UNION ALL

    SELECT student.class_id, 3 AS priority
    FROM public.students AS student
    WHERE student.id = p_student_id AND student.class_id IS NOT NULL
  ) AS candidate
  ORDER BY candidate.priority
  LIMIT 1;
$$;

DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated_definition text;
BEGIN
  SELECT to_regprocedure('public.sync_daily_attendance(date)')::oid
  INTO v_function_oid;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'sync_daily_attendance(date) was not found';
  END IF;

  SELECT pg_get_functiondef(v_function_oid) INTO v_definition;

  v_updated_definition := regexp_replace(
    v_definition,
    'FROM public\.classes AS cls[[:space:]]+WHERE cls\.is_active = true',
    'FROM public.classes AS cls
  JOIN public.academic_years AS year ON year.id = cls.academic_year_id
  WHERE p_date BETWEEN year.start_date AND year.end_date
    AND (cls.is_active = true OR p_date < current_date)',
    'g'
  );

  v_updated_definition := regexp_replace(
    v_updated_definition,
    'JOIN public\.students AS student[[:space:]]+ON student\.class_id = session\.class_id[[:space:]]+AND student\.is_active = true',
    'JOIN LATERAL public.get_class_students_for_period(session.class_id, p_date, p_date) AS student
    ON (student.is_active = true OR p_date < current_date)',
    'g'
  );

  v_updated_definition := replace(
    v_updated_definition,
    'student.class_id',
    'public.get_student_class_on_date(student.id, p_date)'
  );

  v_updated_definition := replace(
    v_updated_definition,
    'student.is_active = true',
    '(student.is_active = true OR p_date < current_date)'
  );

  IF v_updated_definition = v_definition
     OR position('student.class_id' IN v_updated_definition) > 0 THEN
    RAISE EXCEPTION 'Attendance sync definition did not match the expected class-assignment queries';
  END IF;

  EXECUTE v_updated_definition;
END;
$migration$;

REVOKE ALL ON FUNCTION public.get_student_class_on_date(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_class_on_date(uuid, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_student_class_on_date(uuid, date) IS
  'Returns the enrollment class valid on a date, with attendance/current assignment fallbacks for legacy data.';
