/* Allow a vacation to apply to every class or only selected classes.

   NULL class_ids means all classes, preserving every existing holiday row.
   A non-empty array means only those classes are excluded from attendance.
*/

ALTER TABLE public.holidays
  ADD COLUMN IF NOT EXISTS class_ids uuid[];

ALTER TABLE public.holidays
  DROP CONSTRAINT IF EXISTS holidays_class_ids_not_empty;
ALTER TABLE public.holidays
  ADD CONSTRAINT holidays_class_ids_not_empty
  CHECK (class_ids IS NULL OR cardinality(class_ids) > 0);

CREATE INDEX IF NOT EXISTS holidays_class_ids_idx
  ON public.holidays USING gin (class_ids);

CREATE OR REPLACE FUNCTION public.prevent_non_school_day_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXTRACT(DOW FROM NEW.date)::integer IN (5, 6)
     OR EXISTS (
       SELECT 1
       FROM public.holidays AS holiday
       WHERE holiday.date = NEW.date
         AND (holiday.class_ids IS NULL OR NEW.class_id = ANY(holiday.class_ids))
     )
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_sessions_non_school_day_update
  ON public.attendance_sessions;
CREATE TRIGGER attendance_sessions_non_school_day_update
  BEFORE UPDATE OF date, class_id ON public.attendance_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_non_school_day_attendance();

CREATE OR REPLACE FUNCTION public.mark_attendance_vacation_range(
  p_start_date date,
  p_end_date date,
  p_name text,
  p_description text,
  p_class_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_ids uuid[];
  v_days_added integer := 0;
  v_existing_days integer := 0;
  v_weekend_days_skipped integer := 0;
  v_sessions_removed integer := 0;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_permission('vacations', 'write') THEN
    RAISE EXCEPTION 'Vacation write permission is required';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Vacation start and end dates are required';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Vacation end date must be on or after the start date';
  END IF;

  IF NULLIF(BTRIM(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Vacation name is required';
  END IF;

  IF p_class_ids IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT requested_id ORDER BY requested_id)
    INTO v_class_ids
    FROM UNNEST(p_class_ids) AS requested(requested_id);

    IF COALESCE(cardinality(v_class_ids), 0) = 0 THEN
      RAISE EXCEPTION 'Select at least one class or choose all classes';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM UNNEST(v_class_ids) AS requested(class_id)
      LEFT JOIN public.classes AS class ON class.id = requested.class_id
      WHERE class.id IS NULL OR class.is_active = false
    ) THEN
      RAISE EXCEPTION 'One or more selected classes are invalid or inactive';
    END IF;
  ELSE
    v_class_ids := NULL;
  END IF;

  SELECT COUNT(*)
  INTO v_weekend_days_skipped
  FROM generate_series(p_start_date, p_end_date, INTERVAL '1 day') AS dates(day)
  WHERE EXTRACT(DOW FROM day)::integer IN (5, 6);

  SELECT COUNT(*)
  INTO v_existing_days
  FROM generate_series(p_start_date, p_end_date, INTERVAL '1 day') AS dates(day)
  JOIN public.holidays AS holiday ON holiday.date = day::date
  WHERE EXTRACT(DOW FROM day)::integer NOT IN (5, 6)
    AND (
      holiday.class_ids IS NULL
      OR (v_class_ids IS NOT NULL AND holiday.class_ids @> v_class_ids)
    );

  SELECT COUNT(*)
  INTO v_days_added
  FROM generate_series(p_start_date, p_end_date, INTERVAL '1 day') AS dates(day)
  WHERE EXTRACT(DOW FROM day)::integer NOT IN (5, 6)
    AND NOT EXISTS (
      SELECT 1
      FROM public.holidays AS holiday
      WHERE holiday.date = day::date
        AND (
          holiday.class_ids IS NULL
          OR (v_class_ids IS NOT NULL AND holiday.class_ids @> v_class_ids)
        )
    );

  INSERT INTO public.holidays (date, name, description, class_ids, created_by)
  SELECT
    day::date,
    BTRIM(p_name),
    NULLIF(BTRIM(p_description), ''),
    v_class_ids,
    auth.uid()
  FROM generate_series(p_start_date, p_end_date, INTERVAL '1 day') AS dates(day)
  WHERE EXTRACT(DOW FROM day)::integer NOT IN (5, 6)
  ON CONFLICT (date) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      class_ids = CASE
        WHEN public.holidays.class_ids IS NULL OR EXCLUDED.class_ids IS NULL THEN NULL
        ELSE ARRAY(
          SELECT DISTINCT class_id
          FROM UNNEST(public.holidays.class_ids || EXCLUDED.class_ids) AS selected(class_id)
          ORDER BY class_id
        )
      END;

  IF v_days_added = 0 AND v_existing_days = 0 THEN
    RAISE EXCEPTION 'The selected range only contains Friday and Saturday weekend days';
  END IF;

  UPDATE public.device_logs AS log
  SET processed = false,
      attendance_record_id = NULL
  WHERE (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date
        BETWEEN p_start_date AND p_end_date
    AND (
      v_class_ids IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.students AS student
        WHERE student.admission_number = log.student_biometric_id
          AND student.class_id = ANY(v_class_ids)
      )
    );

  DELETE FROM public.attendance_sessions AS session
  WHERE session.date BETWEEN p_start_date AND p_end_date
    AND (v_class_ids IS NULL OR session.class_id = ANY(v_class_ids));

  GET DIAGNOSTICS v_sessions_removed = ROW_COUNT;

  RETURN jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'days_added', v_days_added,
    'existing_days', v_existing_days,
    'weekend_days_skipped', v_weekend_days_skipped,
    'sessions_removed', v_sessions_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_attendance_vacation_range(date, date, text, text, uuid[])
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_attendance_vacation_range(date, date, text, text, uuid[])
  TO authenticated;

COMMENT ON FUNCTION public.mark_attendance_vacation_range(date, date, text, text, uuid[]) IS
  'Marks working dates as vacations for all classes or selected classes and removes only affected attendance.';
