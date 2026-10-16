/* Login email addresses are available only to active full administrators. */
CREATE OR REPLACE FUNCTION public.list_sub_admin_accounts()
RETURNS TABLE (
  id uuid,
  full_name text,
  avatar_url text,
  phone text,
  secondary_phone text,
  is_active boolean,
  created_at timestamptz,
  login_email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS caller
    WHERE caller.id = auth.uid()
      AND caller.role = 'admin'
      AND caller.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active full administrators can view sub-admin login details'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT profile.id, profile.full_name, profile.avatar_url,
         profile.phone, profile.secondary_phone, profile.is_active,
         profile.created_at, account.email::text
  FROM public.profiles AS profile
  LEFT JOIN auth.users AS account ON account.id = profile.id
  WHERE profile.role = 'sub_admin'
  ORDER BY profile.full_name, profile.id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_sub_admin_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_sub_admin_accounts() TO authenticated;

COMMENT ON FUNCTION public.list_sub_admin_accounts() IS
  'Lists sub-admin account details and current Auth login emails for active full administrators. Does not expose passwords.';
