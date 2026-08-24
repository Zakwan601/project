/* Upgrade existing privileged RPCs to honor delegated write/read grants. */

CREATE OR REPLACE FUNCTION public.replace_function_authorization(
  p_signature text,
  p_pattern text,
  p_replacement text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_oid oid;
  v_definition text;
  v_updated text;
BEGIN
  v_oid := to_regprocedure(p_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Required function % was not found', p_signature;
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;
  v_updated := regexp_replace(v_definition, p_pattern, p_replacement);

  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Authorization block in % did not match the expected definition', p_signature;
  END IF;

  EXECUTE v_updated;
END;
$$;

SELECT public.replace_function_authorization(
  'public.promote_students(uuid[],uuid,date)',
  $pattern$IF NOT EXISTS \([[:space:]]*SELECT 1 FROM public\.profiles[[:space:]]*WHERE id = auth\.uid\(\) AND role = 'admin' AND is_active = true[[:space:]]*\) THEN[[:space:]]*RAISE EXCEPTION 'Only active administrators can promote students';[[:space:]]*END IF;$pattern$,
  $replacement$IF auth.role() <> 'service_role'
     AND NOT public.has_permission('students', 'write') THEN
    RAISE EXCEPTION 'Student write permission is required';
  END IF;$replacement$
);

SELECT public.replace_function_authorization(
  'public.correct_attendance_records(uuid,jsonb,text)',
  $pattern$IF NOT EXISTS \([[:space:]]*SELECT 1 FROM public\.profiles[[:space:]]*WHERE id = auth\.uid\(\) AND role = 'admin' AND is_active = true[[:space:]]*\) THEN[[:space:]]*RAISE EXCEPTION 'Only active administrators can correct attendance';[[:space:]]*END IF;$pattern$,
  $replacement$IF auth.role() <> 'service_role'
     AND NOT public.has_permission('attendance', 'write') THEN
    RAISE EXCEPTION 'Attendance write permission is required';
  END IF;$replacement$
);

SELECT public.replace_function_authorization(
  'public.mark_attendance_vacation(date,text,text)',
  $pattern$IF NOT EXISTS \([[:space:]]*SELECT 1[[:space:]]*FROM public\.profiles[[:space:]]*WHERE id = auth\.uid\(\)[[:space:]]*AND role = 'admin'[[:space:]]*AND is_active = true[[:space:]]*\) THEN[[:space:]]*RAISE EXCEPTION 'Only an active administrator can add a vacation';[[:space:]]*END IF;$pattern$,
  $replacement$IF auth.role() <> 'service_role'
     AND NOT public.has_permission('vacations', 'write') THEN
    RAISE EXCEPTION 'Vacation write permission is required';
  END IF;$replacement$
);

SELECT public.replace_function_authorization(
  'public.get_absence_notification_status(date)',
  $pattern$IF auth\.role\(\) <> 'service_role'[[:space:]]*AND NOT EXISTS \([[:space:]]*SELECT 1[[:space:]]*FROM public\.profiles[[:space:]]*WHERE id = auth\.uid\(\)[[:space:]]*AND role = 'admin'[[:space:]]*AND is_active = true[[:space:]]*\) THEN[[:space:]]*RAISE EXCEPTION 'An active administrator account is required'[[:space:]]*USING ERRCODE = '42501';[[:space:]]*END IF;$pattern$,
  $replacement$IF auth.role() <> 'service_role'
     AND NOT public.has_permission('attendance', 'read') THEN
    RAISE EXCEPTION 'Attendance read permission is required'
      USING ERRCODE = '42501';
  END IF;$replacement$
);

SELECT public.replace_function_authorization(
  'public.get_admin_dashboard(date,date,date)',
  $pattern$IF auth\.role\(\) <> 'service_role'[[:space:]]*AND NOT EXISTS \([[:space:]]*SELECT 1[[:space:]]*FROM public\.profiles[[:space:]]*WHERE id = auth\.uid\(\)[[:space:]]*AND role = 'admin'[[:space:]]*AND is_active = true[[:space:]]*\) THEN[[:space:]]*RAISE EXCEPTION 'An active administrator account is required'[[:space:]]*USING ERRCODE = '42501';[[:space:]]*END IF;$pattern$,
  $replacement$IF auth.role() <> 'service_role'
     AND NOT public.has_permission('dashboard', 'read') THEN
    RAISE EXCEPTION 'Dashboard read permission is required'
      USING ERRCODE = '42501';
  END IF;$replacement$
);

DROP FUNCTION public.replace_function_authorization(text, text, text);
