ALTER TABLE public.profiles ADD COLUMN is_open_account boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD CONSTRAINT open_accounts_staff_only
  CHECK (NOT is_open_account OR role = 'sub_admin');

CREATE FUNCTION public.protect_staff_account_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_active AND EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Deleted accounts cannot be reactivated' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.is_open_account THEN RETURN NEW; END IF;
  ELSIF NEW.is_open_account IS NOT DISTINCT FROM OLD.is_open_account THEN
    RETURN NEW;
  END IF;
  IF auth.role() = 'service_role' OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active
  ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Only an active full administrator can change open account settings' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER protect_staff_account_settings BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_staff_account_settings();
REVOKE ALL ON FUNCTION public.protect_staff_account_settings() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_staff_open_account(p_profile_id uuid, p_is_open boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles AS caller WHERE caller.id = auth.uid() AND caller.role = 'admin' AND caller.is_active) THEN
    RAISE EXCEPTION 'Only an active full administrator can manage open accounts' USING ERRCODE = '42501';
  END IF;
  IF p_is_open IS NULL THEN RAISE EXCEPTION 'Choose whether this is an open account' USING ERRCODE = '22023'; END IF;
  UPDATE public.profiles AS profile SET is_open_account = p_is_open
  WHERE profile.id = p_profile_id AND profile.role = 'sub_admin'
    AND EXISTS (SELECT 1 FROM auth.users WHERE id = profile.id AND deleted_at IS NULL);
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff account not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_staff_open_account(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_staff_open_account(uuid, boolean) TO authenticated;

-- Enforce the password lock even for direct Auth API requests and recovery flows.
-- Administrators must switch off Open account before issuing a new password.
CREATE FUNCTION public.protect_open_account_password()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE locked boolean;
BEGIN
  IF NEW.encrypted_password IS NOT DISTINCT FROM OLD.encrypted_password OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT is_open_account INTO locked FROM public.profiles WHERE id = NEW.id FOR SHARE;
  IF locked THEN
    RAISE EXCEPTION 'Password changes are disabled for this open account. Contact an administrator.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_open_account_password BEFORE UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_open_account_password();
REVOKE ALL ON FUNCTION public.protect_open_account_password() FROM PUBLIC, anon, authenticated;

-- Auth soft deletion removes the login while retaining authorship and uploaded school files.
-- Revoke application access in the same transaction as deletion, including existing JWTs.
CREATE FUNCTION public.revoke_deleted_staff_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.profiles SET is_active = false WHERE id = NEW.id AND role = 'sub_admin';
    DELETE FROM public.sub_admin_permissions WHERE profile_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER revoke_deleted_staff_access AFTER UPDATE OF deleted_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.revoke_deleted_staff_access();
REVOKE ALL ON FUNCTION public.revoke_deleted_staff_access() FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.list_sub_admin_accounts();
CREATE FUNCTION public.list_sub_admin_accounts()
RETURNS TABLE (
  id uuid, full_name text, avatar_url text, phone text, secondary_phone text,
  is_active boolean, created_at timestamptz, login_email text, sub_admin_label text,
  is_open_account boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles AS caller WHERE caller.id = auth.uid() AND caller.role = 'admin' AND caller.is_active) THEN
    RAISE EXCEPTION 'Only active full administrators can view staff login details' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT profile.id, profile.full_name, profile.avatar_url, profile.phone,
    profile.secondary_phone, profile.is_active, profile.created_at, account.email::text,
    profile.sub_admin_label, profile.is_open_account
  FROM public.profiles AS profile JOIN auth.users AS account ON account.id = profile.id
  WHERE profile.role = 'sub_admin' AND account.deleted_at IS NULL
  ORDER BY profile.full_name, profile.id;
END;
$$;
REVOKE ALL ON FUNCTION public.list_sub_admin_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_sub_admin_accounts() TO authenticated;
