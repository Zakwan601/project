/* Keep raw SMS delivery callbacks private to trusted backend services. */

ALTER TABLE public.sms_dlr_events ENABLE ROW LEVEL SECURITY;

/*
 * The Automas DLR Edge Functions authenticate the provider callback with
 * AUTOMAS_DLR_SECRET and write with SUPABASE_SERVICE_ROLE_KEY. Browser roles
 * do not need direct access to raw request bodies, headers, or phone numbers.
 */
REVOKE ALL ON TABLE public.sms_dlr_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.sms_dlr_events_id_seq FROM anon, authenticated;

GRANT ALL ON TABLE public.sms_dlr_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sms_dlr_events_id_seq TO service_role;

COMMENT ON TABLE public.sms_dlr_events IS
  'Raw SMS delivery callbacks; accessible only to trusted service-role backends.';
