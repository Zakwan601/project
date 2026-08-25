/* Keep subject management admin-only without blocking Results readers. */

DROP POLICY IF EXISTS result_subject_admin_guard ON public.subjects;

CREATE POLICY result_subject_admin_insert_guard ON public.subjects AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (NOT public.current_user_is_sub_admin());

CREATE POLICY result_subject_admin_update_guard ON public.subjects AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (NOT public.current_user_is_sub_admin())
  WITH CHECK (NOT public.current_user_is_sub_admin());

CREATE POLICY result_subject_admin_delete_guard ON public.subjects AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (NOT public.current_user_is_sub_admin());
