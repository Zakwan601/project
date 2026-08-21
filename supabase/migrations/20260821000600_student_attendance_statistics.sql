CREATE OR REPLACE FUNCTION public.get_student_attendance_statistics(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (
       SELECT 1
       FROM public.students AS student
       WHERE student.id = p_student_id
         AND student.profile_id = auth.uid()
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.profiles
       WHERE id = auth.uid()
         AND role IN ('admin', 'teacher')
         AND is_active = true
     ) THEN
    RAISE EXCEPTION 'Access to this student is not allowed'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student not found'
      USING ERRCODE = 'P0002';
  END IF;

  WITH student_info AS (
    SELECT
      class.name AS class_name,
      class.grade AS class_grade,
      class.section AS class_section
    FROM public.students AS student
    LEFT JOIN public.classes AS class
      ON class.id = student.class_id
    WHERE student.id = p_student_id
  ),
  overall AS (
    SELECT
      COUNT(*) FILTER (WHERE record.status = 'present')::integer AS present,
      COUNT(*) FILTER (WHERE record.status = 'absent')::integer AS absent,
      COUNT(*) FILTER (WHERE record.status = 'late')::integer AS late,
      COUNT(*) FILTER (WHERE record.status = 'excused')::integer AS excused
    FROM public.attendance_records AS record
    WHERE record.student_id = p_student_id
  ),
  subject_counts AS (
    SELECT
      COALESCE(subject.name, session.notes, 'General') AS subject,
      COUNT(*) FILTER (WHERE record.status = 'present')::integer AS present,
      COUNT(*) FILTER (WHERE record.status = 'absent')::integer AS absent,
      COUNT(*) FILTER (WHERE record.status = 'late')::integer AS late,
      COUNT(*) FILTER (WHERE record.status = 'excused')::integer AS excused
    FROM public.attendance_records AS record
    JOIN public.attendance_sessions AS session
      ON session.id = record.session_id
    LEFT JOIN public.subjects AS subject
      ON subject.id = session.subject_id
    WHERE record.student_id = p_student_id
    GROUP BY COALESCE(subject.name, session.notes, 'General')
  ),
  subject_rows AS (
    SELECT
      subject,
      present,
      late,
      absent,
      excused,
      present + late + absent AS total,
      CASE
        WHEN present + late + absent = 0 THEN 0
        ELSE ROUND((present + late)::numeric * 100 / (present + late + absent))::integer
      END AS percentage
    FROM subject_counts
  )
  SELECT jsonb_build_object(
    'stats', jsonb_build_object(
      'attendanceRate', CASE
        WHEN overall.present + overall.late + overall.absent = 0 THEN 0
        ELSE ROUND(
          (overall.present + overall.late)::numeric * 100
          / (overall.present + overall.late + overall.absent)
        )::integer
      END,
      'presentCount', overall.present,
      'absentCount', overall.absent,
      'lateCount', overall.late,
      'excusedCount', overall.excused,
      'totalSessions', overall.present + overall.late + overall.absent,
      'className', student_info.class_name,
      'classGrade', student_info.class_grade,
      'classSection', student_info.class_section
    ),
    'subjects', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'subject', subject,
            'present', present,
            'late', late,
            'absent', absent,
            'excused', excused,
            'total', total,
            'percentage', percentage
          )
          ORDER BY percentage DESC, subject
        )
        FROM subject_rows
      ),
      '[]'::jsonb
    )
  )
  INTO result
  FROM student_info
  CROSS JOIN overall;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_attendance_statistics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_attendance_statistics(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_student_attendance_statistics(uuid) IS
  'Returns grouped lifetime and subject attendance statistics. Rate = (present + late) / (present + late + absent); excused records are reported but excluded.';
