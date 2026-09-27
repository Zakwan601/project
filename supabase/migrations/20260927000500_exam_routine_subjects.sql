/* Turn examination dates into subject-labelled routine entries. */

ALTER TABLE public.result_exam_schedules
  ADD COLUMN subject_name text NOT NULL DEFAULT 'Examination'
    CHECK (btrim(subject_name) <> '');

CREATE OR REPLACE FUNCTION public.create_result_exam_routine_entry(
  p_exam_ids uuid[],
  p_subject_name text,
  p_exam_date date,
  p_exam_time time without time zone DEFAULT NULL,
  p_has_regular_classes boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_schedule_id uuid;
BEGIN
  IF nullif(btrim(p_subject_name), '') IS NULL THEN
    RAISE EXCEPTION 'Subject or paper name is required';
  END IF;

  v_schedule_id := public.create_result_exam_schedule(
    p_exam_ids,
    p_exam_date,
    p_exam_time,
    p_has_regular_classes
  );

  UPDATE public.result_exam_schedules
  SET subject_name = btrim(p_subject_name)
  WHERE id = v_schedule_id;

  RETURN v_schedule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_result_exam_routine_entry(uuid[], text, date, time without time zone, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_result_exam_routine_entry(uuid[], text, date, time without time zone, boolean)
  TO authenticated;

COMMENT ON COLUMN public.result_exam_schedules.subject_name IS
  'Subject or paper shown on this row of the examination routine.';
COMMENT ON FUNCTION public.create_result_exam_routine_entry(uuid[], text, date, time without time zone, boolean) IS
  'Adds one subject/date row to an examination routine for the selected class exams.';
