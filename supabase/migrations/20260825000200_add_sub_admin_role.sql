/* Add a delegated administrator role without allowing self-escalation. */

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'sub_admin';

/* The application now has exactly two elevated roles; legacy teacher accounts become students. */
UPDATE public.profiles SET role = 'student' WHERE role = 'teacher';

/* Public sign-up metadata must never be able to choose an elevated role. */
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'student'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  IF auth.role() = 'service_role' OR EXISTS (
    SELECT 1
    FROM public.profiles AS actor
    WHERE actor.id = auth.uid()
      AND actor.role = 'admin'
      AND actor.is_active = true
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only an active administrator can change account roles';
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_role ON public.profiles;
CREATE TRIGGER protect_profile_role
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();

COMMENT ON FUNCTION public.protect_profile_role() IS
  'Prevents users from escalating their own profile role.';
