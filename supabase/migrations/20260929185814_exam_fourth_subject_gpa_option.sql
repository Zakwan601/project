/* Optional fourth-subject GPA bonus, calculated by six subject courses. */

ALTER TABLE public.result_exams
  ADD COLUMN count_fourth_subject boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.student_exam_subject_role(
  p_student_id uuid,
  p_exam_subject_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT subject.is_fourth_subject THEN 'main'
    WHEN exam_subject.subject_id IN (
      fourth_option.first_paper_subject_id,
      fourth_option.second_paper_subject_id,
      student.fourth_subject_id,
      student.optional_subject_2_id
    ) THEN 'fourth'
    WHEN exam_subject.subject_id IN (
      elective.first_paper_subject_id,
      elective.second_paper_subject_id
    ) THEN 'main'
    ELSE NULL
  END
  FROM public.result_exam_subjects AS exam_subject
  JOIN public.subjects AS subject ON subject.id = exam_subject.subject_id
  JOIN public.students AS student ON student.id = p_student_id
  LEFT JOIN public.subject_course_options AS elective
    ON elective.id = student.group_elective_option_id
  LEFT JOIN public.subject_course_options AS fourth_option
    ON fourth_option.id = student.group_fourth_option_id
  WHERE exam_subject.id = p_exam_subject_id;
$$;

CREATE OR REPLACE FUNCTION public.student_takes_exam_subject(
  p_student_id uuid,
  p_exam_subject_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.student_exam_subject_role(p_student_id, p_exam_subject_id) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.result_exam_subject_course_key(p_exam_subject_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    exam_subject.paper_group_id,
    (
      SELECT paper_group.id
      FROM public.result_subject_paper_groups AS paper_group
      WHERE exam_subject.subject_id IN (
        paper_group.first_paper_subject_id,
        paper_group.second_paper_subject_id
      )
      ORDER BY paper_group.created_at
      LIMIT 1
    ),
    exam_subject.subject_id
  )
  FROM public.result_exam_subjects AS exam_subject
  WHERE exam_subject.id = p_exam_subject_id;
$$;

REVOKE ALL ON FUNCTION public.student_exam_subject_role(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.result_exam_subject_course_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_exam_subject_role(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.result_exam_subject_course_key(uuid)
  TO authenticated, service_role;

COMMENT ON COLUMN public.result_exams.count_fourth_subject IS
  'When true, GPA adds max(fourth-subject grade point - 2, 0) to the six main-subject points before dividing by six.';

DROP FUNCTION public.create_result_exams_for_classes(uuid[], uuid, text, date, boolean, boolean);

CREATE FUNCTION public.create_result_exams_for_classes(
  p_class_ids uuid[],
  p_exam_type_id uuid,
  p_title text,
  p_exam_date date,
  p_has_regular_classes boolean,
  p_combine_subject_papers boolean,
  p_count_fourth_subject boolean
)
RETURNS TABLE (exam_id uuid, class_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid := gen_random_uuid();
  v_requested_count integer;
  v_class_count integer;
BEGIN
  IF NOT public.has_permission('results', 'write') THEN
    RAISE EXCEPTION 'You do not have permission to create examinations';
  END IF;

  SELECT count(DISTINCT requested.id) INTO v_requested_count
  FROM unnest(coalesce(p_class_ids, ARRAY[]::uuid[])) AS requested(id);

  IF v_requested_count = 0 THEN RAISE EXCEPTION 'Select at least one class'; END IF;
  IF p_exam_type_id IS NULL OR p_exam_date IS NULL THEN
    RAISE EXCEPTION 'Exam type and reference date are required';
  END IF;

  SELECT count(*) INTO v_class_count
  FROM public.classes AS class
  WHERE class.id IN (SELECT DISTINCT requested.id FROM unnest(p_class_ids) AS requested(id))
    AND class.is_active = true
    AND class.academic_year_id IS NOT NULL;

  IF v_class_count <> v_requested_count THEN
    RAISE EXCEPTION 'One or more selected classes are unavailable';
  END IF;

  RETURN QUERY
  INSERT INTO public.result_exams (
    exam_group_id, class_id, academic_year_id, exam_type_id, title,
    exam_date, has_regular_classes, combine_subject_papers,
    count_fourth_subject, created_by
  )
  SELECT
    v_group_id, class.id, class.academic_year_id, p_exam_type_id,
    nullif(btrim(p_title), ''), p_exam_date, coalesce(p_has_regular_classes, true),
    coalesce(p_combine_subject_papers, false),
    coalesce(p_count_fourth_subject, false), auth.uid()
  FROM public.classes AS class
  WHERE class.id IN (SELECT DISTINCT requested.id FROM unnest(p_class_ids) AS requested(id))
  RETURNING result_exams.id, result_exams.class_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_result_exams_for_classes(
  uuid[], uuid, text, date, boolean, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_result_exams_for_classes(
  uuid[], uuid, text, date, boolean, boolean, boolean
) TO authenticated;

DROP FUNCTION public.update_result_exam_group_settings(uuid, uuid, text, date, boolean, boolean);

CREATE FUNCTION public.update_result_exam_group_settings(
  p_exam_group_id uuid,
  p_exam_type_id uuid,
  p_title text,
  p_exam_date date,
  p_has_regular_classes boolean,
  p_combine_subject_papers boolean,
  p_count_fourth_subject boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_count integer;
  v_current_combined boolean;
  v_requested_combined boolean := coalesce(p_combine_subject_papers, false);
BEGIN
  IF NOT public.has_permission('results', 'write') THEN
    RAISE EXCEPTION 'You do not have permission to edit examinations';
  END IF;

  IF p_exam_group_id IS NULL OR p_exam_type_id IS NULL OR p_exam_date IS NULL THEN
    RAISE EXCEPTION 'Examination, exam type, and reference date are required';
  END IF;

  SELECT count(*), bool_and(exam.combine_subject_papers)
  INTO v_exam_count, v_current_combined
  FROM public.result_exams AS exam
  WHERE exam.exam_group_id = p_exam_group_id;

  IF v_exam_count = 0 THEN RAISE EXCEPTION 'Examination not found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.result_exams
    WHERE exam_group_id = p_exam_group_id AND status <> 'draft'
  ) THEN
    RAISE EXCEPTION 'Published examinations must be returned to draft before editing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.result_exam_types
    WHERE id = p_exam_type_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Select an active exam type';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.result_exams AS exam
    JOIN public.academic_years AS year ON year.id = exam.academic_year_id
    WHERE exam.exam_group_id = p_exam_group_id
      AND (p_exam_date < year.start_date OR p_exam_date > year.end_date)
  ) THEN
    RAISE EXCEPTION 'Reference date must be inside every selected class session';
  END IF;

  IF v_current_combined IS DISTINCT FROM v_requested_combined
     AND (
       EXISTS (
         SELECT 1
         FROM public.result_exam_subjects AS exam_subject
         JOIN public.result_exams AS exam ON exam.id = exam_subject.exam_id
         WHERE exam.exam_group_id = p_exam_group_id
       )
       OR EXISTS (
         SELECT 1 FROM public.result_exam_schedules
         WHERE exam_group_id = p_exam_group_id
       )
     ) THEN
    RAISE EXCEPTION 'Paper mode cannot be changed after subjects or routine rows have been configured';
  END IF;

  IF NOT coalesce(p_has_regular_classes, true)
     AND EXISTS (
       SELECT 1 FROM public.result_exam_schedules
       WHERE exam_group_id = p_exam_group_id AND exam_time IS NULL
     ) THEN
    RAISE EXCEPTION 'Add a time to every routine row before changing this to an exam-only examination';
  END IF;

  UPDATE public.result_exams
  SET exam_type_id = p_exam_type_id,
      title = nullif(btrim(p_title), ''),
      exam_date = p_exam_date,
      has_regular_classes = coalesce(p_has_regular_classes, true),
      combine_subject_papers = v_requested_combined,
      count_fourth_subject = coalesce(p_count_fourth_subject, false)
  WHERE exam_group_id = p_exam_group_id;

  UPDATE public.result_exam_schedules
  SET has_regular_classes = coalesce(p_has_regular_classes, true)
  WHERE exam_group_id = p_exam_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_result_exam_group_settings(
  uuid, uuid, text, date, boolean, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_result_exam_group_settings(
  uuid, uuid, text, date, boolean, boolean, boolean
) TO authenticated;

CREATE OR REPLACE FUNCTION public.build_student_result(p_exam_id uuid, p_student_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH exam_info AS (
    SELECT exam.id, exam.exam_date, exam.status, exam.title,
           exam.count_fourth_subject,
           type.name AS exam_type, class.id AS class_id, class.name AS class_name,
           class.grade, class.section, year.name AS academic_year
    FROM public.result_exams AS exam
    JOIN public.result_exam_types AS type ON type.id = exam.exam_type_id
    JOIN public.classes AS class ON class.id = exam.class_id
    JOIN public.academic_years AS year ON year.id = exam.academic_year_id
    WHERE exam.id = p_exam_id
  ), student_info AS (
    SELECT student.id, student.admission_number,
           trim(student.first_name || ' ' || student.last_name) AS full_name,
           COALESCE(enrollment.roll_number, student.roll_number) AS roll_number
    FROM public.students AS student
    CROSS JOIN exam_info AS exam
    LEFT JOIN public.student_enrollments AS enrollment
      ON enrollment.student_id = student.id AND enrollment.class_id = exam.class_id
      AND enrollment.started_on <= exam.exam_date
      AND (enrollment.ended_on IS NULL OR enrollment.ended_on >= exam.exam_date)
    WHERE student.id = p_student_id
    ORDER BY enrollment.started_on DESC NULLS LAST
    LIMIT 1
  ), scored AS (
    SELECT exam_subject.id,
           COALESCE(paper_group.name, subject.name) AS name,
           COALESCE(paper_group.code, subject.code) AS code,
           exam_subject.sort_order,
           exam_subject.creative_max, exam_subject.written_max, exam_subject.practical_max,
           exam_subject.pass_mark, mark.creative_marks, mark.written_marks,
           mark.practical_marks, COALESCE(mark.is_absent, false) AS is_absent,
           mark.remarks,
           COALESCE(mark.creative_marks, 0) + COALESCE(mark.written_marks, 0) + COALESCE(mark.practical_marks, 0) AS obtained,
           exam_subject.creative_max + exam_subject.written_max + exam_subject.practical_max AS total_max,
           public.student_exam_subject_role(p_student_id, exam_subject.id) AS subject_role,
           public.result_exam_subject_course_key(exam_subject.id) AS course_key
    FROM public.result_exam_subjects AS exam_subject
    JOIN public.subjects AS subject ON subject.id = exam_subject.subject_id
    LEFT JOIN public.result_subject_paper_groups AS paper_group ON paper_group.id = exam_subject.paper_group_id
    LEFT JOIN public.result_marks AS mark
      ON mark.exam_subject_id = exam_subject.id AND mark.student_id = p_student_id
    WHERE exam_subject.exam_id = p_exam_id
      AND public.student_takes_exam_subject(p_student_id, exam_subject.id)
  ), graded AS (
    SELECT scored.*,
      (NOT is_absent AND obtained >= pass_mark) AS passed,
      CASE WHEN is_absent OR obtained < pass_mark THEN 'F'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 80 THEN 'A+'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 70 THEN 'A'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 60 THEN 'A-'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 50 THEN 'B'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 40 THEN 'C'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 33 THEN 'D' ELSE 'F' END AS letter_grade,
      CASE WHEN is_absent OR obtained < pass_mark THEN 0
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 80 THEN 5
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 70 THEN 4
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 60 THEN 3.5
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 50 THEN 3
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 40 THEN 2
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 33 THEN 1 ELSE 0 END::numeric AS grade_point
    FROM scored
  ), course_scores AS (
    SELECT course_key, subject_role,
           sum(obtained) AS obtained,
           sum(total_max) AS total_max,
           sum(pass_mark) AS pass_mark,
           bool_or(is_absent) AS is_absent
    FROM scored
    GROUP BY course_key, subject_role
  ), course_graded AS (
    SELECT course_scores.*,
      (NOT is_absent AND obtained >= pass_mark) AS passed,
      CASE WHEN is_absent OR obtained < pass_mark THEN 0
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 80 THEN 5
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 70 THEN 4
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 60 THEN 3.5
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 50 THEN 3
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 40 THEN 2
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 33 THEN 1 ELSE 0 END::numeric AS grade_point
    FROM course_scores
  ), summary_base AS (
    SELECT
      COALESCE((SELECT sum(obtained) FROM scored), 0) AS total_obtained,
      COALESCE((SELECT sum(total_max) FROM scored), 0) AS total_max,
      count(*) FILTER (WHERE subject_role = 'main' AND NOT passed) AS failed_subjects,
      COALESCE(sum(grade_point) FILTER (WHERE subject_role = 'main'), 0) AS main_grade_points,
      COALESCE(max(grade_point) FILTER (WHERE subject_role = 'fourth'), 0) AS fourth_grade_point
    FROM course_graded
  ), summary AS (
    SELECT summary_base.total_obtained,
           summary_base.total_max,
           summary_base.failed_subjects,
           CASE WHEN summary_base.failed_subjects > 0 THEN 0::numeric
                ELSE least(5::numeric, round((
                  summary_base.main_grade_points
                  + CASE WHEN exam.count_fourth_subject
                      THEN greatest(summary_base.fourth_grade_point - 2, 0)
                      ELSE 0 END
                ) / 6, 2)) END AS gpa
    FROM summary_base
    CROSS JOIN exam_info AS exam
  ), all_totals AS (
    SELECT mark.student_id,
           sum(COALESCE(mark.creative_marks, 0) + COALESCE(mark.written_marks, 0) + COALESCE(mark.practical_marks, 0)) AS obtained
    FROM public.result_marks AS mark
    JOIN public.result_exam_subjects AS exam_subject ON exam_subject.id = mark.exam_subject_id
    WHERE exam_subject.exam_id = p_exam_id
      AND public.student_takes_exam_subject(mark.student_id, exam_subject.id)
    GROUP BY mark.student_id
  ), ranking AS (
    SELECT student_id, rank() OVER (ORDER BY obtained DESC) AS position,
           count(*) OVER () AS total_students
    FROM all_totals
  )
  SELECT jsonb_build_object(
    'exam', (SELECT to_jsonb(exam_info) FROM exam_info),
    'student', (SELECT to_jsonb(student_info) FROM student_info),
    'subjects', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'code', code,
      'creative_max', creative_max, 'creative_marks', creative_marks,
      'written_max', written_max, 'written_marks', written_marks,
      'practical_max', practical_max, 'practical_marks', practical_marks,
      'pass_mark', pass_mark, 'obtained', obtained, 'total_max', total_max,
      'is_absent', is_absent, 'remarks', remarks, 'passed', passed,
      'letter_grade', letter_grade, 'grade_point', grade_point
    ) ORDER BY sort_order, name) FROM graded), '[]'::jsonb),
    'summary', (SELECT jsonb_build_object(
      'total_obtained', total_obtained, 'total_max', total_max,
      'failed_subjects', failed_subjects, 'gpa', gpa,
      'letter_grade', CASE WHEN failed_subjects > 0 OR gpa < 1 THEN 'F'
        WHEN gpa >= 5 THEN 'A+' WHEN gpa >= 4 THEN 'A' WHEN gpa >= 3.5 THEN 'A-'
        WHEN gpa >= 3 THEN 'B' WHEN gpa >= 2 THEN 'C' ELSE 'D' END,
      'position', ranking.position, 'total_students', ranking.total_students
    ) FROM summary LEFT JOIN ranking ON ranking.student_id = p_student_id)
  );
$$;

COMMENT ON FUNCTION public.build_student_result(uuid, uuid) IS
  'Builds a result using six course-level main-subject grade points and the optional fourth-subject bonus selected on the exam.';
