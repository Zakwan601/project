/* Link result-publication SMS messages to their exam, student, and guardian URL. */

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS result_exam_id uuid REFERENCES public.result_exams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS result_share_link_id uuid REFERENCES public.result_share_links(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_one_result_notification_idx
  ON public.sms_messages (result_exam_id, student_id)
  WHERE source = 'result_published';

CREATE INDEX IF NOT EXISTS sms_messages_result_exam_idx
  ON public.sms_messages (result_exam_id, created_at DESC)
  WHERE result_exam_id IS NOT NULL;

COMMENT ON COLUMN public.sms_messages.result_exam_id IS
  'Exam whose publication generated this guardian notification.';
COMMENT ON COLUMN public.sms_messages.result_share_link_id IS
  'Guardian result link included in this SMS.';
