/* Sync stored student details when a login profile is linked later. */

DROP TRIGGER IF EXISTS sync_student_details_to_profile ON public.students;
CREATE TRIGGER sync_student_details_to_profile
  AFTER UPDATE OF profile_id, photo_url, birth_certificate_path, father_name, mother_name, religion
  ON public.students
  FOR EACH ROW
  WHEN (
    OLD.profile_id IS DISTINCT FROM NEW.profile_id
    OR OLD.photo_url IS DISTINCT FROM NEW.photo_url
    OR OLD.birth_certificate_path IS DISTINCT FROM NEW.birth_certificate_path
    OR OLD.father_name IS DISTINCT FROM NEW.father_name
    OR OLD.mother_name IS DISTINCT FROM NEW.mother_name
    OR OLD.religion IS DISTINCT FROM NEW.religion
  )
  EXECUTE FUNCTION public.sync_student_details_to_profile();
