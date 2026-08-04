/* Simple administrator announcements shown on the student dashboard. */

CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 2000),
  expires_at date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcements_active_created_idx
  ON public.announcements(is_active, created_at DESC);

DROP TRIGGER IF EXISTS announcements_updated_at ON public.announcements;
CREATE TRIGGER announcements_updated_at
BEFORE UPDATE ON public.announcements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view current announcements"
  ON public.announcements;
CREATE POLICY "Authenticated users can view current announcements"
ON public.announcements
FOR SELECT TO authenticated
USING (
  (
    is_active = true
    AND (expires_at IS NULL OR expires_at >= (now() AT TIME ZONE 'Asia/Dhaka')::date)
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);

DROP POLICY IF EXISTS "Active admins can create announcements"
  ON public.announcements;
CREATE POLICY "Active admins can create announcements"
ON public.announcements
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);

DROP POLICY IF EXISTS "Active admins can update announcements"
  ON public.announcements;
CREATE POLICY "Active admins can update announcements"
ON public.announcements
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);

DROP POLICY IF EXISTS "Active admins can delete announcements"
  ON public.announcements;
CREATE POLICY "Active admins can delete announcements"
ON public.announcements
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);
