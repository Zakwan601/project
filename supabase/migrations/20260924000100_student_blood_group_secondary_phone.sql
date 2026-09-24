/* Replace religion with blood group and add an optional secondary mobile number. */

DROP TRIGGER IF EXISTS sync_profile_details_to_student ON public.profiles;
DROP TRIGGER IF EXISTS sync_student_details_to_profile ON public.students;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS blood_group text,
  ADD COLUMN IF NOT EXISTS secondary_phone text;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS blood_group text,
  ADD COLUMN IF NOT EXISTS secondary_phone text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_blood_group_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_blood_group_check
  CHECK (blood_group IS NULL OR blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_blood_group_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_blood_group_check
  CHECK (blood_group IS NULL OR blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));

UPDATE public.students AS student
SET
  blood_group = COALESCE(student.blood_group, profile.blood_group),
  secondary_phone = COALESCE(student.secondary_phone, profile.secondary_phone)
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
    blood_group = NEW.blood_group,
    secondary_phone = NEW.secondary_phone
  WHERE profile_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_profile_details_to_student
  AFTER UPDATE OF avatar_url, birth_certificate_path, father_name, mother_name, blood_group, secondary_phone
  ON public.profiles
  FOR EACH ROW
  WHEN (
    OLD.avatar_url IS DISTINCT FROM NEW.avatar_url
    OR OLD.birth_certificate_path IS DISTINCT FROM NEW.birth_certificate_path
    OR OLD.father_name IS DISTINCT FROM NEW.father_name
    OR OLD.mother_name IS DISTINCT FROM NEW.mother_name
    OR OLD.blood_group IS DISTINCT FROM NEW.blood_group
    OR OLD.secondary_phone IS DISTINCT FROM NEW.secondary_phone
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
      blood_group = NEW.blood_group,
      secondary_phone = NEW.secondary_phone
    WHERE id = NEW.profile_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_student_details_to_profile
  AFTER UPDATE OF profile_id, photo_url, birth_certificate_path, father_name, mother_name, blood_group, secondary_phone
  ON public.students
  FOR EACH ROW
  WHEN (
    OLD.profile_id IS DISTINCT FROM NEW.profile_id
    OR OLD.photo_url IS DISTINCT FROM NEW.photo_url
    OR OLD.birth_certificate_path IS DISTINCT FROM NEW.birth_certificate_path
    OR OLD.father_name IS DISTINCT FROM NEW.father_name
    OR OLD.mother_name IS DISTINCT FROM NEW.mother_name
    OR OLD.blood_group IS DISTINCT FROM NEW.blood_group
    OR OLD.secondary_phone IS DISTINCT FROM NEW.secondary_phone
  )
  EXECUTE FUNCTION public.sync_student_details_to_profile();

ALTER TABLE public.profiles DROP COLUMN IF EXISTS religion;
ALTER TABLE public.students DROP COLUMN IF EXISTS religion;

COMMENT ON COLUMN public.profiles.blood_group IS 'Optional standard ABO/Rh blood group.';
COMMENT ON COLUMN public.students.blood_group IS 'Optional standard ABO/Rh blood group.';
COMMENT ON COLUMN public.profiles.secondary_phone IS 'Optional secondary Bangladesh mobile number.';
COMMENT ON COLUMN public.students.secondary_phone IS 'Optional secondary Bangladesh mobile number.';
