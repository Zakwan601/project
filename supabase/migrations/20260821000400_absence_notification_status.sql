CREATE OR REPLACE FUNCTION public.get_absence_notification_status(p_date date)
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
       FROM public.profiles
       WHERE id = auth.uid()
         AND role = 'admin'
         AND is_active = true
     ) THEN
    RAISE EXCEPTION 'An active administrator account is required'
      USING ERRCODE = '42501';
  END IF;

  WITH absent_records AS (
    SELECT record.id
    FROM public.attendance_records AS record
    JOIN public.attendance_sessions AS session
      ON session.id = record.session_id
    WHERE session.date = p_date
      AND record.status = 'absent'
  ),
  linked_messages AS (
    SELECT message.status
    FROM public.sms_messages AS message
    JOIN absent_records AS record
      ON record.id = message.attendance_record_id
    WHERE message.source = 'attendance_absent'
      AND message.status IN ('queued', 'processing', 'submitted', 'delivered')
  ),
  legacy_messages AS (
    SELECT message.status
    FROM public.sms_messages AS message
    WHERE message.source = 'attendance_absent'
      AND message.created_at >= (p_date::timestamp AT TIME ZONE 'Asia/Dhaka')
      AND message.created_at < ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')
      AND message.status IN ('queued', 'processing', 'submitted', 'delivered')
      AND EXISTS (SELECT 1 FROM absent_records)
      AND NOT EXISTS (SELECT 1 FROM linked_messages)
  ),
  effective_messages AS (
    SELECT status FROM linked_messages
    UNION ALL
    SELECT status FROM legacy_messages
  )
  SELECT jsonb_build_object(
    'has_sent_message',
    COALESCE(BOOL_OR(status IN ('submitted', 'delivered')), false),
    'has_message_in_progress',
    COALESCE(BOOL_OR(status IN ('queued', 'processing')), false)
  )
  INTO result
  FROM effective_messages;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_absence_notification_status(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_absence_notification_status(date)
  TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS sms_messages_absence_record_status_idx
  ON public.sms_messages(attendance_record_id, status)
  WHERE source = 'attendance_absent'
    AND attendance_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sms_messages_absence_created_status_idx
  ON public.sms_messages(created_at, status)
  WHERE source = 'attendance_absent';

COMMENT ON FUNCTION public.get_absence_notification_status(date) IS
  'Returns absence SMS sent/in-progress state for active admins in one database request.';
