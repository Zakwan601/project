/*
  Prospectively classify biometric arrivals after 09:00 Asia/Dhaka as Too Late.
  Existing attendance rows are intentionally not updated.
*/
CREATE OR REPLACE FUNCTION public.classify_biometric_arrival_cutoff()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_arrival_date date;
  v_arrival_time time;
BEGIN
  IF NEW.manually_corrected = true THEN
    RETURN NEW;
  END IF;

  IF NEW.biometric_verified = true AND NEW.check_in_at IS NOT NULL THEN
    v_arrival_date := (NEW.check_in_at AT TIME ZONE 'Asia/Dhaka')::date;
    v_arrival_time := (NEW.check_in_at AT TIME ZONE 'Asia/Dhaka')::time;

    IF v_arrival_date >= DATE '2026-09-27' THEN
      IF v_arrival_time > TIME '09:00:00' THEN
        NEW.status := 'too_late'::public.attendance_status;
        NEW.remarks := 'Too late arrival after 09:00';
      ELSIF v_arrival_time > TIME '08:20:00' THEN
        NEW.status := 'late'::public.attendance_status;
        NEW.remarks := 'Late arrival after the 08:20 attendance cutoff';
      ELSE
        NEW.status := 'present'::public.attendance_status;
        NEW.remarks := 'Biometric attendance verified';
      END IF;
    ELSIF v_arrival_date >= DATE '2026-08-26'
      AND v_arrival_time > TIME '08:20:00' THEN
      NEW.status := 'late'::public.attendance_status;
      NEW.remarks := 'Late arrival after the 08:20 attendance cutoff';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.classify_biometric_arrival_cutoff() IS
  'From 2026-09-27, classifies biometric arrivals through 08:20 as present, through 09:00 as late, and after 09:00 as too late; earlier records retain their prior rules.';

COMMENT ON COLUMN public.attendance_records.check_in_at IS
  'First matched biometric punch. From 2026-09-27, arrivals after 09:00 Asia/Dhaka are too late and count as absent.';

CREATE FUNCTION public.replace_too_late_counting_text(
  p_signature text,
  p_old text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_oid oid;
  v_definition text;
BEGIN
  v_oid := to_regprocedure(p_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Required function % was not found', p_signature;
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;
  IF strpos(v_definition, p_old) = 0 THEN
    RAISE EXCEPTION 'Expected absence expression was not found in %', p_signature;
  END IF;

  EXECUTE replace(v_definition, p_old, p_new);
END;
$$;

SELECT public.replace_too_late_counting_text(
  'public.get_class_attendance_report(uuid,date,date)',
  'COUNT(*) FILTER (WHERE record.status = ''absent'')::integer AS absent',
  'COUNT(*) FILTER (WHERE record.status IN (''absent'', ''too_late''))::integer AS absent'
);

SELECT public.replace_too_late_counting_text(
  'public.get_student_attendance_statistics(uuid)',
  'COUNT(*) FILTER (WHERE record.status = ''absent'')::integer AS absent',
  'COUNT(*) FILTER (WHERE record.status IN (''absent'', ''too_late''))::integer AS absent'
);

SELECT public.replace_too_late_counting_text(
  'public.get_admin_dashboard(date,date,date)',
  'COUNT(record.id) FILTER (WHERE record.status = ''absent'')::integer AS absent',
  'COUNT(record.id) FILTER (WHERE record.status IN (''absent'', ''too_late''))::integer AS absent'
);

SELECT public.replace_too_late_counting_text(
  'public.get_daily_attendance_report(date,date)',
  'COUNT(record.id) FILTER (WHERE record.status = ''absent'') AS absent_count',
  'COUNT(record.id) FILTER (WHERE record.status IN (''absent'', ''too_late'')) AS absent_count'
);

SELECT public.replace_too_late_counting_text(
  'public.get_absence_notification_status(date)',
  'AND record.status = ''absent''',
  'AND record.status IN (''absent'', ''too_late'')'
);

DROP FUNCTION public.replace_too_late_counting_text(text, text, text);

COMMENT ON FUNCTION public.get_class_attendance_report(uuid, date, date) IS
  'Returns class attendance counts. Too Late is included in absent totals; present, late, and approved leave count as attended.';
COMMENT ON FUNCTION public.get_student_attendance_statistics(uuid) IS
  'Returns student attendance statistics and fine rate. Too Late is included in absent totals.';
COMMENT ON FUNCTION public.get_admin_dashboard(date, date, date) IS
  'Returns the authorized admin dashboard. Too Late is included in absent totals and attendance rates.';
