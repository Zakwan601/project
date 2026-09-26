/* Approved leave counts as attended in every attendance percentage. */
CREATE FUNCTION public.replace_attendance_percentage_text(
  p_signature text,
  p_old text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_oid oid;
  v_definition text;
BEGIN
  v_oid := to_regprocedure(p_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Required function % was not found', p_signature;
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;
  IF strpos(v_definition, p_old) = 0 THEN
    RAISE EXCEPTION 'Expected attendance percentage expression was not found in %', p_signature;
  END IF;

  EXECUTE replace(v_definition, p_old, p_new);
END;
$$;

SELECT public.replace_attendance_percentage_text(
  'public.get_class_attendance_report(uuid,date,date)',
  'WHEN report.present + report.absent + report.late = 0 THEN 0',
  'WHEN report.present + report.absent + report.late + report.excused = 0 THEN 0'
);
SELECT public.replace_attendance_percentage_text(
  'public.get_class_attendance_report(uuid,date,date)',
  '(report.present + report.late)::numeric * 100',
  '(report.present + report.late + report.excused)::numeric * 100'
);
SELECT public.replace_attendance_percentage_text(
  'public.get_class_attendance_report(uuid,date,date)',
  '/ (report.present + report.absent + report.late)',
  '/ (report.present + report.absent + report.late + report.excused)'
);

SELECT public.replace_attendance_percentage_text(
  'public.get_student_attendance_statistics(uuid)',
  'present + late + absent',
  'present + late + excused + absent'
);
SELECT public.replace_attendance_percentage_text(
  'public.get_student_attendance_statistics(uuid)',
  '(present + late)::numeric',
  '(present + late + excused)::numeric'
);
SELECT public.replace_attendance_percentage_text(
  'public.get_student_attendance_statistics(uuid)',
  'overall.present + overall.late + overall.absent',
  'overall.present + overall.late + overall.excused + overall.absent'
);
SELECT public.replace_attendance_percentage_text(
  'public.get_student_attendance_statistics(uuid)',
  '(overall.present + overall.late)::numeric',
  '(overall.present + overall.late + overall.excused)::numeric'
);

SELECT public.replace_attendance_percentage_text(
  'public.get_admin_dashboard(date,date,date)',
  'present + absent + late FROM today',
  'present + absent + late + excused FROM today'
);
SELECT public.replace_attendance_percentage_text(
  'public.get_admin_dashboard(date,date,date)',
  '(present + late)::numeric * 100 / (present + absent + late)',
  '(present + late + excused)::numeric * 100 / (present + absent + late + excused)'
);

DROP FUNCTION public.replace_attendance_percentage_text(text, text, text);

COMMENT ON FUNCTION public.get_class_attendance_report(uuid, date, date) IS
  'Returns historical class-roster attendance counts in one request. Rate = (present + late + excused) / all recorded attendance days.';
COMMENT ON FUNCTION public.get_student_attendance_statistics(uuid) IS
  'Returns grouped lifetime and subject attendance statistics. Present, late, and approved leave count as attended.';
COMMENT ON FUNCTION public.get_admin_dashboard(date, date, date) IS
  'Returns the authorized admin dashboard. Present, late, and approved leave count toward the attendance rate.';
