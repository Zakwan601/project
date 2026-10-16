/* Existing configurations retain total-only passing until section thresholds are set. */
ALTER TABLE public.result_exam_subjects
  ADD COLUMN creative_pass_mark numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN written_pass_mark numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN practical_pass_mark numeric(6,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT result_exam_subjects_section_pass_marks_check CHECK (
    creative_pass_mark >= 0 AND creative_pass_mark <= creative_max
    AND written_pass_mark >= 0 AND written_pass_mark <= written_max
    AND practical_pass_mark >= 0 AND practical_pass_mark <= practical_max
  );

COMMENT ON COLUMN public.result_exam_subjects.creative_pass_mark IS
  'Minimum Creative/CQ marks required separately from the total. Zero preserves legacy total-only rules.';
COMMENT ON COLUMN public.result_exam_subjects.written_pass_mark IS
  'Minimum MCQ marks required separately from the total. Zero preserves legacy total-only rules.';
COMMENT ON COLUMN public.result_exam_subjects.practical_pass_mark IS
  'Minimum Practical marks required separately from the total. Zero preserves legacy total-only rules.';

CREATE OR REPLACE FUNCTION public.result_sections_passed(
  p_creative numeric,
  p_written numeric,
  p_practical numeric,
  p_creative_pass numeric,
  p_written_pass numeric,
  p_practical_pass numeric
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(p_creative, 0) >= p_creative_pass
     AND COALESCE(p_written, 0) >= p_written_pass
     AND COALESCE(p_practical, 0) >= p_practical_pass;
$$;

REVOKE ALL ON FUNCTION public.result_sections_passed(numeric, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.result_sections_passed(numeric, numeric, numeric, numeric, numeric, numeric)
  TO authenticated, service_role;

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
           exam_subject.pass_mark, exam_subject.creative_pass_mark,
           exam_subject.written_pass_mark, exam_subject.practical_pass_mark,
           mark.creative_marks, mark.written_marks,
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
      (NOT is_absent AND obtained >= pass_mark AND public.result_sections_passed(creative_marks, written_marks, practical_marks,
        creative_pass_mark, written_pass_mark, practical_pass_mark)) AS passed,
      CASE WHEN is_absent OR obtained < pass_mark OR NOT public.result_sections_passed(creative_marks, written_marks, practical_marks,
        creative_pass_mark, written_pass_mark, practical_pass_mark) THEN 'F'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 80 THEN 'A+'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 70 THEN 'A'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 60 THEN 'A-'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 50 THEN 'B'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 40 THEN 'C'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 33 THEN 'D' ELSE 'F' END AS letter_grade,
      CASE WHEN is_absent OR obtained < pass_mark OR NOT public.result_sections_passed(creative_marks, written_marks, practical_marks,
        creative_pass_mark, written_pass_mark, practical_pass_mark) THEN 0
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
           sum(COALESCE(creative_marks, 0)) AS creative_marks,
           sum(COALESCE(written_marks, 0)) AS written_marks,
           sum(COALESCE(practical_marks, 0)) AS practical_marks,
           sum(creative_pass_mark) AS creative_pass_mark,
           sum(written_pass_mark) AS written_pass_mark,
           sum(practical_pass_mark) AS practical_pass_mark,
           bool_or(is_absent) AS is_absent
    FROM scored
    GROUP BY course_key, subject_role
  ), course_graded AS (
    SELECT course_scores.*,
      (NOT is_absent AND obtained >= pass_mark AND public.result_sections_passed(creative_marks, written_marks, practical_marks,
        creative_pass_mark, written_pass_mark, practical_pass_mark)) AS passed,
      CASE WHEN is_absent OR obtained < pass_mark OR NOT public.result_sections_passed(creative_marks, written_marks, practical_marks,
        creative_pass_mark, written_pass_mark, practical_pass_mark) THEN 0
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
      'pass_mark', pass_mark,
      'creative_pass_mark', creative_pass_mark,
      'written_pass_mark', written_pass_mark,
      'practical_pass_mark', practical_pass_mark,
      'obtained', obtained, 'total_max', total_max,
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
  'Builds results using separate section and total passing requirements, six main courses, and the configured fourth-subject bonus.';
