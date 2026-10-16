/* Sub-admin result write permission covers exam setup and marks, not publication. */
CREATE OR REPLACE FUNCTION public.enforce_admin_result_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND auth.role() <> 'service_role'
     AND NOT EXISTS (
       SELECT 1
       FROM public.profiles AS profile
       WHERE profile.id = auth.uid()
         AND profile.role = 'admin'
         AND profile.is_active = true
     ) THEN
    RAISE EXCEPTION 'Only a full administrator can publish or unpublish results'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_admin_result_status_change_before_update
  ON public.result_exams;
CREATE TRIGGER enforce_admin_result_status_change_before_update
  BEFORE UPDATE OF status ON public.result_exams
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_admin_result_status_change();

REVOKE ALL ON FUNCTION public.enforce_admin_result_status_change() FROM PUBLIC;

COMMENT ON FUNCTION public.enforce_admin_result_status_change() IS
  'Prevents sub-admin accounts from publishing or returning examination results to draft.';
