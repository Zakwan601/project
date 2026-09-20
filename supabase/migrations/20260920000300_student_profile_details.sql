/* Store student profile details even before a login account is created. */

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS birth_certificate_path text,
  ADD COLUMN IF NOT EXISTS father_name text,
  ADD COLUMN IF NOT EXISTS mother_name text,
  ADD COLUMN IF NOT EXISTS religion text;

UPDATE public.students AS student
SET
  photo_url = COALESCE(student.photo_url, profile.avatar_url),
  birth_certificate_path = COALESCE(student.birth_certificate_path, profile.birth_certificate_path),
  father_name = COALESCE(student.father_name, profile.father_name),
  mother_name = COALESCE(student.mother_name, profile.mother_name),
  religion = COALESCE(student.religion, profile.religion)
FROM public.profiles AS profile
WHERE profile.id = student.profile_id;

CREATE OR REPLACE FUNCTION public.sync_profile_details_to_student()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.students
  SET
    photo_url = NEW.avatar_url,
    birth_certificate_path = NEW.birth_certificate_path,
    father_name = NEW.father_name,
    mother_name = NEW.mother_name,
    religion = NEW.religion
  WHERE profile_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_details_to_student ON public.profiles;
CREATE TRIGGER sync_profile_details_to_student
  AFTER UPDATE OF avatar_url, birth_certificate_path, father_name, mother_name, religion
  ON public.profiles
  FOR EACH ROW
  WHEN (
    OLD.avatar_url IS DISTINCT FROM NEW.avatar_url
    OR OLD.birth_certificate_path IS DISTINCT FROM NEW.birth_certificate_path
    OR OLD.father_name IS DISTINCT FROM NEW.father_name
    OR OLD.mother_name IS DISTINCT FROM NEW.mother_name
    OR OLD.religion IS DISTINCT FROM NEW.religion
  )
  EXECUTE FUNCTION public.sync_profile_details_to_student();

CREATE OR REPLACE FUNCTION public.sync_student_details_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.profile_id IS NOT NULL THEN
    UPDATE public.profiles
    SET
      avatar_url = NEW.photo_url,
      birth_certificate_path = NEW.birth_certificate_path,
      father_name = NEW.father_name,
      mother_name = NEW.mother_name,
      religion = NEW.religion
    WHERE id = NEW.profile_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_student_details_to_profile ON public.students;
CREATE TRIGGER sync_student_details_to_profile
  AFTER UPDATE OF photo_url, birth_certificate_path, father_name, mother_name, religion
  ON public.students
  FOR EACH ROW
  WHEN (
    OLD.photo_url IS DISTINCT FROM NEW.photo_url
    OR OLD.birth_certificate_path IS DISTINCT FROM NEW.birth_certificate_path
    OR OLD.father_name IS DISTINCT FROM NEW.father_name
    OR OLD.mother_name IS DISTINCT FROM NEW.mother_name
    OR OLD.religion IS DISTINCT FROM NEW.religion
  )
  EXECUTE FUNCTION public.sync_student_details_to_profile();
