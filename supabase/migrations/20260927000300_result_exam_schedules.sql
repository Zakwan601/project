/* Class-scoped examination dates linked to result examination groups. */

CREATE TABLE public.result_exam_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_group_id uuid NOT NULL,
  exam_date date NOT NULL,
  exam_time time without time zone,
  has_regular_classes boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT result_exam_schedules_exam_only_time_check CHECK (has_regular_classes OR exam_time IS NOT NULL)
);

CREATE TABLE public.result_exam_schedule_classes (
  schedule_id uuid NOT NULL REFERENCES public.result_exam_schedules(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.result_exams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_id, exam_id)
);

CREATE INDEX result_exam_schedules_date_idx ON public.result_exam_schedules (exam_date, exam_group_id);
CREATE INDEX result_exam_schedule_classes_exam_idx ON public.result_exam_schedule_classes (exam_id, schedule_id);

CREATE TRIGGER result_exam_schedules_updated_at
  BEFORE UPDATE ON public.result_exam_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_result_exam_schedule_class()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.result_exam_schedules%ROWTYPE;
  v_exam public.result_exams%ROWTYPE;
BEGIN
  SELECT * INTO v_schedule FROM public.result_exam_schedules WHERE id = NEW.schedule_id;
  SELECT * INTO v_exam FROM public.result_exams WHERE id = NEW.exam_id;
  IF v_schedule.exam_group_id IS DISTINCT FROM v_exam.exam_group_id THEN
    RAISE EXCEPTION 'The selected class exam belongs to a different examination';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.result_exam_schedule_classes AS link
    JOIN public.result_exam_schedules AS schedule ON schedule.id = link.schedule_id
    WHERE link.exam_id = NEW.exam_id AND schedule.exam_date = v_schedule.exam_date
      AND link.schedule_id <> NEW.schedule_id
  ) THEN
    RAISE EXCEPTION 'This class already has an exam scheduled on that date';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER result_exam_schedule_classes_validate
  BEFORE INSERT OR UPDATE ON public.result_exam_schedule_classes
  FOR EACH ROW EXECUTE FUNCTION public.validate_result_exam_schedule_class();

ALTER TABLE public.result_exam_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_exam_schedule_classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY result_exam_schedules_read ON public.result_exam_schedules
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.result_exam_schedule_classes AS link
      WHERE link.schedule_id = result_exam_schedules.id
        AND public.can_view_result_exam(link.exam_id)
    )
  );
CREATE POLICY result_exam_schedules_staff_insert ON public.result_exam_schedules
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('results', 'write'));
CREATE POLICY result_exam_schedules_staff_update ON public.result_exam_schedules
  FOR UPDATE TO authenticated USING (public.has_permission('results', 'write'))
  WITH CHECK (public.has_permission('results', 'write'));
CREATE POLICY result_exam_schedules_staff_delete ON public.result_exam_schedules
  FOR DELETE TO authenticated USING (public.has_permission('results', 'write'));
CREATE POLICY result_exam_schedule_classes_read ON public.result_exam_schedule_classes
  FOR SELECT TO authenticated USING (public.can_view_result_exam(exam_id));
CREATE POLICY result_exam_schedule_classes_staff_insert ON public.result_exam_schedule_classes
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('results', 'write'));
CREATE POLICY result_exam_schedule_classes_staff_update ON public.result_exam_schedule_classes
  FOR UPDATE TO authenticated USING (public.has_permission('results', 'write'))
  WITH CHECK (public.has_permission('results', 'write'));
CREATE POLICY result_exam_schedule_classes_staff_delete ON public.result_exam_schedule_classes
  FOR DELETE TO authenticated USING (public.has_permission('results', 'write'));

CREATE OR REPLACE FUNCTION public.create_result_exam_schedule(
  p_exam_ids uuid[],
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
  v_group_id uuid;
  v_requested_count integer;
  v_exam_count integer;
  v_group_count integer;
BEGIN
  IF NOT public.has_permission('results', 'write') THEN
    RAISE EXCEPTION 'You do not have permission to schedule examinations';
  END IF;
  SELECT count(DISTINCT requested.id) INTO v_requested_count
  FROM unnest(coalesce(p_exam_ids, ARRAY[]::uuid[])) AS requested(id);
  IF v_requested_count = 0 THEN RAISE EXCEPTION 'Select at least one class'; END IF;
  IF p_exam_date IS NULL THEN RAISE EXCEPTION 'Exam date is required'; END IF;
  IF NOT coalesce(p_has_regular_classes, true) AND p_exam_time IS NULL THEN
    RAISE EXCEPTION 'Exam time is required when there are no regular classes';
  END IF;

  SELECT count(*), count(DISTINCT exam.exam_group_id), min(exam.exam_group_id::text)::uuid
  INTO v_exam_count, v_group_count, v_group_id
  FROM public.result_exams AS exam
  WHERE exam.id IN (SELECT DISTINCT requested.id FROM unnest(p_exam_ids) AS requested(id));
  IF v_exam_count <> v_requested_count THEN
    RAISE EXCEPTION 'One or more selected class examinations are unavailable';
  END IF;
  IF v_group_count <> 1 THEN
    RAISE EXCEPTION 'All selected classes must belong to the same examination';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.result_exams AS exam
    JOIN public.academic_years AS year ON year.id = exam.academic_year_id
    WHERE exam.id IN (SELECT DISTINCT requested.id FROM unnest(p_exam_ids) AS requested(id))
      AND (p_exam_date < year.start_date OR p_exam_date > year.end_date)
  ) THEN
    RAISE EXCEPTION 'Exam date must be inside every selected class session';
  END IF;

  INSERT INTO public.result_exam_schedules (
    exam_group_id, exam_date, exam_time, has_regular_classes, created_by
  ) VALUES (
    v_group_id, p_exam_date, p_exam_time, coalesce(p_has_regular_classes, true), auth.uid()
  ) RETURNING id INTO v_schedule_id;
  INSERT INTO public.result_exam_schedule_classes (schedule_id, exam_id)
  SELECT v_schedule_id, requested.id
  FROM (SELECT DISTINCT id FROM unnest(p_exam_ids) AS selected(id)) AS requested;
  RETURN v_schedule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_result_exam_schedule(uuid[], date, time without time zone, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_result_exam_schedule(uuid[], date, time without time zone, boolean) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.result_exam_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.result_exam_schedule_classes TO authenticated;

COMMENT ON TABLE public.result_exam_schedules IS
  'Exam calendar dates linked to result examination groups. Attendance rules can later use has_regular_classes and exam_time.';
COMMENT ON COLUMN public.result_exam_schedules.has_regular_classes IS
  'True when normal classes also run that day; false for an exam-only day, when exam_time is required.';
