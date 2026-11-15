/* Store alternatives separately, with one displayed routine slot per date/time. */
BEGIN;

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
  SELECT * INTO v_exam FROM public.result_exams WHERE id = NEW.exam_id FOR UPDATE;
  IF v_schedule.exam_group_id IS DISTINCT FROM v_exam.exam_group_id THEN
    RAISE EXCEPTION 'The selected class exam belongs to a different examination';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.result_exam_schedule_classes AS link
    JOIN public.result_exam_schedules AS schedule ON schedule.id = link.schedule_id
    WHERE link.exam_id = NEW.exam_id AND schedule.exam_date = v_schedule.exam_date
      AND schedule.exam_time IS NOT DISTINCT FROM v_schedule.exam_time
      AND link.schedule_id <> NEW.schedule_id
      AND (
        schedule.subject_id IS NOT DISTINCT FROM v_schedule.subject_id
        OR (v_exam.combine_subject_papers AND EXISTS (
          SELECT 1 FROM public.result_subject_paper_groups AS paper_group
          WHERE paper_group.class_group = (SELECT class_group FROM public.classes WHERE id = v_exam.class_id)
            AND schedule.subject_id IN (paper_group.first_paper_subject_id, paper_group.second_paper_subject_id)
            AND v_schedule.subject_id IN (paper_group.first_paper_subject_id, paper_group.second_paper_subject_id)
        ))
      )
  ) THEN RAISE EXCEPTION 'This subject is already scheduled at that date and time'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_result_exam_routine_entries(
  p_exam_id uuid,
  p_subject_ids uuid[],
  p_exam_date date,
  p_exam_time time without time zone DEFAULT NULL
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam record;
  v_subject record;
  v_requested uuid[];
  v_seen uuid[] := ARRAY[]::uuid[];
  v_canonical uuid;
  v_name text;
  v_schedule_id uuid;
BEGIN
  IF NOT public.has_permission('results', 'write') THEN
    RAISE EXCEPTION 'You do not have permission to schedule examinations' USING ERRCODE = '42501';
  END IF;
  SELECT exam.id, exam.exam_group_id, exam.combine_subject_papers, exam.has_regular_classes,
         class.class_group, year.start_date, year.end_date
  INTO v_exam
  FROM public.result_exams AS exam
  JOIN public.classes AS class ON class.id = exam.class_id
  JOIN public.academic_years AS year ON year.id = exam.academic_year_id
  WHERE exam.id = p_exam_id FOR UPDATE OF exam;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class examination not found'; END IF;
  IF p_exam_date IS NULL OR p_exam_date NOT BETWEEN v_exam.start_date AND v_exam.end_date THEN
    RAISE EXCEPTION 'Exam date must be inside the class session';
  END IF;
  IF NOT v_exam.has_regular_classes AND p_exam_time IS NULL THEN
    RAISE EXCEPTION 'Exam time is required for an exam-only examination';
  END IF;
  IF p_subject_ids IS NULL OR cardinality(p_subject_ids) = 0 OR array_position(p_subject_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Select at least one subject';
  END IF;
  SELECT array_agg(DISTINCT id ORDER BY id) INTO v_requested FROM unnest(p_subject_ids) AS requested(id);
  IF (SELECT count(*) FROM public.subjects
      WHERE id = ANY(v_requested) AND is_active AND class_group = v_exam.class_group) <> cardinality(v_requested) THEN
    RAISE EXCEPTION 'Select active subjects from the examination class group';
  END IF;

  FOR v_subject IN
    SELECT subject.id, subject.name, paper_group.id AS paper_group_id,
           paper_group.first_paper_subject_id, paper_group.second_paper_subject_id,
           paper_group.name AS combined_name
    FROM public.subjects AS subject
    LEFT JOIN LATERAL (
      SELECT grouped.* FROM public.result_subject_paper_groups AS grouped
      WHERE v_exam.combine_subject_papers AND grouped.is_active
        AND grouped.class_group = v_exam.class_group
        AND subject.id IN (grouped.first_paper_subject_id, grouped.second_paper_subject_id)
      ORDER BY grouped.created_at, grouped.id LIMIT 1
    ) AS paper_group ON true
    WHERE subject.id = ANY(v_requested) ORDER BY subject.id
  LOOP
    IF v_exam.combine_subject_papers AND v_subject.paper_group_id IS NULL
       AND v_subject.name ~* '(1st|first|2nd|second)\s+paper' THEN
      RAISE EXCEPTION 'Choose an active combined course instead of an individual paper';
    END IF;
    v_canonical := coalesce(v_subject.first_paper_subject_id, v_subject.id);
    v_name := coalesce(v_subject.combined_name, v_subject.name);
    IF v_canonical = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_canonical);
    v_schedule_id := NULL;
    SELECT schedule.id INTO v_schedule_id
    FROM public.result_exam_schedules AS schedule
    JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
    WHERE link.exam_id = p_exam_id AND schedule.exam_date = p_exam_date
      AND schedule.exam_time IS NOT DISTINCT FROM p_exam_time
      AND (schedule.subject_id = v_canonical OR (
        v_exam.combine_subject_papers AND schedule.subject_id = v_subject.second_paper_subject_id
      ))
    ORDER BY schedule.id LIMIT 1;
    IF v_schedule_id IS NULL THEN
      INSERT INTO public.result_exam_schedules (
        exam_group_id, subject_id, subject_name, exam_date, exam_time, has_regular_classes, created_by
      ) VALUES (
        v_exam.exam_group_id, v_canonical, v_name, p_exam_date, p_exam_time, v_exam.has_regular_classes, auth.uid()
      ) RETURNING id INTO v_schedule_id;
      INSERT INTO public.result_exam_schedule_classes (schedule_id, exam_id) VALUES (v_schedule_id, p_exam_id);
    END IF;
    RETURN NEXT v_schedule_id;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.create_result_exam_routine_entries(uuid, uuid[], date, time without time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_result_exam_routine_entries(uuid, uuid[], date, time without time zone) TO authenticated;

-- Preserve callers that still create one subject at a time.
CREATE OR REPLACE FUNCTION public.create_result_exam_routine_entry(
  p_exam_ids uuid[], p_subject_id uuid, p_exam_date date, p_exam_time time without time zone DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_id uuid;
  v_count integer;
  v_schedule uuid;
BEGIN
  SELECT count(DISTINCT id), min(id::text)::uuid INTO v_count, v_exam_id FROM unnest(p_exam_ids) AS requested(id);
  IF v_count <> 1 OR array_position(p_exam_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'A routine row must belong to exactly one class examination';
  END IF;
  SELECT id INTO v_schedule FROM public.create_result_exam_routine_entries(
    v_exam_id, ARRAY[p_subject_id], p_exam_date, p_exam_time
  ) AS created(id);
  RETURN v_schedule;
END;
$$;

-- The same curriculum rule serves routines, attendance exceptions and exam fines.
CREATE OR REPLACE FUNCTION public.student_takes_routine_subject(p_student_id uuid, p_subject_id uuid, p_combined boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_subject_id IS NULL OR EXISTS (
    SELECT 1 FROM public.students AS student
    JOIN public.subjects AS subject ON subject.id = p_subject_id AND subject.class_group = student.class_group
    LEFT JOIN public.result_subject_paper_groups AS paper_group ON p_combined
      AND paper_group.class_group = subject.class_group
      AND subject.id IN (paper_group.first_paper_subject_id, paper_group.second_paper_subject_id)
    WHERE student.id = p_student_id AND (
      NOT subject.is_fourth_subject OR student.class_group = 'science'
      OR ARRAY[subject.id, paper_group.first_paper_subject_id, paper_group.second_paper_subject_id]
        && ARRAY[student.fourth_subject_id, student.optional_subject_2_id]
      OR EXISTS (
        SELECT 1 FROM public.subject_course_options AS choice
        WHERE choice.class_group = student.class_group
          AND choice.id = ANY(ARRAY[student.group_elective_option_id, student.group_fourth_option_id,
            student.humanities_fourth_option_id, student.humanities_main_option_1_id,
            student.humanities_main_option_2_id, student.humanities_main_option_3_id])
          AND ARRAY[subject.id, paper_group.first_paper_subject_id, paper_group.second_paper_subject_id]
            && ARRAY[choice.first_paper_subject_id, choice.second_paper_subject_id]
      )
    )
  );
$$;
REVOKE ALL ON FUNCTION public.student_takes_routine_subject(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_student_exam_routine(p_exam_id uuid)
RETURNS TABLE (id uuid, subject_name text, exam_date date, exam_time time without time zone)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
BEGIN
  SELECT student.id INTO v_student_id FROM public.students AS student
  WHERE student.profile_id = auth.uid() AND student.is_active;
  IF v_student_id IS NULL OR NOT (
    public.can_view_exam_routine(p_exam_id) OR public.can_view_result_exam(p_exam_id)
  ) THEN RAISE EXCEPTION 'Access to this examination routine is not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT schedule.id, coalesce(paper_group.name, nullif(schedule.subject_name, ''), subject.name),
         schedule.exam_date, schedule.exam_time
  FROM public.result_exam_schedules AS schedule
  JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
  JOIN public.result_exams AS exam ON exam.id = link.exam_id
  LEFT JOIN public.subjects AS subject ON subject.id = schedule.subject_id
  LEFT JOIN public.result_subject_paper_groups AS paper_group ON exam.combine_subject_papers
    AND paper_group.class_group = subject.class_group
    AND schedule.subject_id IN (paper_group.first_paper_subject_id, paper_group.second_paper_subject_id)
  WHERE exam.id = p_exam_id
    AND public.student_takes_routine_subject(v_student_id, schedule.subject_id, exam.combine_subject_papers)
  ORDER BY schedule.exam_date, schedule.exam_time, 2;
END;
$$;
REVOKE ALL ON FUNCTION public.get_student_exam_routine(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_exam_routine(uuid) TO authenticated;

-- BEGIN CURRICULUM-AWARE FINE FUNCTIONS
-- Preserve class-day modes; count a missed exam only when the student takes a scheduled subject.

CREATE OR REPLACE FUNCTION public.get_student_attendance_fine_details(p_student_id uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  applicable_routine_days AS (
    SELECT DISTINCT exam.class_id, schedule.exam_group_id, schedule.exam_date
    FROM public.result_exam_schedules AS schedule
    JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
    JOIN public.result_exams AS exam ON exam.id = link.exam_id
    WHERE (p_start_date IS NULL OR schedule.exam_date >= p_start_date)
      AND (p_end_date IS NULL OR schedule.exam_date <= p_end_date)
      AND public.student_takes_routine_subject(p_student_id, schedule.subject_id, exam.combine_subject_papers)
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
    JOIN applicable_routine_days AS routine
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
      AND public.student_takes_routine_subject(mark.student_id, schedule.subject_id, exam.combine_subject_papers)
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
$function$;

CREATE OR REPLACE FUNCTION public.get_class_attendance_fine_details(p_class_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(student_id uuid, recorded_absences integer, late_days integer, late_penalty_absences integer, fineable_absences integer, exam_missed_count integer, fine_per_absent_day numeric, exam_missed_fine_amount numeric, attendance_fine numeric, exam_missed_fine numeric, total_fine numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  applicable_routine_days AS (
    SELECT DISTINCT roster.id AS student_id, schedule.exam_group_id, schedule.exam_date
    FROM roster
    JOIN public.result_exams AS exam ON exam.class_id = p_class_id
    JOIN public.result_exam_schedule_classes AS link ON link.exam_id = exam.id
    JOIN public.result_exam_schedules AS schedule ON schedule.id = link.schedule_id
    WHERE schedule.exam_date BETWEEN p_start_date AND p_end_date
      AND public.student_takes_routine_subject(roster.id, schedule.subject_id, exam.combine_subject_papers)
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
    JOIN applicable_routine_days AS routine ON routine.student_id = day.student_id AND routine.exam_date = day.date
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
      AND public.student_takes_routine_subject(mark.student_id, schedule.subject_id, exam.combine_subject_papers)
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
$function$;

CREATE OR REPLACE FUNCTION public.get_student_attendance_exceptions(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.students
       WHERE id = p_student_id AND profile_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Access to this student is not allowed' USING ERRCODE = '42501';
  END IF;

  WITH missed AS (
    SELECT DISTINCT
      schedule.id::text || ':' || exam.id::text AS id,
      schedule.exam_date AS date,
      coalesce(nullif(exam.title, ''), exam_type.name) AS exam,
      schedule.subject_name AS subject
    FROM public.result_exam_schedules AS schedule
    JOIN public.result_exam_schedule_classes AS link ON link.schedule_id = schedule.id
    JOIN public.result_exams AS exam ON exam.id = link.exam_id
    JOIN public.result_exam_types AS exam_type ON exam_type.id = exam.exam_type_id
    WHERE public.student_takes_routine_subject(p_student_id, schedule.subject_id, exam.combine_subject_papers) AND (
      EXISTS (
        SELECT 1
        FROM public.attendance_records AS record
        JOIN public.attendance_sessions AS session ON session.id = record.session_id
        WHERE record.student_id = p_student_id
          AND record.status IN ('absent', 'too_late')
          AND session.class_id = exam.class_id
          AND session.date = schedule.exam_date
      ) OR EXISTS (
        SELECT 1
        FROM public.result_marks AS mark
        JOIN public.result_exam_subjects AS exam_subject ON exam_subject.id = mark.exam_subject_id
        WHERE mark.student_id = p_student_id AND mark.is_absent = true
          AND exam_subject.exam_id = exam.id
          AND exam_subject.subject_id = schedule.subject_id
      )
    )
  ), too_late AS (
    SELECT record.id, session.date, subject.name AS subject, record.check_in_at
    FROM public.attendance_records AS record
    JOIN public.attendance_sessions AS session ON session.id = record.session_id
    LEFT JOIN public.subjects AS subject ON subject.id = session.subject_id
    WHERE record.student_id = p_student_id AND record.status = 'too_late'
  )
  SELECT jsonb_build_object(
    'missedExams', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'date', date, 'exam', exam, 'subject', subject
      ) ORDER BY date DESC, exam, subject) FROM missed
    ), '[]'::jsonb),
    'tooLateAttendance', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'date', date, 'subject', subject, 'checkInAt', check_in_at
      ) ORDER BY date DESC, id) FROM too_late
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

COMMIT;
