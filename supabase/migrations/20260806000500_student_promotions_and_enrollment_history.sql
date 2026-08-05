/* Backward-compatible academic enrollment history and admin-driven promotions. */

CREATE TABLE IF NOT EXISTS public.student_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  roll_number integer,
  started_on date NOT NULL,
  ended_on date,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'promoted', 'transferred', 'withdrawn')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_enrollments_dates_check CHECK (ended_on IS NULL OR ended_on >= started_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS student_enrollments_one_active_idx
  ON public.student_enrollments (student_id) WHERE ended_on IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS student_enrollments_assignment_idx
  ON public.student_enrollments (student_id, class_id, started_on);
CREATE INDEX IF NOT EXISTS student_enrollments_class_dates_idx
  ON public.student_enrollments (class_id, started_on, ended_on);
CREATE INDEX IF NOT EXISTS student_enrollments_year_student_idx
  ON public.student_enrollments (academic_year_id, student_id);

DROP TRIGGER IF EXISTS student_enrollments_updated_at ON public.student_enrollments;
CREATE TRIGGER student_enrollments_updated_at
  BEFORE UPDATE ON public.student_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.student_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and owners view enrollment history" ON public.student_enrollments;
CREATE POLICY "Admins and owners view enrollment history" ON public.student_enrollments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.students
      WHERE id = student_enrollments.student_id AND profile_id = auth.uid()
    )
  );

/* Recover prior class membership from existing attendance without rewriting attendance. */
INSERT INTO public.student_enrollments (
  student_id, academic_year_id, class_id, roll_number,
  started_on, ended_on, status
)
SELECT
  record.student_id,
  class.academic_year_id,
  class.id,
  student.roll_number,
  GREATEST(year.start_date, min(session.date)),
  LEAST(year.end_date, max(session.date)),
  'promoted'
FROM public.attendance_records AS record
JOIN public.attendance_sessions AS session ON session.id = record.session_id
JOIN public.classes AS class ON class.id = session.class_id
JOIN public.academic_years AS year ON year.id = class.academic_year_id
JOIN public.students AS student ON student.id = record.student_id
WHERE student.class_id IS DISTINCT FROM class.id
GROUP BY record.student_id, class.academic_year_id, class.id,
         student.roll_number, year.start_date, year.end_date
ON CONFLICT DO NOTHING;

/* Seed the current assignment without changing students.class_id or existing behavior. */
INSERT INTO public.student_enrollments (
  student_id, academic_year_id, class_id, roll_number, started_on, status
)
SELECT
  student.id,
  class.academic_year_id,
  class.id,
  student.roll_number,
  year.start_date,
  'active'
FROM public.students AS student
JOIN public.classes AS class ON class.id = student.class_id
JOIN public.academic_years AS year ON year.id = class.academic_year_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.student_enrollments enrollment
  WHERE enrollment.student_id = student.id AND enrollment.ended_on IS NULL
)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_student_current_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year_id uuid;
  v_old_year_id uuid;
  v_year_start date;
  v_effective_date date := COALESCE(
    NULLIF(current_setting('app.promotion_effective_date', true), '')::date,
    current_date
  );
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.class_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.class_id IS NOT NULL THEN
      UPDATE public.student_enrollments
      SET ended_on = GREATEST(started_on, v_effective_date - 1),
          status = 'withdrawn'
      WHERE student_id = NEW.id AND ended_on IS NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.class_id IS NOT DISTINCT FROM OLD.class_id THEN
    UPDATE public.student_enrollments
    SET roll_number = NEW.roll_number
    WHERE student_id = NEW.id AND ended_on IS NULL;
    RETURN NEW;
  END IF;

  SELECT class.academic_year_id, year.start_date
  INTO v_year_id, v_year_start
  FROM public.classes AS class
  JOIN public.academic_years AS year ON year.id = class.academic_year_id
  WHERE class.id = NEW.class_id;

  /* Legacy classes without an academic year keep working, but cannot create history. */
  IF v_year_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT academic_year_id INTO v_old_year_id
    FROM public.classes
    WHERE id = OLD.class_id;

    DELETE FROM public.student_enrollments
    WHERE student_id = NEW.id AND ended_on IS NULL AND started_on >= v_effective_date;

    UPDATE public.student_enrollments
    SET ended_on = v_effective_date - 1,
        status = CASE WHEN v_old_year_id = v_year_id THEN 'transferred' ELSE 'promoted' END
    WHERE student_id = NEW.id AND ended_on IS NULL;
  END IF;

  INSERT INTO public.student_enrollments (
    student_id, academic_year_id, class_id, roll_number, started_on, status, created_by
  ) VALUES (
    NEW.id, v_year_id, NEW.class_id, NEW.roll_number,
    GREATEST(v_effective_date, v_year_start), 'active', v_actor
  )
  ON CONFLICT (student_id, class_id, started_on) DO UPDATE
  SET roll_number = EXCLUDED.roll_number,
      ended_on = NULL,
      status = 'active';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_student_current_enrollment ON public.students;
