CREATE OR REPLACE FUNCTION public.get_classes_with_active_student_count(
  p_academic_year_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH class_rows AS (
    SELECT
      class.id,
      class.name,
      class.grade,
      class.section,
      class.academic_year_id,
      class.capacity,
      class.room,
      class.is_active,
      class.created_at,
      class.updated_at,
      CASE
        WHEN year.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', year.id,
          'name', year.name,
          'start_date', year.start_date,
          'end_date', year.end_date,
          'is_current', year.is_current,
          'created_at', year.created_at
        )
      END AS academic_years,
      COUNT(student.id)::integer AS active_student_count
    FROM public.classes AS class
    LEFT JOIN public.academic_years AS year
      ON year.id = class.academic_year_id
    LEFT JOIN public.students AS student
      ON student.class_id = class.id
     AND student.is_active = true
    WHERE p_academic_year_id IS NULL
       OR class.academic_year_id = p_academic_year_id
    GROUP BY class.id, year.id
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(class_rows) ORDER BY grade, section),
    '[]'::jsonb
  )
  FROM class_rows;
$$;

REVOKE ALL ON FUNCTION public.get_classes_with_active_student_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_classes_with_active_student_count(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_classes_with_active_student_count(uuid) IS
  'Returns classes with RLS-visible active student counts without transferring student rows.';
