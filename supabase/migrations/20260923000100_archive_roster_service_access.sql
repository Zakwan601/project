-- The archive Edge Function resolves class membership through this historical
-- roster helper using the service role.
GRANT EXECUTE ON FUNCTION public.get_class_students_for_period(uuid, date, date) TO service_role;
