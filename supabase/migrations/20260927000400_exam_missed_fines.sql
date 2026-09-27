/* Add a configurable exam-missed fine and calculate fines against class-scoped exam dates. */

ALTER TABLE public.attendance_fine_settings
  ADD COLUMN exam_missed_fine numeric(10, 2) NOT NULL DEFAULT 0
    CHECK (exam_missed_fine >= 0);

COMMENT ON COLUMN public.attendance_fine_settings.exam_missed_fine IS
  'Fine charged when an absent or too-late attendance day matches an exam scheduled for the student class.';

CREATE OR REPLACE FUNCTION public.get_student_attendance_fine_details(
  p_student_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.students
       WHERE id = p_student_id AND profile_id = auth.uid()
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND is_active = true
         AND (
           role IN ('admin', 'teacher')
           OR (role = 'sub_admin' AND public.has_permission('reports', 'read'))
         )
     ) THEN
    RAISE EXCEPTION 'Access to this student is not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL AND p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Start date must not be after end date';
  END IF;

  WITH attendance_days AS (
    SELECT
      session.date,
      session.class_id,
      bool_or(record.status IN ('absent', 'too_late')) AS is_absent,
      bool_or(record.status = 'late') AS is_late
    FROM public.attendance_records AS record
    JOIN public.attendance_sessions AS session ON session.id = record.session_id
    WHERE record.student_id = p_student_id
      AND (p_start_date IS NULL OR session.date >= p_start_date)
      AND (p_end_date IS NULL OR session.date <= p_end_date)
    GROUP BY session.date, session.class_id
  ),
  schedule_days AS (
    SELECT
      exam.class_id,
      schedule.exam_date,
      true AS has_exam,
      bool_or(schedule.has_regular_classes) AS has_exam_with_classes
    FROM public.result_exam_schedules AS schedule
    JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
    JOIN public.result_exams AS exam ON exam.id = link.exam_id
    GROUP BY exam.class_id, schedule.exam_date
  ),
  counts AS (
    SELECT
      count(*) FILTER (
        WHERE day.is_absent
          AND (NOT coalesce(schedule.has_exam, false) OR schedule.has_exam_with_classes)
      )::integer AS recorded_absences,
      count(*) FILTER (
        WHERE day.is_late
          AND (NOT coalesce(schedule.has_exam, false) OR schedule.has_exam_with_classes)
      )::integer AS late_days,
      count(*) FILTER (
        WHERE day.is_absent AND coalesce(schedule.has_exam, false)
      )::integer AS exam_missed_count
    FROM attendance_days AS day
    LEFT JOIN schedule_days AS schedule
      ON schedule.class_id = day.class_id AND schedule.exam_date = day.date
  ),
  configured AS (
    SELECT fine_per_absent_day, exam_missed_fine
    FROM public.attendance_fine_settings
    WHERE id = true
  )
  SELECT jsonb_build_object(
    'recordedAbsences', counts.recorded_absences,
    'lateDays', counts.late_days,
    'latePenaltyAbsences', floor(counts.late_days / 2.0)::integer,
    'fineableAbsences', counts.recorded_absences + floor(counts.late_days / 2.0)::integer,
    'finePerAbsentDay', coalesce(configured.fine_per_absent_day, 0),
    'attendanceFine', (counts.recorded_absences + floor(counts.late_days / 2.0)::integer) * coalesce(configured.fine_per_absent_day, 0),
    'examMissedCount', counts.exam_missed_count,
    'examMissedFineAmount', coalesce(configured.exam_missed_fine, 0),
    'examMissedFine', counts.exam_missed_count * coalesce(configured.exam_missed_fine, 0),
    'totalFine',
      (counts.recorded_absences + floor(counts.late_days / 2.0)::integer) * coalesce(configured.fine_per_absent_day, 0)
      + counts.exam_missed_count * coalesce(configured.exam_missed_fine, 0)
  ) INTO v_result
  FROM counts
  LEFT JOIN configured ON true;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_attendance_fine_details(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_attendance_fine_details(uuid, date, date)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_class_attendance_fine_details(
  p_class_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  student_id uuid,
  recorded_absences integer,
  late_days integer,
  late_penalty_absences integer,
  fineable_absences integer,
  exam_missed_count integer,
  fine_per_absent_day numeric,
  exam_missed_fine_amount numeric,
  attendance_fine numeric,
  exam_missed_fine numeric,
  total_fine numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND is_active = true
         AND (
           role IN ('admin', 'teacher')
           OR (role = 'sub_admin' AND public.has_permission('reports', 'read'))
         )
     ) THEN
    RAISE EXCEPTION 'Access to attendance fine reports is not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'A valid date range is required';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT student.id
    FROM public.get_class_students_for_period(p_class_id, p_start_date, p_end_date) AS student
  ),
  attendance_days AS (
    SELECT
      record.student_id,
      session.date,
      bool_or(record.status IN ('absent', 'too_late')) AS is_absent,
      bool_or(record.status = 'late') AS is_late
    FROM public.attendance_records AS record
    JOIN public.attendance_sessions AS session ON session.id = record.session_id
    WHERE session.class_id = p_class_id
      AND session.date BETWEEN p_start_date AND p_end_date
    GROUP BY record.student_id, session.date
  ),
  schedule_days AS (
    SELECT
      schedule.exam_date,
      true AS has_exam,
      bool_or(schedule.has_regular_classes) AS has_exam_with_classes
    FROM public.result_exam_schedules AS schedule
    JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
    JOIN public.result_exams AS exam ON exam.id = link.exam_id
    WHERE exam.class_id = p_class_id
      AND schedule.exam_date BETWEEN p_start_date AND p_end_date
    GROUP BY schedule.exam_date
  ),
  counts AS (
    SELECT
      roster.id AS student_id,
      count(*) FILTER (
        WHERE day.is_absent
          AND (NOT coalesce(schedule.has_exam, false) OR schedule.has_exam_with_classes)
      )::integer AS recorded_absences,
      count(*) FILTER (
        WHERE day.is_late
          AND (NOT coalesce(schedule.has_exam, false) OR schedule.has_exam_with_classes)
      )::integer AS late_days,
      count(*) FILTER (
        WHERE day.is_absent AND coalesce(schedule.has_exam, false)
      )::integer AS exam_missed_count
    FROM roster
    LEFT JOIN attendance_days AS day ON day.student_id = roster.id
    LEFT JOIN schedule_days AS schedule ON schedule.exam_date = day.date
    GROUP BY roster.id
  ),
  configured AS (
    SELECT setting.fine_per_absent_day, setting.exam_missed_fine
    FROM public.attendance_fine_settings AS setting
    WHERE setting.id = true
  )
  SELECT
    counts.student_id,
    counts.recorded_absences,
    counts.late_days,
    floor(counts.late_days / 2.0)::integer,
    counts.recorded_absences + floor(counts.late_days / 2.0)::integer,
    counts.exam_missed_count,
    coalesce(configured.fine_per_absent_day, 0),
    coalesce(configured.exam_missed_fine, 0),
    (counts.recorded_absences + floor(counts.late_days / 2.0)::integer) * coalesce(configured.fine_per_absent_day, 0),
    counts.exam_missed_count * coalesce(configured.exam_missed_fine, 0),
    (counts.recorded_absences + floor(counts.late_days / 2.0)::integer) * coalesce(configured.fine_per_absent_day, 0)
      + counts.exam_missed_count * coalesce(configured.exam_missed_fine, 0)
  FROM counts
  LEFT JOIN configured ON true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_class_attendance_fine_details(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_class_attendance_fine_details(uuid, date, date)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_student_attendance_fine_details(uuid, date, date) IS
  'Calculates normal and exam-missed fines. Exam-only days suppress the normal attendance fine.';
COMMENT ON FUNCTION public.get_class_attendance_fine_details(uuid, date, date) IS
  'Returns date-aware normal and exam-missed fines for a class report.';
