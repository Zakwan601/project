/* Calculate exam-missed fines from examination routine dates and absent results. */

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
  routine_days AS (
    SELECT
      exam.class_id,
      schedule.exam_group_id,
      schedule.exam_date,
      bool_or(exam.has_regular_classes) AS has_regular_classes
    FROM public.result_exam_schedules AS schedule
    JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
    JOIN public.result_exams AS exam ON exam.id = link.exam_id
    WHERE (p_start_date IS NULL OR schedule.exam_date >= p_start_date)
      AND (p_end_date IS NULL OR schedule.exam_date <= p_end_date)
    GROUP BY exam.class_id, schedule.exam_group_id, schedule.exam_date
  ),
  routine_date_modes AS (
    SELECT
      class_id,
      exam_date,
      bool_or(has_regular_classes) AS has_regular_classes
    FROM routine_days
    GROUP BY class_id, exam_date
  ),
  attendance_counts AS (
    SELECT
      count(*) FILTER (
        WHERE day.is_absent
          AND (routine.exam_date IS NULL OR routine.has_regular_classes)
      )::integer AS recorded_absences,
      count(*) FILTER (
        WHERE day.is_late
          AND (routine.exam_date IS NULL OR routine.has_regular_classes)
      )::integer AS late_days
    FROM attendance_days AS day
    LEFT JOIN routine_date_modes AS routine
      ON routine.class_id = day.class_id AND routine.exam_date = day.date
  ),
  missed_exam_days AS (
    /* An explicit absent/too-late attendance status misses every exam for that class/date. */
    SELECT DISTINCT
      p_student_id AS student_id,
      routine.class_id,
      routine.exam_group_id,
      routine.exam_date
    FROM attendance_days AS day
    JOIN routine_days AS routine
      ON routine.class_id = day.class_id AND routine.exam_date = day.date
    WHERE day.is_absent

    UNION

    /* Result entry absence also works when an exam-only date has no attendance session. */
    SELECT DISTINCT
      mark.student_id,
      exam.class_id,
      schedule.exam_group_id,
      schedule.exam_date
    FROM public.result_marks AS mark
    JOIN public.result_exam_subjects AS exam_subject ON exam_subject.id = mark.exam_subject_id
    JOIN public.result_exams AS exam ON exam.id = exam_subject.exam_id
    JOIN public.result_exam_schedule_classes AS link ON link.exam_id = exam.id
    JOIN public.result_exam_schedules AS schedule
      ON schedule.id = link.schedule_id
     AND schedule.subject_id = exam_subject.subject_id
    WHERE mark.student_id = p_student_id
      AND mark.is_absent = true
      AND (p_start_date IS NULL OR schedule.exam_date >= p_start_date)
      AND (p_end_date IS NULL OR schedule.exam_date <= p_end_date)
  ),
  exam_counts AS (
    SELECT count(*)::integer AS exam_missed_count
    FROM missed_exam_days
  ),
  configured AS (
    SELECT fine_per_absent_day, exam_missed_fine
    FROM public.attendance_fine_settings
    WHERE id = true
  )
  SELECT jsonb_build_object(
    'recordedAbsences', attendance.recorded_absences,
    'lateDays', attendance.late_days,
    'latePenaltyAbsences', floor(attendance.late_days / 2.0)::integer,
    'fineableAbsences', attendance.recorded_absences + floor(attendance.late_days / 2.0)::integer,
    'finePerAbsentDay', coalesce(configured.fine_per_absent_day, 0),
    'attendanceFine', (attendance.recorded_absences + floor(attendance.late_days / 2.0)::integer) * coalesce(configured.fine_per_absent_day, 0),
    'examMissedCount', exams.exam_missed_count,
    'examMissedFineAmount', coalesce(configured.exam_missed_fine, 0),
    'examMissedFine', exams.exam_missed_count * coalesce(configured.exam_missed_fine, 0),
    'totalFine',
      (attendance.recorded_absences + floor(attendance.late_days / 2.0)::integer) * coalesce(configured.fine_per_absent_day, 0)
      + exams.exam_missed_count * coalesce(configured.exam_missed_fine, 0)
  ) INTO v_result
  FROM attendance_counts AS attendance
  CROSS JOIN exam_counts AS exams
  LEFT JOIN configured ON true;

  RETURN v_result;
