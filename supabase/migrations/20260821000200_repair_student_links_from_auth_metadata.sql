/* Repair student accounts whose trusted auth metadata identifies an unlinked student row. */

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
