/* Assign or transfer selected students to one class without promotion-order restrictions. */

CREATE OR REPLACE FUNCTION public.assign_students_to_class(
  p_student_ids uuid[],
  p_target_class_id uuid,
  p_effective_date date DEFAULT current_date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_group public.class_group;
  v_target_capacity integer;
  v_target_year_start date;
  v_target_year_end date;
  v_selected_count integer;
  v_assign_count integer;
  v_current_count integer;
  v_updated integer;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_permission('students', 'write') THEN
    RAISE EXCEPTION 'Student write permission is required';
  END IF;

  IF COALESCE(array_length(p_student_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Select at least one student';
  END IF;

  IF p_target_class_id IS NULL OR p_effective_date IS NULL THEN
    RAISE EXCEPTION 'Target class and effective date are required';
  END IF;

  SELECT class.class_group, class.capacity, year.start_date, year.end_date
  INTO v_target_group, v_target_capacity, v_target_year_start, v_target_year_end
  FROM public.classes AS class
  JOIN public.academic_years AS year ON year.id = class.academic_year_id
  WHERE class.id = p_target_class_id AND class.is_active = true
  FOR UPDATE OF class;

  IF v_target_group IS NULL THEN
    RAISE EXCEPTION 'Target class must be active and belong to an academic session';
  END IF;

  IF p_effective_date < v_target_year_start OR p_effective_date > v_target_year_end THEN
    RAISE EXCEPTION 'Assignment date must fall within the target academic session';
  END IF;

  SELECT count(*) INTO v_selected_count
  FROM public.students
  WHERE id = ANY(p_student_ids) AND is_active = true;

  IF v_selected_count <> array_length(p_student_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected students are missing, inactive, or duplicated';
  END IF;

  PERFORM 1
  FROM public.students
  WHERE id = ANY(p_student_ids)
  FOR UPDATE;

  SELECT count(*) INTO v_assign_count
  FROM public.students
  WHERE id = ANY(p_student_ids)
    AND is_active = true
    AND class_id IS DISTINCT FROM p_target_class_id;

  SELECT count(*) INTO v_current_count
  FROM public.students
  WHERE class_id = p_target_class_id AND is_active = true;

  IF v_assign_count > 0 AND v_current_count + v_assign_count > v_target_capacity THEN
    RAISE EXCEPTION 'Assignment would exceed the target class capacity';
  END IF;

  PERFORM set_config('app.promotion_effective_date', p_effective_date::text, true);

  UPDATE public.students AS student
  SET
    class_id = p_target_class_id,
    class_group = v_target_group,
    group_fourth_option_id = CASE
      WHEN student.class_group = v_target_group THEN student.group_fourth_option_id
      ELSE NULL
    END,
    humanities_main_option_1_id = CASE
      WHEN student.class_group = v_target_group THEN student.humanities_main_option_1_id
      ELSE NULL
    END,
    humanities_main_option_2_id = CASE
      WHEN student.class_group = v_target_group THEN student.humanities_main_option_2_id
      ELSE NULL
    END,
    humanities_main_option_3_id = CASE
      WHEN student.class_group = v_target_group THEN student.humanities_main_option_3_id
      ELSE NULL
    END,
    humanities_fourth_option_id = CASE
      WHEN student.class_group = v_target_group THEN student.humanities_fourth_option_id
      ELSE NULL
    END
  WHERE student.id = ANY(p_student_ids)
    AND student.is_active = true
    AND student.class_id IS DISTINCT FROM p_target_class_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_students_to_class(uuid[], uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_students_to_class(uuid[], uuid, date) TO authenticated;

COMMENT ON FUNCTION public.assign_students_to_class(uuid[], uuid, date) IS
  'Bulk assigns students to an active class, preserving enrollment history and compatible subject choices.';