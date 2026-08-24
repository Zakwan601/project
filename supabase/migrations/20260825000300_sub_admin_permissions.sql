/* Granular, administrator-managed module permissions for sub-admin accounts. */

CREATE TABLE public.sub_admin_permissions (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_key text NOT NULL CHECK (permission_key IN (
    'dashboard',
    'students',
    'classes',
    'attendance',
    'punches',
    'reports',
    'vacations',
    'departure_anomalies',
    'devices',
    'sms_messages',
    'complaints',
    'announcements'
  )),
  can_read boolean NOT NULL DEFAULT false,
  can_write boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, permission_key),
  CONSTRAINT sub_admin_permissions_write_requires_read
    CHECK (can_write = false OR can_read = true)
);

CREATE TRIGGER sub_admin_permissions_updated_at
  BEFORE UPDATE ON public.sub_admin_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sub_admin_permissions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_permission(
  p_permission_key text,
  p_access text DEFAULT 'read'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND (
        profile.role = 'admin'
        OR (
          profile.role = 'sub_admin'
          AND EXISTS (
            SELECT 1
            FROM public.sub_admin_permissions AS permission
            WHERE permission.profile_id = profile.id
              AND permission.permission_key = p_permission_key
              AND CASE
                WHEN p_access = 'write' THEN permission.can_write
                ELSE permission.can_read
              END
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_permission(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(text, text) TO authenticated, service_role;

CREATE POLICY sub_admin_permissions_select
  ON public.sub_admin_permissions
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

CREATE POLICY sub_admin_permissions_admin_insert
  ON public.sub_admin_permissions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ));

CREATE POLICY sub_admin_permissions_admin_update
  ON public.sub_admin_permissions
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ));

CREATE POLICY sub_admin_permissions_admin_delete
  ON public.sub_admin_permissions
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ));

CREATE OR REPLACE FUNCTION public.set_account_access_role(
  p_profile_id uuid,
  p_role text
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active administrator can assign access roles';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot change their own access role';
  END IF;

  IF p_role NOT IN ('student', 'sub_admin') THEN
    RAISE EXCEPTION 'Role must be student or sub_admin';
  END IF;

  UPDATE public.profiles
  SET role = p_role::public.user_role
  WHERE id = p_profile_id
    AND role <> 'admin'
  RETURNING * INTO v_profile;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Eligible profile not found';
  END IF;

  IF p_role = 'student' THEN
    DELETE FROM public.sub_admin_permissions WHERE profile_id = p_profile_id;
  END IF;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.set_account_access_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_account_access_role(uuid, text) TO authenticated;

COMMENT ON TABLE public.sub_admin_permissions IS
  'Administrator-assigned read and write grants for sub-admin modules.';
COMMENT ON FUNCTION public.has_permission(text, text) IS
  'Returns true for active admins or sub-admins holding the requested module grant.';

CREATE OR REPLACE FUNCTION public.set_sub_admin_permissions(
  p_profile_id uuid,
  p_permissions jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active administrator can assign permissions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_profile_id AND role = 'sub_admin'
  ) THEN
    RAISE EXCEPTION 'Sub-admin profile not found';
  END IF;

  IF jsonb_typeof(COALESCE(p_permissions, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Permissions must be an array';
  END IF;

  DELETE FROM public.sub_admin_permissions WHERE profile_id = p_profile_id;

  INSERT INTO public.sub_admin_permissions (
    profile_id,
    permission_key,
    can_read,
    can_write
  )
  SELECT
    p_profile_id,
    item.permission_key,
    item.can_read OR item.can_write,
    item.can_write
  FROM jsonb_to_recordset(COALESCE(p_permissions, '[]'::jsonb)) AS item(
    permission_key text,
    can_read boolean,
    can_write boolean
  )
  WHERE item.can_read OR item.can_write;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_sub_admin_permissions(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_sub_admin_permissions(uuid, jsonb) TO authenticated;
