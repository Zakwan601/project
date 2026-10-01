/*
  On an exam-only date, attendance records whether a student came for the
  examination, not whether they met the normal class arrival cutoff.

  Any non-manually-corrected biometric record with a punch is therefore
  Present for a class assigned to an exam-only routine row. Exam + classes
  dates continue to use the normal Present / Late / Too Late cutoffs.
*/
CREATE OR REPLACE FUNCTION public.classify_biometric_arrival_cutoff()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_arrival_date date;
  v_arrival_time time;
  v_exam_only_day boolean;
BEGIN
  IF NEW.manually_corrected = true THEN
    RETURN NEW;
  END IF;

  IF NEW.biometric_verified = true AND NEW.check_in_at IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.attendance_sessions AS attendance_session
      JOIN public.result_exams AS exam
        ON exam.class_id = attendance_session.class_id
      JOIN public.result_exam_schedule_classes AS schedule_class
        ON schedule_class.exam_id = exam.id
      JOIN public.result_exam_schedules AS schedule
        ON schedule.id = schedule_class.schedule_id
       AND schedule.exam_date = attendance_session.date
      WHERE attendance_session.id = NEW.session_id
        AND schedule.has_regular_classes = false
    )
    INTO v_exam_only_day;

    IF v_exam_only_day THEN
      NEW.status := 'present'::public.attendance_status;
      NEW.remarks := 'Biometric attendance verified - exam-only day';
      RETURN NEW;
    END IF;

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

/*
  Correct the affected Class 12 exam-only attendance for 01 October 2026.
  Students without a punch stay Absent, and audited manual corrections are
  preserved.
*/
UPDATE public.attendance_records AS record
SET
  status = 'present'::public.attendance_status,
  remarks = 'Biometric attendance verified - exam-only day'
FROM public.attendance_sessions AS attendance_session
WHERE attendance_session.id = record.session_id
  AND attendance_session.date = DATE '2026-10-01'
  AND record.biometric_verified = true
  AND record.check_in_at IS NOT NULL
  AND record.manually_corrected = false
  AND EXISTS (
    SELECT 1
    FROM public.result_exams AS exam
    JOIN public.result_exam_schedule_classes AS schedule_class
      ON schedule_class.exam_id = exam.id
    JOIN public.result_exam_schedules AS schedule
      ON schedule.id = schedule_class.schedule_id
     AND schedule.exam_date = attendance_session.date
    WHERE exam.class_id = attendance_session.class_id
      AND schedule.has_regular_classes = false
  );

COMMENT ON FUNCTION public.classify_biometric_arrival_cutoff() IS
  'Marks any biometric punch Present on an exam-only date; Exam + classes and normal dates retain the standard arrival cutoffs.';

COMMENT ON COLUMN public.attendance_records.check_in_at IS
  'First matched biometric punch. On exam-only dates any punch is Present; other dates use the configured attendance cutoffs.';
