/* Add the status separately so PostgreSQL can commit it before functions use it. */
ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'too_late' AFTER 'late';
