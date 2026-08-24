/* Allow overlapping two-year academic sessions and same-session promotion. */

DROP INDEX IF EXISTS public.academic_years_one_current_idx;

COMMENT ON COLUMN public.academic_years.is_current IS
  'Backward-compatible active-session flag. Multiple overlapping academic sessions may be active.';

CREATE OR REPLACE FUNCTION public.set_academic_year_active(
  p_academic_year_id uuid,
  p_is_active boolean
)
RETURNS public.academic_years
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year public.academic_years;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active administrators can change academic session status';
  END IF;

  UPDATE public.academic_years
  SET is_current = p_is_active
  WHERE id = p_academic_year_id
  RETURNING * INTO v_year;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Academic session not found';
  END IF;

  RETURN v_year;
END;
$$;

REVOKE ALL ON FUNCTION public.set_academic_year_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_academic_year_active(uuid, boolean) TO authenticated;

/* Keep older clients safe without deactivating another overlapping session. */
CREATE OR REPLACE FUNCTION public.set_current_academic_year(p_academic_year_id uuid)
RETURNS public.academic_years
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year public.academic_years;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active administrators can change academic session status';
  END IF;

  UPDATE public.academic_years
  SET is_current = true
  WHERE id = p_academic_year_id
  RETURNING * INTO v_year;

  IF v_year.id IS NULL THEN
    RAISE EXCEPTION 'Academic session not found';
  END IF;

  RETURN v_year;
END;
$$;

COMMENT ON FUNCTION public.set_current_academic_year(uuid) IS
  'Backward-compatible helper that activates one session without deactivating overlapping sessions.';

CREATE OR REPLACE FUNCTION public.promote_students(
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
  v_target_year_id uuid;
  v_target_year_start date;
  v_target_year_end date;
  v_target_grade_number integer;
  v_target_capacity integer;
  v_current_count integer;
  v_promote_count integer;
  v_updated integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active administrators can promote students';
  END IF;

  IF COALESCE(array_length(p_student_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Select at least one student';
  END IF;

  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'Promotion date is required';
  END IF;

  SELECT
    year.id,
    year.start_date,
    year.end_date,
    NULLIF(regexp_replace(class.grade, '[^0-9]', '', 'g'), '')::integer,
    class.capacity
  INTO
    v_target_year_id,
    v_target_year_start,
    v_target_year_end,
    v_target_grade_number,
    v_target_capacity
  FROM public.classes AS class
  JOIN public.academic_years AS year ON year.id = class.academic_year_id
  WHERE class.id = p_target_class_id AND class.is_active = true
  FOR UPDATE OF class;

  IF v_target_year_id IS NULL THEN
    RAISE EXCEPTION 'Target class must belong to an academic session';
  END IF;

  PERFORM 1
  FROM public.students
  WHERE id = ANY(p_student_ids)
  FOR UPDATE;

  IF p_effective_date < v_target_year_start OR p_effective_date > v_target_year_end THEN
    RAISE EXCEPTION 'Promotion date must fall within the target academic session';
  END IF;

  /* A cohort may advance to a higher numeric grade without changing its session. */
  IF EXISTS (
    SELECT 1
    FROM public.students AS student
    LEFT JOIN public.classes AS source_class ON source_class.id = student.class_id
    LEFT JOIN public.academic_years AS source_year ON source_year.id = source_class.academic_year_id
    WHERE student.id = ANY(p_student_ids)
      AND (
        student.class_id IS NULL
        OR student.class_id = p_target_class_id
        OR source_year.id IS NULL
        OR NOT (
          source_year.start_date < v_target_year_start
          OR (
            source_year.id = v_target_year_id
            AND v_target_grade_number IS NOT NULL
            AND COALESCE(
              NULLIF(regexp_replace(source_class.grade, '[^0-9]', '', 'g'), '')::integer
                < v_target_grade_number,
              false
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Target class must be in a later session or a higher grade in the same session';
  END IF;

  SELECT count(*) INTO v_promote_count
  FROM public.students
  WHERE id = ANY(p_student_ids) AND is_active = true;

  IF v_promote_count <> array_length(p_student_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected students are missing or inactive';
  END IF;

  SELECT count(*) INTO v_current_count
  FROM public.students
  WHERE class_id = p_target_class_id AND is_active = true;

  IF v_current_count + v_promote_count > v_target_capacity THEN
    RAISE EXCEPTION 'Promotion would exceed the target class capacity';
  END IF;

  PERFORM set_config('app.promotion_effective_date', p_effective_date::text, true);

  UPDATE public.students
  SET class_id = p_target_class_id
  WHERE id = ANY(p_student_ids) AND is_active = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  /* The enrollment trigger calls same-session moves transfers; this RPC is explicitly a promotion. */
  UPDATE public.student_enrollments
  SET status = 'promoted'
  WHERE student_id = ANY(p_student_ids)
    AND academic_year_id = v_target_year_id
    AND ended_on = p_effective_date - 1
    AND status = 'transferred';

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_students(uuid[], uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_students(uuid[], uuid, date) TO authenticated;

COMMENT ON FUNCTION public.promote_students(uuid[], uuid, date) IS
  'Promotes students to a later session or a higher grade while preserving a cohort session.';
