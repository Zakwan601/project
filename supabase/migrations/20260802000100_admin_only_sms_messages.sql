/*
  SMS delivery history is confidential and may only be read by the active
  administrator account. A restrictive policy ensures this remains true even
  if another permissive SELECT policy is added later.
*/
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sms_messages FROM anon;
GRANT SELECT ON TABLE public.sms_messages TO authenticated;

DROP POLICY IF EXISTS "Active admins can view SMS messages" ON public.sms_messages;
DROP POLICY IF EXISTS "Only active admins may read SMS messages" ON public.sms_messages;

CREATE POLICY "Active admins can view SMS messages"
ON public.sms_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
      AND profiles.is_active = true
  )
);

CREATE POLICY "Only active admins may read SMS messages"
ON public.sms_messages
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
      AND profiles.is_active = true
  )
);

COMMENT ON POLICY "Only active admins may read SMS messages" ON public.sms_messages IS
  'Restrictive guard preventing non-admin access even if another SELECT policy exists.';
