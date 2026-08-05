/* Remove the superseded profile phone workflow; student guardian_phone is canonical. */

DROP FUNCTION IF EXISTS public.review_phone_change_request(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.verify_student_phone(uuid);
DROP TRIGGER IF EXISTS protect_profile_phone_verification ON public.profiles;
DROP FUNCTION IF EXISTS public.protect_profile_phone_verification();
DROP TABLE IF EXISTS public.phone_change_requests;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS phone_verified_by,
  DROP COLUMN IF EXISTS phone_verified_at;
