-- This is a catalogue designation only; grading remains unchanged for now.
ALTER TABLE public.subjects
  ADD COLUMN is_fourth_subject boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subjects.is_fourth_subject IS
  'Marks this group subject as a fourth subject; result grading does not yet use this flag.';
