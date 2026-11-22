-- Original routine scans are public documents, matching public timetable access.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('class-routines', 'class-routines', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY class_routine_images_admin ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'class-routines' AND EXISTS (
  SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active
))
WITH CHECK (bucket_id = 'class-routines' AND EXISTS (
  SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active
));

ALTER TABLE public.class_routine_settings ADD COLUMN download_path text
CHECK (download_path IS NULL OR (
  length(download_path) BETWEEN 1 AND 240
  AND download_path ~ '^[a-zA-Z0-9][a-zA-Z0-9_./-]*\.(jpg|jpeg|png|webp)$'
  AND download_path NOT LIKE '%..%'
));
-- get_public_class_routines already returns settings with to_jsonb(s), so this
-- field follows the selected class without changing or duplicating the RPC.
