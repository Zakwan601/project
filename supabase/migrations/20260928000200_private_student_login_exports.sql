/* One-time private exports for newly generated student login credentials. */

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-login-exports',
  'student-login-exports',
  false,
  5242880,
  ARRAY['text/csv']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.student_login_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_count integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  downloaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX student_login_exports_created_by_idx
  ON public.student_login_exports (created_by, created_at DESC);
CREATE INDEX student_login_exports_expiry_idx
  ON public.student_login_exports (expires_at)
  WHERE downloaded_at IS NULL;

ALTER TABLE public.student_login_exports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.student_login_exports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.student_login_exports TO service_role;

/* No storage.objects policy is intentional: only the service-role Edge Function
   can create, read, or remove these sensitive files. */

COMMENT ON TABLE public.student_login_exports IS
  'Audit metadata for private, one-time student credential CSV exports. Passwords are stored only inside the temporary Storage object.';
COMMENT ON COLUMN public.student_login_exports.expires_at IS
  'Undownloaded exports expire after 24 hours and are removed during subsequent export requests.';
