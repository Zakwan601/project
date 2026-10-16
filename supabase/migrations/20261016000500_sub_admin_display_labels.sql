/* Teacher is a display label only. All staff access continues to use sub_admin. */
ALTER TABLE public.profiles
  ADD COLUMN sub_admin_label text NOT NULL DEFAULT 'sub_admin'
    CHECK (sub_admin_label IN ('sub_admin', 'teacher'));

COMMENT ON COLUMN public.profiles.sub_admin_label IS
  'Administrator-selected display label for sub_admin accounts. Does not change roles or permissions.';

CREATE OR REPLACE FUNCTION public.protect_sub_admin_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sub_admin_label = 'sub_admin' THEN RETURN NEW; END IF;
  ELSIF NEW.sub_admin_label IS NOT DISTINCT FROM OLD.sub_admin_label THEN
    RETURN NEW;
  END IF;

  IF auth.role() = 'service_role' OR EXISTS (
    SELECT 1 FROM public.profiles AS caller
    WHERE caller.id = auth.uid() AND caller.role = 'admin' AND caller.is_active = true
  ) THEN RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only an active full administrator can change the staff display label'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER protect_sub_admin_label
  BEFORE INSERT OR UPDATE OF sub_admin_label ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_sub_admin_label();
REVOKE ALL ON FUNCTION public.protect_sub_admin_label() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.set_sub_admin_label(p_profile_id uuid, p_label text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS caller
    WHERE caller.id = auth.uid() AND caller.role = 'admin' AND caller.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active full administrator can change the staff display label'
      USING ERRCODE = '42501';
  END IF;
  IF p_label IS NULL OR p_label NOT IN ('sub_admin', 'teacher') THEN
    RAISE EXCEPTION 'Choose Sub-administrator or Teacher' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles SET sub_admin_label = p_label
  WHERE id = p_profile_id AND role = 'sub_admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sub-admin account not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_sub_admin_label(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sub_admin_label(uuid, text) TO authenticated;

/* Add the label to the existing private account list. */
DROP FUNCTION public.list_sub_admin_accounts();
CREATE FUNCTION public.list_sub_admin_accounts()
RETURNS TABLE (
  id uuid, full_name text, avatar_url text, phone text, secondary_phone text,
  is_active boolean, created_at timestamptz, login_email text, sub_admin_label text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS caller
    WHERE caller.id = auth.uid() AND caller.role = 'admin' AND caller.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active full administrators can view sub-admin login details'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT profile.id, profile.full_name, profile.avatar_url,
         profile.phone, profile.secondary_phone, profile.is_active,
         profile.created_at, account.email::text, profile.sub_admin_label
  FROM public.profiles AS profile
  LEFT JOIN auth.users AS account ON account.id = profile.id
  WHERE profile.role = 'sub_admin'
  ORDER BY profile.full_name, profile.id;
END;
$$;
REVOKE ALL ON FUNCTION public.list_sub_admin_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_sub_admin_accounts() TO authenticated;
