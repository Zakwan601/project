BEGIN;
ALTER TABLE public.students
  ADD COLUMN student_phone text,
  ADD COLUMN present_address text,
  ADD COLUMN permanent_address text;

-- Records may be created by administrators before the student completes a profile.
-- Completion is required at the student portal gate, while invalid supplied data is rejected here.
ALTER TABLE public.students
  ADD CONSTRAINT students_student_phone_check CHECK (
    student_phone IS NULL OR regexp_replace(student_phone, '[[:space:]()-]', '', 'g') ~ '^(\+?88)?01[3-9][0-9]{8}$'
  ),
  ADD CONSTRAINT students_present_address_check CHECK (present_address IS NULL OR (length(present_address) BETWEEN 1 AND 1000 AND present_address ~ '[^[:space:]]')),
  ADD CONSTRAINT students_permanent_address_check CHECK (permanent_address IS NULL OR (length(permanent_address) BETWEEN 1 AND 1000 AND permanent_address ~ '[^[:space:]]'));

COMMENT ON COLUMN public.students.student_phone IS 'Student-owned Bangladesh mobile number, required for student profile completion; distinct from the guardian phone.';
COMMENT ON COLUMN public.students.present_address IS 'Current residential address, required for student profile completion.';
COMMENT ON COLUMN public.students.permanent_address IS 'Permanent residential address, required for student profile completion.';

ALTER TABLE public.student_profile_review_notices DROP CONSTRAINT student_profile_review_notices_field_key_check;
ALTER TABLE public.student_profile_review_notices ADD CONSTRAINT student_profile_review_notices_field_key_check
  CHECK (field_key IN ('photo_url', 'birth_certificate_path', 'father_name', 'mother_name', 'blood_group', 'secondary_phone', 'subjects', 'student_phone', 'present_address', 'permanent_address'));

CREATE OR REPLACE FUNCTION public.track_student_profile_corrections()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_field text;
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  v_admin boolean;
  v_subjects_changed boolean := false;
  v_subjects_removed boolean := false;
  v_subjects_complete boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active) INTO v_admin;
  IF NOT v_admin AND auth.uid() IS DISTINCT FROM NEW.profile_id THEN RETURN NEW; END IF;
  FOREACH v_field IN ARRAY ARRAY['photo_url', 'birth_certificate_path', 'father_name', 'mother_name', 'blood_group', 'student_phone', 'present_address', 'permanent_address', 'secondary_phone'] LOOP
    IF v_old -> v_field IS DISTINCT FROM v_new -> v_field THEN
      IF v_admin AND nullif(btrim(v_old ->> v_field), '') IS NOT NULL AND nullif(btrim(v_new ->> v_field), '') IS NULL THEN
        INSERT INTO public.student_profile_review_notices(student_id, field_key, created_by)
        VALUES (NEW.id, v_field, auth.uid())
        ON CONFLICT (student_id, field_key) DO UPDATE SET reason = NULL, created_by = EXCLUDED.created_by, created_at = now();
      ELSIF auth.uid() = NEW.profile_id AND nullif(btrim(v_new ->> v_field), '') IS NOT NULL THEN
        DELETE FROM public.student_profile_review_notices WHERE student_id = NEW.id AND field_key = v_field;
      END IF;
    END IF;
  END LOOP;
  FOREACH v_field IN ARRAY ARRAY['fourth_subject_id', 'optional_subject_2_id', 'group_elective_option_id', 'group_fourth_option_id', 'humanities_main_option_1_id', 'humanities_main_option_2_id', 'humanities_main_option_3_id', 'humanities_fourth_option_id'] LOOP
    IF v_old -> v_field IS DISTINCT FROM v_new -> v_field THEN
      v_subjects_changed := true;
      IF nullif(v_old ->> v_field, '') IS NOT NULL AND nullif(v_new ->> v_field, '') IS NULL THEN v_subjects_removed := true; END IF;
    END IF;
  END LOOP;
  IF v_admin AND v_subjects_removed THEN
    INSERT INTO public.student_profile_review_notices(student_id, field_key, created_by)
    VALUES (NEW.id, 'subjects', auth.uid())
    ON CONFLICT (student_id, field_key) DO UPDATE SET reason = NULL, created_by = EXCLUDED.created_by, created_at = now();
  ELSIF auth.uid() = NEW.profile_id AND v_subjects_changed THEN
    v_subjects_complete := NEW.group_fourth_option_id IS NOT NULL
      AND CASE NEW.class_group
        WHEN 'science' THEN true
        WHEN 'business' THEN NEW.group_elective_option_id IS NOT NULL AND NEW.group_elective_option_id <> NEW.group_fourth_option_id
        WHEN 'humanities' THEN NEW.humanities_main_option_1_id IS NOT NULL AND NEW.humanities_main_option_2_id IS NOT NULL AND NEW.humanities_main_option_3_id IS NOT NULL
          AND (SELECT count(DISTINCT id) = 4 FROM unnest(ARRAY[NEW.humanities_main_option_1_id, NEW.humanities_main_option_2_id, NEW.humanities_main_option_3_id, NEW.group_fourth_option_id]) ids(id))
        ELSE false END;
    IF v_subjects_complete THEN
      DELETE FROM public.student_profile_review_notices WHERE student_id = NEW.id AND field_key = 'subjects';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_student_profile_details(p_student_id uuid, p_fields text[], p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_field text;
  v_columns text[] := ARRAY[]::text[];
  v_assignment text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active) THEN
    RAISE EXCEPTION 'Only active administrators can remove student profile information';
  END IF;
  IF coalesce(cardinality(p_fields), 0) = 0 THEN RAISE EXCEPTION 'Select information to remove'; END IF;
  IF length(p_reason) > 500 THEN RAISE EXCEPTION 'Use 500 characters or fewer for the reason'; END IF;
  PERFORM 1 FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;
  FOREACH v_field IN ARRAY p_fields LOOP
    IF v_field = 'subjects' THEN
      v_columns := v_columns || ARRAY['fourth_subject_id', 'optional_subject_2_id', 'group_elective_option_id', 'group_fourth_option_id', 'humanities_main_option_1_id', 'humanities_main_option_2_id', 'humanities_main_option_3_id', 'humanities_fourth_option_id'];
    ELSIF v_field = ANY(ARRAY['photo_url', 'birth_certificate_path', 'father_name', 'mother_name', 'blood_group', 'student_phone', 'present_address', 'permanent_address', 'secondary_phone']) THEN
      v_columns := array_append(v_columns, v_field);
    ELSE RAISE EXCEPTION 'Select a supported student profile field'; END IF;
  END LOOP;
  SELECT string_agg(format('%I = NULL', field), ', ') INTO v_assignment FROM (SELECT DISTINCT unnest(v_columns) AS field) fields;
  EXECUTE format('UPDATE public.students SET %s WHERE id = $1', v_assignment) USING p_student_id;
  UPDATE public.student_profile_review_notices SET reason = nullif(btrim(p_reason), '')
  WHERE student_id = p_student_id AND field_key = ANY(p_fields);
END;
$$;

COMMIT;
