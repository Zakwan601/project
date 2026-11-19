CREATE TABLE public.teacher_class_assignments (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, class_id)
);
CREATE INDEX teacher_class_assignments_class_idx ON public.teacher_class_assignments(class_id);
ALTER TABLE public.teacher_class_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY teacher_assignments_read ON public.teacher_class_assignments FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active
  ));
-- Writes go through the validated administrator-only RPC.
REVOKE INSERT, UPDATE, DELETE ON public.teacher_class_assignments FROM authenticated, anon;
GRANT SELECT ON public.teacher_class_assignments TO authenticated;

CREATE FUNCTION public.is_class_restricted_teacher()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.role() IS DISTINCT FROM 'service_role' AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'sub_admin' AND sub_admin_label = 'teacher'
  );
$$;
CREATE FUNCTION public.teacher_can_access_class(p_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_class_restricted_teacher() OR EXISTS (
    SELECT 1 FROM public.teacher_class_assignments a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.profile_id = auth.uid() AND a.class_id = p_class_id AND p.is_active
  );
$$;
CREATE FUNCTION public.teacher_can_access_student(p_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_class_restricted_teacher() OR EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = p_student_id AND public.teacher_can_access_class(s.class_id)
  );
$$;
CREATE FUNCTION public.teacher_can_access_session(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_class_restricted_teacher() OR EXISTS (
    SELECT 1 FROM public.attendance_sessions s WHERE s.id = p_session_id AND public.teacher_can_access_class(s.class_id)
  );
$$;
CREATE FUNCTION public.teacher_can_access_exam(p_exam_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_class_restricted_teacher() OR EXISTS (
    SELECT 1 FROM public.result_exams e WHERE e.id = p_exam_id AND public.teacher_can_access_class(e.class_id)
  );
$$;
CREATE FUNCTION public.teacher_can_access_exam_subject(p_exam_subject_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_class_restricted_teacher() OR EXISTS (
    SELECT 1 FROM public.result_exam_subjects e WHERE e.id = p_exam_subject_id AND public.teacher_can_access_exam(e.exam_id)
  );
$$;
CREATE FUNCTION public.teacher_can_access_profile(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_class_restricted_teacher() OR p_profile_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.students s WHERE s.profile_id = p_profile_id AND public.teacher_can_access_class(s.class_id)
  );
$$;
CREATE FUNCTION public.teacher_can_access_schedule(p_schedule_id uuid, p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_class_restricted_teacher() OR (
    EXISTS (SELECT 1 FROM public.result_exam_schedule_classes l
      WHERE l.schedule_id = p_schedule_id AND public.teacher_can_access_exam(l.exam_id))
    AND (NOT p_write OR NOT EXISTS (SELECT 1 FROM public.result_exam_schedule_classes l
      WHERE l.schedule_id = p_schedule_id AND NOT public.teacher_can_access_exam(l.exam_id)))
  );
$$;
DO $$ DECLARE signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'is_class_restricted_teacher()', 'teacher_can_access_class(uuid)', 'teacher_can_access_student(uuid)',
    'teacher_can_access_session(uuid)', 'teacher_can_access_exam(uuid)', 'teacher_can_access_exam_subject(uuid)',
    'teacher_can_access_profile(uuid)', 'teacher_can_access_schedule(uuid,boolean)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || signature || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || signature || ' TO anon, authenticated, service_role';
  END LOOP;
END $$;

CREATE FUNCTION public.set_teacher_classes(p_profile_id uuid, p_class_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active) THEN
    RAISE EXCEPTION 'Only an active full administrator can assign teacher classes' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = p_profile_id AND role = 'sub_admin' AND sub_admin_label = 'teacher' AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active teacher account'; END IF;
  IF p_class_ids IS NULL OR array_position(p_class_ids, NULL) IS NOT NULL OR EXISTS (
    SELECT 1 FROM unnest(p_class_ids) requested(id) LEFT JOIN public.classes c ON c.id = requested.id WHERE c.id IS NULL
  ) THEN RAISE EXCEPTION 'Choose valid classes'; END IF;
  DELETE FROM public.teacher_class_assignments WHERE profile_id = p_profile_id;
  INSERT INTO public.teacher_class_assignments(profile_id, class_id)
    SELECT p_profile_id, id FROM (SELECT DISTINCT unnest(p_class_ids) AS id) requested;
END;
$$;
REVOKE ALL ON FUNCTION public.set_teacher_classes(uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_teacher_classes(uuid,uuid[]) TO authenticated;

-- Restrictive policies intersect with existing module grants; they never add permissions.
DO $policies$
DECLARE rule record;
BEGIN
  FOR rule IN SELECT * FROM (VALUES
    ('classes', 'public.teacher_can_access_class(id)'),
    ('students', 'public.teacher_can_access_class(class_id)'),
    ('student_enrollments', 'public.teacher_can_access_class(class_id) AND public.teacher_can_access_student(student_id)'),
    ('profiles', 'public.teacher_can_access_profile(id)'),
    ('academic_years', 'NOT public.is_class_restricted_teacher() OR EXISTS (SELECT 1 FROM public.teacher_class_assignments a JOIN public.classes c ON c.id = a.class_id WHERE a.profile_id = auth.uid() AND c.academic_year_id = academic_years.id)'),
    ('attendance_sessions', 'public.teacher_can_access_class(class_id)'),
    ('attendance_records', 'public.teacher_can_access_session(session_id) AND public.teacher_can_access_student(student_id)'),
    ('attendance_correction_audit', 'public.teacher_can_access_session(session_id) AND public.teacher_can_access_student(student_id)'),
    ('device_logs', 'NOT public.is_class_restricted_teacher() OR EXISTS (SELECT 1 FROM public.students s WHERE s.admission_number = device_logs.student_biometric_id AND public.teacher_can_access_class(s.class_id))'),
    ('device_log_archive_runs', 'public.teacher_can_access_class(class_id)'),
    ('student_reports', 'public.teacher_can_access_student(student_id)'),
    ('student_profile_review_notices', 'public.teacher_can_access_student(student_id)'),
    ('class_departure_analysis_settings', 'public.teacher_can_access_class(class_id)'),
    ('class_daily_dismissal_times', 'public.teacher_can_access_class(class_id)'),
    ('student_departure_anomaly_reports', 'public.teacher_can_access_class(class_id)'),
    ('result_exams', 'public.teacher_can_access_class(class_id)'),
    ('result_exam_subjects', 'public.teacher_can_access_exam(exam_id)'),
    ('result_marks', 'public.teacher_can_access_exam_subject(exam_subject_id) AND public.teacher_can_access_student(student_id)'),
    ('result_share_links', 'public.teacher_can_access_exam(exam_id) AND public.teacher_can_access_student(student_id)'),
    ('result_exam_schedule_classes', 'public.teacher_can_access_exam(exam_id)'),
    ('sms_messages', 'NOT public.is_class_restricted_teacher() OR (student_id IS NOT NULL AND public.teacher_can_access_student(student_id))'),
    ('sms_dlr_events', 'NOT public.is_class_restricted_teacher() OR EXISTS (SELECT 1 FROM public.sms_messages m WHERE m.id = sms_dlr_events.sms_message_id)'),
    ('devices', 'NOT public.is_class_restricted_teacher()'),
    ('student_login_exports', 'NOT public.is_class_restricted_teacher()')
  ) scope_rules(table_name, expression) LOOP
    EXECUTE format('CREATE POLICY teacher_class_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)', rule.table_name, rule.expression, rule.expression);
  END LOOP;
END;
$policies$;
CREATE POLICY teacher_schedule_read ON public.result_exam_schedules AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.teacher_can_access_schedule(id));
CREATE POLICY teacher_schedule_update ON public.result_exam_schedules AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.teacher_can_access_schedule(id, true)) WITH CHECK (public.teacher_can_access_schedule(id, true));
CREATE POLICY teacher_schedule_delete ON public.result_exam_schedules AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.teacher_can_access_schedule(id, true));
-- Teachers create routine rows through the class-checked routine RPC, avoiding orphan/global rows.
CREATE POLICY teacher_schedule_insert ON public.result_exam_schedules AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_class_restricted_teacher());
CREATE POLICY teacher_routine_link_insert ON public.result_exam_schedule_classes AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_class_restricted_teacher());
CREATE POLICY teacher_routine_link_update ON public.result_exam_schedule_classes AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.teacher_can_access_exam(exam_id))
  WITH CHECK (public.teacher_can_access_exam(exam_id) AND public.teacher_can_access_schedule(schedule_id, true));
CREATE POLICY teacher_holiday_read ON public.holidays AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.is_class_restricted_teacher() OR class_ids IS NULL OR EXISTS (SELECT 1 FROM unnest(class_ids) c(id) WHERE public.teacher_can_access_class(c.id)));

-- Shared school configuration is readable where granted, but not editable by class-bound accounts.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['holidays','announcements','academic_years','result_exam_types','subjects','subject_course_options','result_subject_paper_groups'] LOOP
    EXECUTE format('CREATE POLICY teacher_global_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.is_class_restricted_teacher())', t);
    EXECUTE format('CREATE POLICY teacher_global_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_class_restricted_teacher()) WITH CHECK (NOT public.is_class_restricted_teacher())', t);
    EXECUTE format('CREATE POLICY teacher_global_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_class_restricted_teacher())', t);
  END LOOP;
END $$;

COMMENT ON COLUMN public.profiles.sub_admin_label IS
  'Administrator-selected account type. Teacher accounts are additionally restricted to teacher_class_assignments; sub-administrators use module permissions across classes.';
