CREATE FUNCTION public.get_student_attendance_breakdown(p_student_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE statistics jsonb; months jsonb;
BEGIN
  -- Authorize before reading records, retaining the existing student, staff
  -- permission and assigned-class checks even for empty histories.
  statistics:=public.get_student_attendance_statistics(p_student_id);
  WITH monthly_counts AS (
    SELECT date_trunc('month',session.date::timestamp)::date AS month,
      count(*) FILTER(WHERE record.status='present')::integer AS present,
      count(*) FILTER(WHERE record.status IN ('absent','too_late'))::integer AS absent,
      count(*) FILTER(WHERE record.status='late')::integer AS late,
      count(*) FILTER(WHERE record.status='excused')::integer AS excused
    FROM public.attendance_records record
    JOIN public.attendance_sessions session ON session.id=record.session_id
    WHERE record.student_id=p_student_id AND public.teacher_can_access_session(session.id)
    GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'month',month,'present',present,'absent',absent,'late',late,'excused',excused,
    'total',present+absent+late+excused,
    'percentage',CASE WHEN present+absent+late+excused=0 THEN 0
      ELSE round((present+late+excused)::numeric*100/(present+absent+late+excused))::integer END
  ) ORDER BY month DESC),'[]'::jsonb) INTO months FROM monthly_counts;
  RETURN statistics || jsonb_build_object('months',months);
END;
$$;
REVOKE ALL ON FUNCTION public.get_student_attendance_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_attendance_breakdown(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_student_attendance_breakdown(uuid) IS
  'Returns all-time, subject and monthly attendance in one authorized request. Too late counts as absent; present, late and approved leave count toward the rate.';
