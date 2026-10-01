/* attendance_records has created_at but no updated_at. */
CREATE OR REPLACE FUNCTION public.get_punch_attendance_status(
  p_student_id uuid,
  p_date date
)
RETURNS public.attendance_status
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.attendance_status;
  v_authorized boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND (
        profile.role = 'admin'
        OR (
          profile.role = 'sub_admin'
          AND public.has_permission('punches', 'read')
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.students AS student
    WHERE student.id = p_student_id
      AND student.profile_id = auth.uid()
  )
  INTO v_authorized;

  IF auth.role() <> 'service_role' AND NOT coalesce(v_authorized, false) THEN
    RETURN NULL;
  END IF;

  SELECT record.status
  INTO v_status
  FROM public.attendance_records AS record
  JOIN public.attendance_sessions AS attendance_session
    ON attendance_session.id = record.session_id
  WHERE record.student_id = p_student_id
    AND attendance_session.date = p_date
  ORDER BY record.created_at DESC
  LIMIT 1;

  RETURN v_status;
END;
$$;

COMMENT ON FUNCTION public.get_punch_attendance_status(uuid, date) IS
  'Returns the authorized attendance status used by the Punches page for a student and school date.';
