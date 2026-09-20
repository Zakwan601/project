/* Optional personal profile details and directly uploaded profile documents. */

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birth_certificate_path text,
  ADD COLUMN IF NOT EXISTS father_name text,
  ADD COLUMN IF NOT EXISTS mother_name text,
  ADD COLUMN IF NOT EXISTS religion text;

COMMENT ON COLUMN public.profiles.birth_certificate_path IS
  'Private storage object path in the birth-certificates bucket.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-images', 'profile-images', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('birth-certificates', 'birth-certificates', false, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "profile_images_insert_own" ON storage.objects;
CREATE POLICY "profile_images_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-images' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "profile_images_delete_own" ON storage.objects;
CREATE POLICY "profile_images_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'profile-images' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "birth_certificates_select_own" ON storage.objects;
CREATE POLICY "birth_certificates_select_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'birth-certificates' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "birth_certificates_insert_own" ON storage.objects;
CREATE POLICY "birth_certificates_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'birth-certificates' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "birth_certificates_delete_own" ON storage.objects;
CREATE POLICY "birth_certificates_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'birth-certificates' AND (storage.foldername(name))[1] = auth.uid()::text);
