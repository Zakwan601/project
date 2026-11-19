-- Module write permission permits student editing, never student deletion.
-- Restrictive policies also constrain the existing sub-admin delete grant.
CREATE POLICY students_admin_only_delete ON public.students
AS RESTRICTIVE FOR DELETE TO authenticated
USING ((SELECT EXISTS (
  SELECT 1 FROM public.profiles
  WHERE id=auth.uid() AND role='admin' AND is_active
)));

COMMENT ON POLICY students_admin_only_delete ON public.students IS
  'Only active full administrators can delete students, regardless of module write permissions or assigned classes.';
