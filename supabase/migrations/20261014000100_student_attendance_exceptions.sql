CREATE OR REPLACE FUNCTION public.get_student_attendance_exceptions(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE (
      schedule.subject_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.result_exam_subjects AS exam_subject
        WHERE exam_subject.exam_id = exam.id
          AND exam_subject.subject_id = schedule.subject_id
          AND public.student_takes_exam_subject(p_student_id, exam_subject.id)
      )
    ) AND (
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
$$;

REVOKE ALL ON FUNCTION public.get_student_attendance_exceptions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_attendance_exceptions(uuid) TO authenticated, service_role;