CREATE TRIGGER sync_student_current_enrollment
  AFTER INSERT OR UPDATE OF class_id, roll_number ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.sync_student_current_enrollment();

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

  SELECT year.id, year.start_date, year.end_date, class.capacity
  INTO v_target_year_id, v_target_year_start, v_target_year_end, v_target_capacity
  FROM public.classes AS class
  JOIN public.academic_years AS year ON year.id = class.academic_year_id
  WHERE class.id = p_target_class_id AND class.is_active = true
  FOR UPDATE OF class;

  IF v_target_year_id IS NULL THEN
    RAISE EXCEPTION 'Target class must belong to an academic year';
  END IF;

  PERFORM 1
  FROM public.students
  WHERE id = ANY(p_student_ids)
  FOR UPDATE;

  IF p_effective_date < v_target_year_start OR p_effective_date > v_target_year_end THEN
    RAISE EXCEPTION 'Promotion date must fall within the target academic year';
  END IF;

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
        OR source_year.start_date >= v_target_year_start
      )
  ) THEN
    RAISE EXCEPTION 'Each student must have a current class in an earlier academic year';
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
  RETURN v_updated;
END;
$$;

/* Historical rosters use enrollment dates, with attendance as a legacy fallback. */
CREATE OR REPLACE FUNCTION public.get_class_students_for_period(
  p_class_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  admission_number text,
  class_id uuid,
  roll_number integer,
  first_name text,
  last_name text,
  photo_url text,
  is_active boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (student.id)
    student.id,
    student.profile_id,
    student.admission_number,
    student.class_id,
    COALESCE(enrollment.roll_number, student.roll_number),
    student.first_name,
    student.last_name,
    student.photo_url,
    student.is_active
  FROM public.students AS student
  LEFT JOIN public.student_enrollments AS enrollment
    ON enrollment.student_id = student.id
    AND enrollment.class_id = p_class_id
    AND enrollment.started_on <= p_end_date
    AND (enrollment.ended_on IS NULL OR enrollment.ended_on >= p_start_date)
  WHERE enrollment.id IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM public.attendance_records AS record
      JOIN public.attendance_sessions AS session ON session.id = record.session_id
      WHERE record.student_id = student.id
        AND session.class_id = p_class_id
        AND session.date BETWEEN p_start_date AND p_end_date
    )
  ORDER BY student.id, enrollment.started_on DESC NULLS LAST;
$$;

REVOKE ALL ON public.student_enrollments FROM authenticated;
GRANT SELECT ON public.student_enrollments TO authenticated;
GRANT ALL ON public.student_enrollments TO service_role;
REVOKE ALL ON FUNCTION public.promote_students(uuid[], uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_students(uuid[], uuid, date) TO authenticated;
REVOKE ALL ON FUNCTION public.get_class_students_for_period(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_class_students_for_period(uuid, date, date) TO authenticated;

COMMENT ON TABLE public.student_enrollments IS
  'Date-ranged class enrollment history. students.class_id remains the current assignment.';
COMMENT ON FUNCTION public.promote_students(uuid[], uuid, date) IS
  'Atomically promotes selected active students while the enrollment trigger archives prior assignments.';
