BEGIN;
CREATE OR REPLACE FUNCTION public.result_student_rank_score(p_exam_id uuid, p_student_id uuid)
RETURNS TABLE(gpa numeric, failed_subjects bigint, complete boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public
AS $score$
  WITH exam_info AS (
    SELECT exam.id, exam.exam_date, exam.status, exam.title,
           exam.count_fourth_subject, type.marks_mode,
           type.name AS exam_type, class.id AS class_id, class.name AS class_name,
           class.grade, class.section, year.name AS academic_year
    FROM public.result_exams AS exam
    JOIN public.result_exam_types AS type ON type.id = exam.exam_type_id
    JOIN public.classes AS class ON class.id = exam.class_id
    JOIN public.academic_years AS year ON year.id = exam.academic_year_id
    WHERE exam.id = p_exam_id AND public.teacher_can_access_exam(exam.id)
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
    WHERE student.id = p_student_id AND public.teacher_can_access_student(student.id)
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
  )
SELECT summary.gpa, summary.failed_subjects,
  EXISTS (SELECT 1 FROM scored) AND NOT EXISTS (
    SELECT 1 FROM scored WHERE NOT is_absent AND (
      (creative_max > 0 AND creative_marks IS NULL) OR
      (written_max > 0 AND written_marks IS NULL) OR
      (practical_max > 0 AND practical_marks IS NULL)
    )
  )
FROM summary;
$score$;
REVOKE ALL ON FUNCTION public.result_student_rank_score(uuid, uuid) FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.build_student_result(uuid,uuid)'::regprocedure) INTO definition;
  definition := replace(definition, chr(13), '');
  IF position(replace($old$ranking AS (
    SELECT student_id, rank() OVER (ORDER BY obtained DESC) AS position,
           count(*) OVER () AS total_students
    FROM all_totals
  )$old$, chr(13), '') IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected report ranking definition was not found';
  END IF;
  EXECUTE replace(definition, replace($old$ranking AS (
    SELECT student_id, rank() OVER (ORDER BY obtained DESC) AS position,
           count(*) OVER () AS total_students
    FROM all_totals
  )$old$, chr(13), ''), replace($new$ranking_scores AS (
    SELECT totals.*, score.gpa, score.failed_subjects, score.complete
    FROM all_totals AS totals
    CROSS JOIN LATERAL public.result_student_rank_score(p_exam_id, totals.student_id) AS score
  ), eligible_positions AS (
    SELECT student_id, rank() OVER (ORDER BY
      CASE WHEN (SELECT marks_mode FROM exam_info) = 'total_only' THEN obtained ELSE gpa END DESC
    ) AS position
    FROM ranking_scores
    WHERE complete AND ((SELECT marks_mode FROM exam_info) = 'total_only' OR (failed_subjects = 0 AND gpa >= 1))
  ), ranking AS (
    SELECT totals.student_id, eligible.position, count(*) OVER () AS total_students
    FROM all_totals AS totals
    LEFT JOIN eligible_positions AS eligible USING (student_id)
  )$new$, chr(13), ''));
END;
$patch$;
COMMIT;
