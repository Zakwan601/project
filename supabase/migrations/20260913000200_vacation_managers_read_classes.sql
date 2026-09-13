/* Vacation managers need the class list to scope a vacation. This grants only
   class-row reads; it does not grant class writes or student-row access. */

DROP POLICY IF EXISTS sub_admin_read_guard ON public.classes;
DROP POLICY IF EXISTS sub_admin_read_grant ON public.classes;

CREATE POLICY sub_admin_read_guard
ON public.classes
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  NOT public.current_user_is_sub_admin()
  OR public.has_permission('classes', 'read')
  OR public.has_permission('attendance', 'read')
  OR public.has_permission('punches', 'read')
  OR public.has_permission('reports', 'read')
  OR public.has_permission('departure_anomalies', 'read')
  OR public.has_permission('results', 'read')
  OR public.has_permission('vacations', 'read')
);

CREATE POLICY sub_admin_read_grant
ON public.classes
FOR SELECT
TO authenticated
USING (
  public.current_user_is_sub_admin()
  AND (
    public.has_permission('classes', 'read')
    OR public.has_permission('attendance', 'read')
    OR public.has_permission('punches', 'read')
    OR public.has_permission('reports', 'read')
    OR public.has_permission('departure_anomalies', 'read')
    OR public.has_permission('results', 'read')
    OR public.has_permission('vacations', 'read')
  )
);

