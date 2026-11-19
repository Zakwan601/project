-- Existing SECURITY DEFINER endpoints must apply the same scope as row policies.
-- Fail if an expected definition has changed instead of silently leaving a bypass.
CREATE FUNCTION public.patch_teacher_scope(p_signature text, p_old text, p_new text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(p_signature::regprocedure) INTO definition;
  IF strpos(definition, p_old) = 0 THEN RAISE EXCEPTION 'Expected scope anchor missing in %: %', p_signature, p_old; END IF;
  EXECUTE replace(definition, p_old, p_new);
END;
$$;

-- Scoped staff can read shared notices/calendars, but cannot change school-wide settings.
SELECT public.patch_teacher_scope('public.has_permission(text,text)', 'SELECT EXISTS (',
  $new$SELECT (NOT public.is_class_restricted_teacher() OR (
    p_permission_key <> 'devices' AND NOT (p_access = 'write' AND p_permission_key IN ('announcements','vacations'))
  )) AND EXISTS ($new$);

-- Parameterized endpoints reject every out-of-scope ID, including mixed bulk requests.
DO $guards$
DECLARE rule record; definition text; body_start integer;
BEGIN
  FOR rule IN SELECT * FROM (VALUES
    ('public.correct_attendance_records(uuid,jsonb,text)',
      $$public.teacher_can_access_session(p_session_id) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_corrections) item WHERE NOT public.teacher_can_access_student((item->>'student_id')::uuid))$$),
    ('public.promote_students(uuid[],uuid,date)',
      $$public.teacher_can_access_class(p_target_class_id) AND NOT EXISTS (SELECT 1 FROM unnest(p_student_ids) s(id) WHERE NOT public.teacher_can_access_student(s.id))$$),
    ('public.assign_students_to_class(uuid[],uuid,date)',
      $$public.teacher_can_access_class(p_target_class_id) AND NOT EXISTS (SELECT 1 FROM unnest(p_student_ids) s(id) WHERE NOT public.teacher_can_access_student(s.id))$$),
    ('public.create_result_exam_routine_entries(uuid,uuid[],date,time without time zone)', $$public.teacher_can_access_exam(p_exam_id)$$),
    ('public.create_result_share_link(uuid,uuid,timestamp with time zone)', $$public.teacher_can_access_exam(p_exam_id) AND public.teacher_can_access_student(p_student_id)$$),
    ('public.get_student_result(uuid,uuid)', $$public.teacher_can_access_exam(p_exam_id) AND public.teacher_can_access_student(p_student_id)$$),
    ('public.get_class_attendance_fine_details(uuid,date,date)', $$public.teacher_can_access_class(p_class_id)$$),
    ('public.get_student_attendance_statistics(uuid)', $$public.teacher_can_access_student(p_student_id)$$),
    ('public.get_student_attendance_fine_details(uuid,date,date)', $$public.teacher_can_access_student(p_student_id)$$),
    ('public.get_student_attendance_exceptions(uuid)', $$public.teacher_can_access_student(p_student_id)$$),
    ('public.get_punch_attendance_status(uuid,date)', $$public.teacher_can_access_student(p_student_id)$$),
    ('public.sync_daily_attendance(date)', $$NOT public.is_class_restricted_teacher()$$),
    ('public.mark_attendance_vacation(date,text,text)', $$NOT public.is_class_restricted_teacher()$$),
    ('public.mark_attendance_vacation_range(date,date,text,text)', $$NOT public.is_class_restricted_teacher()$$),
    ('public.mark_attendance_vacation_range(date,date,text,text,uuid[])', $$NOT public.is_class_restricted_teacher()$$)
  ) rules(signature, expression) LOOP
    SELECT pg_get_functiondef(rule.signature::regprocedure) INTO definition;
    body_start := strpos(definition, 'BEGIN');
    IF body_start = 0 THEN RAISE EXCEPTION 'Expected PL/pgSQL body missing: %', rule.signature; END IF;
    EXECUTE overlay(definition placing format(E'BEGIN\n  IF public.is_class_restricted_teacher() AND NOT (%s) THEN\n    RAISE EXCEPTION ''Access is limited to your assigned classes'' USING ERRCODE = ''42501'';\n  END IF;', rule.expression) FROM body_start FOR 5);
  END LOOP;
END;
$guards$;

