/* Enforce sub-admin module grants in addition to the existing role policies. */

CREATE OR REPLACE FUNCTION public.current_user_is_sub_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT role = 'sub_admin'
    FROM public.profiles
    WHERE id = auth.uid() AND is_active = true
  ), false);
$$;

REVOKE ALL ON FUNCTION public.current_user_is_sub_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_sub_admin() TO authenticated, service_role;

DO $policies$
DECLARE
  rule record;
BEGIN
  FOR rule IN
    SELECT * FROM (VALUES
      ('students',
       $$public.has_permission('students','read') OR public.has_permission('attendance','read') OR public.has_permission('punches','read') OR public.has_permission('reports','read') OR public.has_permission('departure_anomalies','read')$$,
       $$public.has_permission('students','write')$$),
      ('student_enrollments',
       $$public.has_permission('students','read') OR public.has_permission('attendance','read') OR public.has_permission('reports','read')$$,
       $$public.has_permission('students','write')$$),
      ('classes',
       $$public.has_permission('classes','read') OR public.has_permission('attendance','read') OR public.has_permission('punches','read') OR public.has_permission('reports','read') OR public.has_permission('departure_anomalies','read')$$,
       $$public.has_permission('classes','write')$$),
      ('academic_years',
       $$public.has_permission('classes','read') OR public.has_permission('attendance','read') OR public.has_permission('reports','read')$$,
       NULL),
      ('subjects',
       $$public.has_permission('classes','read') OR public.has_permission('attendance','read') OR public.has_permission('reports','read')$$,
       $$public.has_permission('classes','write')$$),
      ('attendance_sessions',
       $$public.has_permission('attendance','read') OR public.has_permission('reports','read') OR public.has_permission('departure_anomalies','read')$$,
       $$public.has_permission('attendance','write')$$),
      ('attendance_records',
       $$public.has_permission('attendance','read') OR public.has_permission('reports','read') OR public.has_permission('departure_anomalies','read')$$,
       $$public.has_permission('attendance','write')$$),
      ('attendance_correction_audit',
       $$public.has_permission('attendance','read')$$,
       NULL),
      ('devices',
       $$public.has_permission('devices','read')$$,
       $$public.has_permission('devices','write')$$),
      ('device_logs',
       $$public.has_permission('punches','read') OR public.has_permission('departure_anomalies','read')$$,
       $$public.has_permission('punches','write')$$),
      ('holidays',
       $$public.has_permission('vacations','read') OR public.has_permission('attendance','read')$$,
       $$public.has_permission('vacations','write')$$),
      ('student_reports',
       $$public.has_permission('complaints','read')$$,
       $$public.has_permission('complaints','write')$$),
      ('announcements',
       $$public.has_permission('announcements','read')$$,
       $$public.has_permission('announcements','write')$$),
      ('sms_messages',
       $$public.has_permission('sms_messages','read')$$,
       NULL),
      ('class_departure_analysis_settings',
       $$public.has_permission('departure_anomalies','read')$$,
       $$public.has_permission('departure_anomalies','write')$$),
      ('class_daily_dismissal_times',
       $$public.has_permission('departure_anomalies','read')$$,
       $$public.has_permission('departure_anomalies','write')$$),
      ('student_departure_anomaly_reports',
       $$public.has_permission('departure_anomalies','read')$$,
       $$public.has_permission('departure_anomalies','write')$$)
    ) AS permissions(table_name, read_expression, write_expression)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rule.table_name);

    EXECUTE format('DROP POLICY IF EXISTS sub_admin_read_guard ON public.%I', rule.table_name);
    EXECUTE format('DROP POLICY IF EXISTS sub_admin_read_grant ON public.%I', rule.table_name);
    EXECUTE format(
      'CREATE POLICY sub_admin_read_guard ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.current_user_is_sub_admin() OR (%s))',
      rule.table_name,
      rule.read_expression
    );
    EXECUTE format(
      'CREATE POLICY sub_admin_read_grant ON public.%I FOR SELECT TO authenticated USING (public.current_user_is_sub_admin() AND (%s))',
      rule.table_name,
      rule.read_expression
    );

    IF rule.write_expression IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS sub_admin_insert_guard ON public.%I', rule.table_name);
      EXECUTE format('DROP POLICY IF EXISTS sub_admin_insert_grant ON public.%I', rule.table_name);
      EXECUTE format(
        'CREATE POLICY sub_admin_insert_guard ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.current_user_is_sub_admin() OR (%s))',
        rule.table_name,
        rule.write_expression
      );
      EXECUTE format(
        'CREATE POLICY sub_admin_insert_grant ON public.%I FOR INSERT TO authenticated WITH CHECK (public.current_user_is_sub_admin() AND (%s))',
        rule.table_name,
        rule.write_expression
      );

      EXECUTE format('DROP POLICY IF EXISTS sub_admin_update_guard ON public.%I', rule.table_name);
      EXECUTE format('DROP POLICY IF EXISTS sub_admin_update_grant ON public.%I', rule.table_name);
      EXECUTE format(
        'CREATE POLICY sub_admin_update_guard ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.current_user_is_sub_admin() OR (%s)) WITH CHECK (NOT public.current_user_is_sub_admin() OR (%s))',
        rule.table_name,
        rule.write_expression,
        rule.write_expression
      );
      EXECUTE format(
        'CREATE POLICY sub_admin_update_grant ON public.%I FOR UPDATE TO authenticated USING (public.current_user_is_sub_admin() AND (%s)) WITH CHECK (public.current_user_is_sub_admin() AND (%s))',
        rule.table_name,
        rule.write_expression,
        rule.write_expression
      );

      EXECUTE format('DROP POLICY IF EXISTS sub_admin_delete_guard ON public.%I', rule.table_name);
      EXECUTE format('DROP POLICY IF EXISTS sub_admin_delete_grant ON public.%I', rule.table_name);
      EXECUTE format(
        'CREATE POLICY sub_admin_delete_guard ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.current_user_is_sub_admin() OR (%s))',
        rule.table_name,
        rule.write_expression
      );
      EXECUTE format(
        'CREATE POLICY sub_admin_delete_grant ON public.%I FOR DELETE TO authenticated USING (public.current_user_is_sub_admin() AND (%s))',
        rule.table_name,
        rule.write_expression
      );
    END IF;
  END LOOP;
END;
$policies$;

DROP POLICY IF EXISTS "Only active admins may read SMS messages" ON public.sms_messages;
CREATE POLICY "Only authorized staff may read SMS messages"
  ON public.sms_messages
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.has_permission('sms_messages', 'read'));
