/* Explicitly document the only role allowed to access raw DLR events. */

DROP POLICY IF EXISTS "Service role manages SMS DLR events"
  ON public.sms_dlr_events;

CREATE POLICY "Service role manages SMS DLR events"
ON public.sms_dlr_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON POLICY "Service role manages SMS DLR events"
  ON public.sms_dlr_events IS
  'DLR Edge Functions authenticate callbacks and write with the service role.';