SELECT public.patch_teacher_scope('public.can_view_result_exam(uuid)',
  $$SELECT public.has_permission('results', 'read') OR EXISTS ($$,
  $$SELECT (public.has_permission('results', 'read') AND public.teacher_can_access_exam(p_exam_id)) OR EXISTS ($$);
SELECT public.patch_teacher_scope('public.can_view_exam_routine(uuid)',
  $$SELECT public.has_permission('results', 'read') OR EXISTS ($$,
  $$SELECT (public.has_permission('results', 'read') AND public.teacher_can_access_exam(p_exam_id)) OR EXISTS ($$);
SELECT public.patch_teacher_scope('public.can_view_result_mark(uuid,uuid)',
  $$SELECT public.has_permission('results', 'read') OR EXISTS ($$,
  $$SELECT (public.has_permission('results', 'read') AND public.teacher_can_access_student(p_student_id) AND public.teacher_can_access_exam_subject(p_exam_subject_id)) OR EXISTS ($$);
SELECT public.patch_teacher_scope('public.build_student_result(uuid,uuid)',
  'WHERE exam.id = p_exam_id', 'WHERE exam.id = p_exam_id AND public.teacher_can_access_exam(exam.id)');
SELECT public.patch_teacher_scope('public.build_student_result(uuid,uuid)',
  'WHERE student.id = p_student_id', 'WHERE student.id = p_student_id AND public.teacher_can_access_student(student.id)');
SELECT public.patch_teacher_scope('public.student_exam_subject_role(uuid,uuid)',
  'WHERE exam_subject.id = p_exam_subject_id',
  'WHERE exam_subject.id = p_exam_subject_id AND public.teacher_can_access_exam_subject(exam_subject.id) AND public.teacher_can_access_student(p_student_id)');
SELECT public.patch_teacher_scope('public.result_exam_subject_course_key(uuid)',
  'WHERE exam_subject.id = p_exam_subject_id',
  'WHERE exam_subject.id = p_exam_subject_id AND public.teacher_can_access_exam_subject(exam_subject.id)');

SELECT public.patch_teacher_scope('public.get_admin_dashboard(date,date,date)',
  'WHERE session.date BETWEEN p_weekly_start AND p_weekly_end',
  'WHERE session.date BETWEEN p_weekly_start AND p_weekly_end AND public.teacher_can_access_class(session.class_id) AND (record.id IS NULL OR public.teacher_can_access_student(record.student_id))');
SELECT public.patch_teacher_scope('public.get_admin_dashboard(date,date,date)',
  'FROM public.students WHERE is_active = true', 'FROM public.students WHERE is_active = true AND public.teacher_can_access_student(id)');
SELECT public.patch_teacher_scope('public.get_admin_dashboard(date,date,date)',
  'FROM public.classes WHERE is_active = true', 'FROM public.classes WHERE is_active = true AND public.teacher_can_access_class(id)');
SELECT public.patch_teacher_scope('public.get_admin_dashboard(date,date,date)',
  $$WHERE session.date = p_today AND record.status = 'too_late'$$,
  $$WHERE session.date = p_today AND record.status = 'too_late' AND public.teacher_can_access_class(session.class_id) AND public.teacher_can_access_student(record.student_id)$$);
SELECT public.patch_teacher_scope('public.get_admin_daily_presence(date)',
  'WHERE student.is_active AND (enrollment.class_id IS NOT NULL',
  'WHERE student.is_active AND public.teacher_can_access_student(student.id) AND public.teacher_can_access_class(coalesce(enrollment.class_id, student.class_id)) AND (enrollment.class_id IS NOT NULL');
SELECT public.patch_teacher_scope('public.get_admin_daily_presence(date)',
  'WHERE session.date = p_date',
  'WHERE session.date = p_date AND public.teacher_can_access_class(session.class_id) AND public.teacher_can_access_student(record.student_id)');
SELECT public.patch_teacher_scope('public.get_admin_daily_presence(date)',
  'SELECT id FROM public.classes WHERE is_active',
  'SELECT id FROM public.classes WHERE is_active AND public.teacher_can_access_class(id)');
SELECT public.patch_teacher_scope('public.get_class_attendance_fine_details(uuid,date,date)',
  'FROM public.get_class_students_for_period(p_class_id, p_start_date, p_end_date) AS student',
  'FROM public.get_class_students_for_period(p_class_id, p_start_date, p_end_date) AS student WHERE public.teacher_can_access_student(student.id)');

-- A student's earlier records from an unassigned class remain out of scope.
DO $$ DECLARE signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.get_student_attendance_statistics(uuid)',
    'public.get_student_attendance_fine_details(uuid,date,date)',
    'public.get_student_attendance_exceptions(uuid)',
    'public.get_punch_attendance_status(uuid,date)'
  ] LOOP
    PERFORM public.patch_teacher_scope(signature,
      'WHERE record.student_id = p_student_id',
      'WHERE record.student_id = p_student_id AND public.teacher_can_access_session(record.session_id)');
  END LOOP;
END $$;
SELECT public.patch_teacher_scope('public.get_student_attendance_statistics(uuid)',
  $$AND role IN ('admin', 'teacher')$$,
  $$AND (role IN ('admin', 'teacher') OR (role = 'sub_admin' AND public.has_permission('reports','read')))$$);
SELECT public.patch_teacher_scope('public.get_student_attendance_fine_details(uuid,date,date)',
  'WHERE (p_start_date IS NULL OR schedule.exam_date >= p_start_date)',
  'WHERE public.teacher_can_access_exam(exam.id) AND (p_start_date IS NULL OR schedule.exam_date >= p_start_date)');
SELECT public.patch_teacher_scope('public.get_student_attendance_fine_details(uuid,date,date)',
  'WHERE mark.student_id = p_student_id',
  'WHERE mark.student_id = p_student_id AND public.teacher_can_access_exam(exam.id)');
SELECT public.patch_teacher_scope('public.get_absence_notification_status(date)',
  'WHERE session.date = p_date',
  'WHERE session.date = p_date AND public.teacher_can_access_session(session.id) AND public.teacher_can_access_student(record.student_id)');
SELECT public.patch_teacher_scope('public.get_absence_notification_status(date)',
  $$WHERE message.source = 'attendance_absent'$$,
  $$WHERE (NOT public.is_class_restricted_teacher() OR public.teacher_can_access_student(message.student_id)) AND message.source = 'attendance_absent'$$);

DROP FUNCTION public.patch_teacher_scope(text,text,text);
