/* Keep a linked profile's display name in sync with student name edits, including bulk updates. */

DROP TRIGGER IF EXISTS sync_student_details_to_profile ON public.students;

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
      full_name = trim(concat_ws(' ', NEW.first_name, NEW.last_name)),
      avatar_url = NEW.photo_url,
      birth_certificate_path = NEW.birth_certificate_path,
      father_name = NEW.father_name,
      mother_name = NEW.mother_name,
      blood_group = NEW.blood_group,
      secondary_phone = NEW.secondary_phone
    WHERE id = NEW.profile_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_student_details_to_profile
  AFTER UPDATE OF profile_id, first_name, last_name, photo_url, birth_certificate_path, father_name, mother_name, blood_group, secondary_phone
  ON public.students
  FOR EACH ROW
  WHEN (
    OLD.profile_id IS DISTINCT FROM NEW.profile_id
    OR OLD.first_name IS DISTINCT FROM NEW.first_name
    OR OLD.last_name IS DISTINCT FROM NEW.last_name
    OR OLD.photo_url IS DISTINCT FROM NEW.photo_url
    OR OLD.birth_certificate_path IS DISTINCT FROM NEW.birth_certificate_path
    OR OLD.father_name IS DISTINCT FROM NEW.father_name
    OR OLD.mother_name IS DISTINCT FROM NEW.mother_name
    OR OLD.blood_group IS DISTINCT FROM NEW.blood_group
    OR OLD.secondary_phone IS DISTINCT FROM NEW.secondary_phone
  )
  EXECUTE FUNCTION public.sync_student_details_to_profile();