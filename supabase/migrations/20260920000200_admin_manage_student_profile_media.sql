/* Allow active administrators to manage student profile media. */

DROP POLICY IF EXISTS "profile_images_manage_admin" ON storage.objects;
CREATE POLICY "profile_images_manage_admin"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
        AND is_active = true
    )
  )
  WITH CHECK (
    bucket_id = 'profile-images'
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
        AND is_active = true
    )
  );

DROP POLICY IF EXISTS "birth_certificates_manage_admin" ON storage.objects;
CREATE POLICY "birth_certificates_manage_admin"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'birth-certificates'
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
        AND is_active = true
    )
  )
  WITH CHECK (
    bucket_id = 'birth-certificates'
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
        AND is_active = true
    )
  );