END;
$$;

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
  routine_days AS (
    SELECT
      schedule.exam_group_id,
      schedule.exam_date,
      bool_or(exam.has_regular_classes) AS has_regular_classes
    FROM public.result_exam_schedules AS schedule
    JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
    JOIN public.result_exams AS exam ON exam.id = link.exam_id
    WHERE exam.class_id = p_class_id
      AND schedule.exam_date BETWEEN p_start_date AND p_end_date
    GROUP BY schedule.exam_group_id, schedule.exam_date
  ),
  routine_date_modes AS (
    SELECT exam_date, bool_or(has_regular_classes) AS has_regular_classes
    FROM routine_days
    GROUP BY exam_date
  ),
  attendance_counts AS (
    SELECT
      roster.id AS student_id,
      count(*) FILTER (
        WHERE day.is_absent
          AND (routine.exam_date IS NULL OR routine.has_regular_classes)
      )::integer AS recorded_absences,
      count(*) FILTER (
        WHERE day.is_late
          AND (routine.exam_date IS NULL OR routine.has_regular_classes)
      )::integer AS late_days
    FROM roster
    LEFT JOIN attendance_days AS day ON day.student_id = roster.id
    LEFT JOIN routine_date_modes AS routine ON routine.exam_date = day.date
    GROUP BY roster.id
  ),
  missed_exam_days AS (
    SELECT DISTINCT
      day.student_id,
      routine.exam_group_id,
      routine.exam_date
    FROM attendance_days AS day
    JOIN routine_days AS routine ON routine.exam_date = day.date
    WHERE day.is_absent

    UNION

    SELECT DISTINCT
      mark.student_id,
      schedule.exam_group_id,
      schedule.exam_date
    FROM public.result_marks AS mark
    JOIN public.result_exam_subjects AS exam_subject ON exam_subject.id = mark.exam_subject_id
    JOIN public.result_exams AS exam ON exam.id = exam_subject.exam_id
    JOIN public.result_exam_schedule_classes AS link ON link.exam_id = exam.id
    JOIN public.result_exam_schedules AS schedule
      ON schedule.id = link.schedule_id
     AND schedule.subject_id = exam_subject.subject_id
    WHERE exam.class_id = p_class_id
      AND mark.is_absent = true
      AND schedule.exam_date BETWEEN p_start_date AND p_end_date
  ),
  exam_counts AS (
    SELECT roster.id AS student_id, count(missed.exam_date)::integer AS exam_missed_count
    FROM roster
    LEFT JOIN missed_exam_days AS missed ON missed.student_id = roster.id
    GROUP BY roster.id
  ),
  configured AS (
    SELECT setting.fine_per_absent_day, setting.exam_missed_fine
    FROM public.attendance_fine_settings AS setting
    WHERE setting.id = true
  )
  SELECT
    attendance.student_id,
    attendance.recorded_absences,
    attendance.late_days,
    floor(attendance.late_days / 2.0)::integer,
    attendance.recorded_absences + floor(attendance.late_days / 2.0)::integer,
    exams.exam_missed_count,
    coalesce(configured.fine_per_absent_day, 0),
    coalesce(configured.exam_missed_fine, 0),
    (attendance.recorded_absences + floor(attendance.late_days / 2.0)::integer) * coalesce(configured.fine_per_absent_day, 0),
    exams.exam_missed_count * coalesce(configured.exam_missed_fine, 0),
    (attendance.recorded_absences + floor(attendance.late_days / 2.0)::integer) * coalesce(configured.fine_per_absent_day, 0)
      + exams.exam_missed_count * coalesce(configured.exam_missed_fine, 0)
  FROM attendance_counts AS attendance
  JOIN exam_counts AS exams ON exams.student_id = attendance.student_id
  LEFT JOIN configured ON true;
END;
$$;

COMMENT ON FUNCTION public.get_student_attendance_fine_details(uuid, date, date) IS
  'Calculates attendance and exam-missed fines from attendance plus subject-linked examination routine dates.';
COMMENT ON FUNCTION public.get_class_attendance_fine_details(uuid, date, date) IS
  'Returns routine-aware attendance and exam-missed fines for a class report.';
