BEGIN;
DO $$
DECLARE
  v_admin uuid;
  v_staff uuid := gen_random_uuid();
  v_student uuid;
  v_blocked boolean;
BEGIN
  SELECT id INTO STRICT v_admin FROM public.profiles WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1;
  SELECT id INTO STRICT v_student FROM public.profiles WHERE role = 'student' AND is_active ORDER BY id LIMIT 1;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO auth.users(id, email, encrypted_password, raw_user_meta_data)
    VALUES (v_staff, 'staff-lock-test-' || v_staff || '@example.invalid', 'initial-test-hash', '{"full_name":"Staff lock test"}');
  UPDATE public.profiles SET role = 'sub_admin' WHERE id = v_staff;
  INSERT INTO public.sub_admin_permissions(profile_id, permission_key, can_read) VALUES (v_staff, 'dashboard', true);

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.set_staff_open_account(v_staff, true);
  IF NOT EXISTS (SELECT 1 FROM public.list_sub_admin_accounts() WHERE id = v_staff AND is_open_account) THEN
    RAISE EXCEPTION 'Account list did not expose Open account';
  END IF;

  v_blocked := false;
  BEGIN UPDATE auth.users SET encrypted_password = 'forbidden-test-hash' WHERE id = v_staff;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Open account allowed password replacement'; END IF;
  -- Normal Auth updates must continue to work for login and token refresh.
  UPDATE auth.users SET last_sign_in_at = now(), encrypted_password = encrypted_password WHERE id = v_staff;

  PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF NOT public.has_permission('dashboard', 'read') THEN RAISE EXCEPTION 'Open account lost existing permissions'; END IF;
  v_blocked := false;
  BEGIN PERFORM public.set_staff_open_account(v_staff, false);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Staff could unlock own account through RPC'; END IF;
  v_blocked := false;
  BEGIN UPDATE public.profiles SET is_open_account = false WHERE id = v_staff;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Staff could unlock own account through direct update'; END IF;
  v_blocked := false;
  BEGIN PERFORM public.list_sub_admin_accounts();
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Staff could list private account details'; END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', v_student::text, true);
  v_blocked := false;
  BEGIN PERFORM public.set_staff_open_account(v_staff, false);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Student could unlock a staff account'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.set_staff_open_account(v_staff, false);
  UPDATE auth.users SET encrypted_password = 'allowed-test-hash' WHERE id = v_staff;
  PERFORM public.set_staff_open_account(v_staff, true);
  v_blocked := false;
  BEGIN PERFORM public.set_staff_open_account(v_admin, true);
  EXCEPTION WHEN raise_exception THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Open account was applied to a full administrator'; END IF;

  -- Simulate Auth soft deletion, including password erasure for a locked account.
  UPDATE auth.users SET deleted_at = now(), encrypted_password = '' WHERE id = v_staff;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_staff AND is_active)
     OR EXISTS (SELECT 1 FROM public.sub_admin_permissions WHERE profile_id = v_staff)
     OR EXISTS (SELECT 1 FROM public.list_sub_admin_accounts() WHERE id = v_staff) THEN
    RAISE EXCEPTION 'Deleted staff account retained access or appeared in Access Control';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_staff) THEN RAISE EXCEPTION 'Historical authorship was removed'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF public.has_permission('dashboard', 'read') THEN RAISE EXCEPTION 'Existing JWT retained module access'; END IF;
  v_blocked := false;
  BEGIN UPDATE public.profiles SET is_active = true WHERE id = v_staff;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Deleted account could reactivate itself'; END IF;
  EXECUTE 'RESET ROLE';
END;
$$;
ROLLBACK;
SELECT 'Passed open-account password enforcement, admin-only settings, unchanged login updates and permissions, deletion access revocation, list removal and prevention of reactivation. All fixtures rolled back.' AS verification;
