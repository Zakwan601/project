/* Add subject_name text column to routine_slots for free-text entry */
ALTER TABLE routine_slots ADD COLUMN IF NOT EXISTS subject_name text;
