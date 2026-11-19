-- Cache request-wide permission checks once per statement, not once per punch.
-- The predicates and row-dependent class restrictions remain in force.
DO $policies$
DECLARE rule record; expression text; check_expression text;
BEGIN
  FOR rule IN SELECT * FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN ('device_logs','students','classes','student_enrollments','attendance_sessions','attendance_records')
    AND policyname IN ('teacher_class_scope','sub_admin_read_guard','sub_admin_read_grant')
  LOOP
    expression := rule.qual;
    check_expression := rule.with_check;
    IF rule.policyname = 'teacher_class_scope' THEN
      expression := 'NOT (SELECT public.is_class_restricted_teacher()) OR (' || expression || ')';
      IF check_expression IS NOT NULL THEN
        check_expression := 'NOT (SELECT public.is_class_restricted_teacher()) OR (' || check_expression || ')';
      END IF;
    ELSE
      expression := replace(expression, 'current_user_is_sub_admin()', '(SELECT public.current_user_is_sub_admin())');
      expression := regexp_replace(expression,
        'has_permission\(''([^'']+)''::text, ''([^'']+)''::text\)',
        '(SELECT public.has_permission(''\1'', ''\2''))', 'g');
    END IF;
    EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', rule.policyname, rule.tablename, expression);
    IF check_expression IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', rule.policyname, rule.tablename, check_expression);
    END IF;
  END LOOP;
END;
$policies$;

-- Build the visible biometric-ID set once instead of a correlated student lookup per log.
ALTER POLICY teacher_class_scope ON public.device_logs
  USING (NOT (SELECT public.is_class_restricted_teacher())
    OR student_biometric_id IN (SELECT admission_number FROM public.students))
  WITH CHECK (NOT (SELECT public.is_class_restricted_teacher())
    OR student_biometric_id IN (SELECT admission_number FROM public.students));

CREATE INDEX device_logs_daily_page_idx ON public.device_logs
  (((punched_at AT TIME ZONE 'Asia/Dhaka')::date) DESC, student_biometric_id, punched_at, id);

CREATE OR REPLACE FUNCTION public.search_daily_punches_page(
  p_class_id uuid,
  p_date date DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_student_biometric_id text DEFAULT NULL,
  p_search text DEFAULT ''
)
RETURNS TABLE (
  student_biometric_id text, punch_date date, punch_ids uuid[], punch_times timestamptz[],
  first_name text, last_name text, photo_url text,
  attendance_status public.attendance_status, total_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH days AS MATERIALIZED (
    SELECT log.student_biometric_id,
      (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date AS punch_date,
      min(log.punched_at) AS first_punch_at
    FROM public.device_logs log
    WHERE (p_student_biometric_id IS NULL OR log.student_biometric_id = p_student_biometric_id)
      AND (p_date IS NULL OR (
        log.punched_at >= (p_date::timestamp AT TIME ZONE 'Asia/Dhaka')
        AND log.punched_at < ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')
      ))
    GROUP BY log.student_biometric_id, (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date
  ), matched AS MATERIALIZED (
    SELECT day.*, student.id AS student_id, student.first_name, student.last_name, student.photo_url
    FROM days day LEFT JOIN public.students student ON student.admission_number = day.student_biometric_id
    WHERE (p_class_id IS NULL OR public.get_student_class_on_date(student.id, day.punch_date) = p_class_id)
      AND (coalesce(btrim(p_search), '') = '' OR strpos(
        lower(concat_ws(' ', day.student_biometric_id, student.first_name, student.last_name)),
        lower(btrim(p_search))
      ) > 0)
  ), page AS MATERIALIZED (
    SELECT matched.*, count(*) OVER () AS total_count FROM matched
    ORDER BY punch_date DESC, first_punch_at DESC, student_biometric_id
    LIMIT least(greatest(p_page_size, 1), 100)
    OFFSET (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  )
  SELECT page.student_biometric_id, page.punch_date, detail.punch_ids, detail.punch_times,
    page.first_name, page.last_name, page.photo_url,
    public.get_punch_attendance_status(page.student_id, page.punch_date), page.total_count
  FROM page CROSS JOIN LATERAL (
    SELECT array_agg(log.id ORDER BY log.punched_at, log.id) AS punch_ids,
      array_agg(log.punched_at ORDER BY log.punched_at, log.id) AS punch_times
    FROM public.device_logs log
    WHERE log.student_biometric_id = page.student_biometric_id
      AND (log.punched_at AT TIME ZONE 'Asia/Dhaka')::date = page.punch_date
  ) detail
  ORDER BY page.punch_date DESC, page.first_punch_at DESC, page.student_biometric_id;
$$;
COMMENT ON FUNCTION public.search_daily_punches_page(uuid,date,integer,integer,text,text) IS
  'RLS-protected daily punch pagination. Counts lightweight student-day keys, applies historical-class and literal text filters, then fetches ordered punch arrays and attendance status only for the requested page.';
