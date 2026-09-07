/* Guarded historical correction requested for students 228, 414, and 612. */
DO $correction$
DECLARE
  v_student record;
  v_session record;
  v_sep7_session_id uuid;
  v_record_id uuid;
  v_old_status public.attendance_status;
  v_new_status public.attendance_status;
  v_first_punch timestamptz;
  v_second_punch timestamptz;
  v_changed integer := 0;
  v_target_count integer;
BEGIN
  SELECT count(*) INTO v_target_count FROM public.students
  WHERE admission_number IN ('228', '414', '612');
  IF v_target_count <> 3 THEN
    RAISE EXCEPTION 'Expected exactly students 228, 414, and 612; found % target rows', v_target_count;
  END IF;

  FOR v_student IN
    SELECT id, admission_number, btrim(first_name || ' ' || last_name) AS name
    FROM public.students WHERE admission_number IN ('228', '414', '612')
    ORDER BY admission_number
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.device_logs AS log
      WHERE log.student_biometric_id = v_student.admission_number
        AND (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date >= DATE '2026-08-23'
        AND (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date < DATE '2026-09-07'
    ) THEN
      RAISE EXCEPTION 'Student % has a biometric punch before 2026-09-07; correction cancelled', v_student.admission_number;
    END IF;

    FOR v_session IN
      SELECT session.id, session.date FROM public.attendance_sessions AS session
      WHERE session.class_id = public.get_student_class_on_date(v_student.id, session.date)
        AND session.date BETWEEN DATE '2026-08-23' AND DATE '2026-09-06'
      ORDER BY session.date
    LOOP
      SELECT record.id, record.status INTO v_record_id, v_old_status
      FROM public.attendance_records AS record
      WHERE record.session_id = v_session.id AND record.student_id = v_student.id
      FOR UPDATE;

      IF v_record_id IS NULL THEN
        INSERT INTO public.attendance_records (
          session_id, student_id, status, biometric_verified, remarks, marked_at,
          check_in_at, check_out_at, manually_corrected, corrected_at, correction_reason
        ) VALUES (
          v_session.id, v_student.id, 'absent', false,
          'Historical correction: absent before first recorded attendance', now(),
          NULL, NULL, true, now(), 'Historical attendance correction requested by administrator'
        ) RETURNING id INTO v_record_id;
        v_old_status := NULL;
      ELSIF v_old_status <> 'absent'::public.attendance_status THEN
        UPDATE public.attendance_records SET
          status = 'absent', biometric_verified = false,
          remarks = 'Historical correction: absent before first recorded attendance',
          marked_at = now(), check_in_at = NULL, check_out_at = NULL,
          manually_corrected = true, corrected_at = now(),
          correction_reason = 'Historical attendance correction requested by administrator'
        WHERE id = v_record_id;
      ELSE
        v_record_id := NULL;
      END IF;

      IF v_record_id IS NOT NULL THEN
        INSERT INTO public.attendance_correction_audit (
          attendance_record_id, session_id, student_id, old_status, new_status, reason, corrected_by
        ) VALUES (
          v_record_id, v_session.id, v_student.id, v_old_status, 'absent',
          'Historical attendance correction requested by administrator', NULL
        );
        v_changed := v_changed + 1;
        RAISE NOTICE 'Student % (%) %: % -> absent', v_student.admission_number,
          v_student.name, v_session.date, COALESCE(v_old_status::text, 'missing');
      END IF;
      v_record_id := NULL;
      v_old_status := NULL;
    END LOOP;

    SELECT min(log.punched_at), (array_agg(log.punched_at ORDER BY log.punched_at, log.id))[2]
    INTO v_first_punch, v_second_punch FROM public.device_logs AS log
    WHERE log.student_biometric_id = v_student.admission_number
      AND (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date = DATE '2026-09-07';
    IF v_first_punch IS NULL THEN
      RAISE EXCEPTION 'Student % has no biometric punch on 2026-09-07', v_student.admission_number;
    END IF;

    SELECT session.id INTO v_sep7_session_id FROM public.attendance_sessions AS session
    WHERE session.class_id = public.get_student_class_on_date(v_student.id, session.date)
      AND session.date = DATE '2026-09-07';
    IF v_sep7_session_id IS NULL THEN
      RAISE EXCEPTION 'Student % has no class session on 2026-09-07', v_student.admission_number;
    END IF;

    v_new_status := CASE WHEN (v_first_punch AT TIME ZONE 'Asia/Dhaka')::time > TIME '08:20:00'
      THEN 'late'::public.attendance_status ELSE 'present'::public.attendance_status END;
    SELECT record.id, record.status INTO v_record_id, v_old_status
    FROM public.attendance_records AS record
    WHERE record.session_id = v_sep7_session_id AND record.student_id = v_student.id FOR UPDATE;

    IF v_record_id IS NULL THEN
      INSERT INTO public.attendance_records (
        session_id, student_id, status, biometric_verified, remarks, marked_at,
        check_in_at, check_out_at, manually_corrected, corrected_at, correction_reason
      ) VALUES (
        v_sep7_session_id, v_student.id, v_new_status, true,
        CASE WHEN v_new_status = 'late' THEN 'Late arrival after the 08:20 attendance cutoff'
             ELSE 'Synchronized from daily biometric punches' END,
        v_first_punch, v_first_punch, v_second_punch, true, now(),
        'Attendance confirmed from biometric punches on 2026-09-07'
      ) RETURNING id INTO v_record_id;
      v_old_status := NULL;
    ELSE
      UPDATE public.attendance_records SET
        status = v_new_status, biometric_verified = true,
        remarks = CASE WHEN v_new_status = 'late' THEN 'Late arrival after the 08:20 attendance cutoff'
                       ELSE 'Synchronized from daily biometric punches' END,
        marked_at = v_first_punch, check_in_at = v_first_punch, check_out_at = v_second_punch,
        manually_corrected = true, corrected_at = now(),
        correction_reason = 'Attendance confirmed from biometric punches on 2026-09-07'
      WHERE id = v_record_id;
    END IF;

    INSERT INTO public.attendance_correction_audit (
      attendance_record_id, session_id, student_id, old_status, new_status, reason, corrected_by
    ) VALUES (
      v_record_id, v_sep7_session_id, v_student.id, v_old_status, v_new_status,
      'Attendance confirmed from biometric punches on 2026-09-07', NULL
    );
    v_changed := v_changed + 1;
    RAISE NOTICE 'Student % (%) 2026-09-07 at %: % -> %', v_student.admission_number,
      v_student.name, to_char(v_first_punch AT TIME ZONE 'Asia/Dhaka', 'HH24:MI:SS'),
      COALESCE(v_old_status::text, 'missing'), v_new_status;
  END LOOP;
  RAISE NOTICE 'Attendance correction completed with % audited changes', v_changed;
END
$correction$;
