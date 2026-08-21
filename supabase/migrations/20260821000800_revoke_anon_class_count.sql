REVOKE EXECUTE ON FUNCTION public.get_classes_with_active_student_count(uuid)
  FROM anon;

COMMENT ON FUNCTION public.get_classes_with_active_student_count(uuid) IS
  'Returns classes with RLS-visible active student counts to authenticated callers without transferring student rows.';
