/*
# Hardcode Admin Credentials

## Purpose
Ensures the admin account always exists with known, hardcoded credentials
so the system is usable out of the box without manual Supabase dashboard setup.

## Changes
1. Upserts the admin user in auth.users with a bcrypt-hashed password.
2. Ensures the profiles row exists with role = 'admin'.
3. Idempotent — safe to re-run.

## Credentials
- Email: admin@school.edu
- Password: stored as bcrypt hash in auth.users.encrypted_password

## Security
- The admin password is set via SQL using crypt() + gen_salt('bf').
- The profile is linked to the auth user via the existing trigger.
- No RLS changes needed — profiles already has admin-scoped policies.
*/

DO $$
DECLARE
  admin_id uuid;
  admin_email text := 'admin@school.edu';
  admin_password text := 'Adm1n@EduAtt3nd!';
BEGIN
  -- Check if admin user exists
  SELECT id INTO admin_id FROM auth.users WHERE email = admin_email;

  IF admin_id IS NULL THEN
    -- Create the admin auth user
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      last_sign_in_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      admin_email,
      crypt(admin_password, gen_salt('bf')),
      now(),
      '{"role": "admin"}'::jsonb,
      '{"full_name": "System Administrator", "role": "admin"}'::jsonb,
      now(),
      now(),
      now()
    )
    RETURNING id INTO admin_id;
  ELSE
    -- Update existing admin user's password and metadata
    UPDATE auth.users
    SET
      encrypted_password = crypt(admin_password, gen_salt('bf')),
      email_confirmed_at = now(),
      raw_app_meta_data = '{"role": "admin"}'::jsonb,
      raw_user_meta_data = '{"full_name": "System Administrator", "role": "admin"}'::jsonb,
      updated_at = now()
    WHERE id = admin_id;
  END IF;

  -- Ensure the admin profile exists with role = 'admin'
  INSERT INTO public.profiles (id, role, full_name, is_active)
  VALUES (admin_id, 'admin'::user_role, 'System Administrator', true)
  ON CONFLICT (id) DO UPDATE
  SET role = 'admin'::user_role, full_name = 'System Administrator', is_active = true;
END;
$$;
