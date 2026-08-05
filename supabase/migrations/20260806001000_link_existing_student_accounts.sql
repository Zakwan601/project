/* Safely connect an existing Supabase Auth student account to a student row. */

CREATE UNIQUE INDEX IF NOT EXISTS students_profile_id_unique_idx
  ON public.students (profile_id)
  WHERE profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.link_student_account_by_email(
  p_student_id uuid,
  p_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active administrators can link student accounts';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student record not found';
  END IF;

  SELECT user_account.id
  INTO v_profile_id
  FROM auth.users AS user_account
  JOIN public.profiles AS profile ON profile.id = user_account.id
  WHERE lower(user_account.email) = lower(btrim(p_email))
    AND profile.role = 'student'
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No existing student login was found for this email';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.students
    WHERE profile_id = v_profile_id AND id <> p_student_id
  ) THEN
    RAISE EXCEPTION 'This login is already linked to another student';
  END IF;

  UPDATE public.students
  SET profile_id = v_profile_id
  WHERE id = p_student_id;

  RETURN v_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_student_account_by_email(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_student_account_by_email(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.link_student_account_by_email(uuid, text) IS
  'Admin-only repair path for linking an existing Auth student to its student record.';
