/* Remove student personal fields that are no longer collected or used. */

ALTER TABLE public.students
  DROP COLUMN IF EXISTS date_of_birth,
  DROP COLUMN IF EXISTS guardian_name,
  DROP COLUMN IF EXISTS guardian_email,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS gender;

/* Restore any login links detached by older student-edit payloads. */
UPDATE public.students AS student
SET profile_id = account.id
FROM auth.users AS account
JOIN public.profiles AS profile
  ON profile.id = account.id
 AND profile.role = 'student'
WHERE student.id = CASE
    WHEN COALESCE(account.raw_user_meta_data ->> 'student_id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN (account.raw_user_meta_data ->> 'student_id')::uuid
    ELSE NULL
  END
  AND student.profile_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.students AS already_linked
    WHERE already_linked.profile_id = account.id
  );

COMMENT ON COLUMN public.students.profile_id IS
  'Auth/profile UUID for the student login; required when a student has login credentials.';
