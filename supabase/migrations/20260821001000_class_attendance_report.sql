CREATE OR REPLACE FUNCTION public.get_class_attendance_report(
  p_class_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  id uuid,
  name text,
  admission text,
  roll integer,
  present integer,
  absent integer,
  late integer,
  excused integer,
  total integer,
  percentage integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH requested_sessions AS (
    SELECT session.id
    FROM public.attendance_sessions AS session
    WHERE session.class_id = p_class_id
      AND session.date BETWEEN p_start_date AND p_end_date
  ),
  attendance_by_student AS (
    SELECT
      record.student_id,
      COUNT(*) FILTER (WHERE record.status = 'present')::integer AS present,
      COUNT(*) FILTER (WHERE record.status = 'absent')::integer AS absent,
      COUNT(*) FILTER (WHERE record.status = 'late')::integer AS late,
      COUNT(*) FILTER (WHERE record.status = 'excused')::integer AS excused
    FROM public.attendance_records AS record
    JOIN requested_sessions AS session ON session.id = record.session_id
    GROUP BY record.student_id
  ),
  report_rows AS (
    SELECT
      student.id,
      CONCAT_WS(' ', student.first_name, student.last_name) AS name,
      student.admission_number AS admission,
      student.roll_number AS roll,
      COALESCE(attendance.present, 0)::integer AS present,
      COALESCE(attendance.absent, 0)::integer AS absent,
      COALESCE(attendance.late, 0)::integer AS late,
      COALESCE(attendance.excused, 0)::integer AS excused
    FROM public.get_class_students_for_period(
      p_class_id,
      p_start_date,
      p_end_date
    ) AS student
    LEFT JOIN attendance_by_student AS attendance
      ON attendance.student_id = student.id
    WHERE EXISTS (SELECT 1 FROM requested_sessions)
  )
  SELECT
    report.id,
    report.name,
    report.admission,
    report.roll,
    report.present,
    report.absent,
    report.late,
    report.excused,
    (report.present + report.absent + report.late + report.excused)::integer AS total,
    CASE
      WHEN report.present + report.absent + report.late = 0 THEN 0
      ELSE ROUND(
        (report.present + report.late)::numeric * 100
          / (report.present + report.absent + report.late)
      )::integer
    END AS percentage
  FROM report_rows AS report
  ORDER BY COALESCE(report.roll, 999), report.name, report.id;
$$;

REVOKE ALL ON FUNCTION public.get_class_attendance_report(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_class_attendance_report(uuid, date, date)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_class_attendance_report(uuid, date, date) IS
  'Returns historical class-roster attendance counts in one request. Rate = (present + late) / (present + late + absent); excused records are reported but excluded.';
