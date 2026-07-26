/* Add 'system' to attendance_source enum for auto-generated sessions */
DO $$ BEGIN
  ALTER TYPE attendance_source ADD VALUE IF NOT EXISTS 'system';
END $$;
