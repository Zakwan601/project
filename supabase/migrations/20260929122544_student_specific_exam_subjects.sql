/* Apply configured elective/fourth-subject choices to examination marks and reports. */

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
  SELECT COALESCE(
    NOT subject.is_fourth_subject
    OR exam_subject.subject_id IN (
      student.fourth_subject_id,
      student.optional_subject_2_id,
      elective.first_paper_subject_id,
      elective.second_paper_subject_id,
      fourth_option.first_paper_subject_id,
      fourth_option.second_paper_subject_id
    ),
    false
  )
  FROM public.result_exam_subjects AS exam_subject
  JOIN public.subjects AS subject ON subject.id = exam_subject.subject_id
  JOIN public.students AS student ON student.id = p_student_id
  LEFT JOIN public.subject_course_options AS elective
    ON elective.id = student.group_elective_option_id
  LEFT JOIN public.subject_course_options AS fourth_option
    ON fourth_option.id = student.group_fourth_option_id
  WHERE exam_subject.id = p_exam_subject_id;
$$;

REVOKE ALL ON FUNCTION public.student_takes_exam_subject(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_takes_exam_subject(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_result_marks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_config public.result_exam_subjects;
  v_exam public.result_exams;
BEGIN
  SELECT * INTO v_config FROM public.result_exam_subjects WHERE id = NEW.exam_subject_id;
  SELECT exam.* INTO v_exam
  FROM public.result_exams AS exam WHERE exam.id = v_config.exam_id;

  IF v_exam.status = 'published' THEN
    RAISE EXCEPTION 'Unpublish this result before changing marks';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.student_enrollments AS enrollment
    WHERE enrollment.student_id = NEW.student_id
      AND enrollment.class_id = v_exam.class_id
      AND enrollment.started_on <= v_exam.exam_date
      AND (enrollment.ended_on IS NULL OR enrollment.ended_on >= v_exam.exam_date)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.students AS student
    WHERE student.id = NEW.student_id AND student.class_id = v_exam.class_id
  ) THEN
    RAISE EXCEPTION 'Student was not enrolled in the exam class';
  END IF;
  IF NOT public.student_takes_exam_subject(NEW.student_id, NEW.exam_subject_id) THEN
    RAISE EXCEPTION 'This subject is not assigned to the student';
  END IF;
  IF NEW.creative_marks > v_config.creative_max
     OR NEW.written_marks > v_config.written_max
     OR NEW.practical_marks > v_config.practical_max THEN
    RAISE EXCEPTION 'Marks cannot exceed the configured maximum';
  END IF;
  IF NEW.is_absent THEN
    NEW.creative_marks := NULL;
    NEW.written_marks := NULL;
    NEW.practical_marks := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.build_student_result(p_exam_id uuid, p_student_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH exam_info AS (
    SELECT exam.id, exam.exam_date, exam.status, exam.title,
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
           exam_subject.creative_max + exam_subject.written_max + exam_subject.practical_max AS total_max
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
  ), summary AS (
    SELECT COALESCE(sum(obtained), 0) AS total_obtained,
           COALESCE(sum(total_max), 0) AS total_max,
           count(*) FILTER (WHERE NOT passed) AS failed_subjects,
           CASE WHEN count(*) = 0 OR count(*) FILTER (WHERE NOT passed) > 0 THEN 0
                ELSE round(avg(grade_point), 2) END AS gpa
    FROM graded
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

COMMENT ON FUNCTION public.student_takes_exam_subject(uuid, uuid) IS
  'Returns whether a configured exam subject is compulsory or belongs to the student selected elective/fourth course.';

CREATE OR REPLACE FUNCTION public.validate_result_exam()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_year_id uuid;
  v_start date;
  v_end date;
BEGIN
  SELECT class.academic_year_id, year.start_date, year.end_date
  INTO v_year_id, v_start, v_end
  FROM public.classes AS class
  JOIN public.academic_years AS year ON year.id = class.academic_year_id
  WHERE class.id = NEW.class_id;

  IF v_year_id IS NULL OR NEW.academic_year_id <> v_year_id THEN
    RAISE EXCEPTION 'Exam academic year must match the selected class';
  END IF;
  IF NEW.exam_date < v_start OR NEW.exam_date > v_end THEN
    RAISE EXCEPTION 'Exam date must fall within the class academic session';
  END IF;
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    IF NOT EXISTS (SELECT 1 FROM public.result_exam_subjects WHERE exam_id = NEW.id) THEN
      RAISE EXCEPTION 'Add at least one subject before publishing results';
    END IF;
    IF EXISTS (
      WITH roster AS (
        SELECT DISTINCT student.id
        FROM public.students AS student
        WHERE student.is_active = true AND (
          EXISTS (
            SELECT 1 FROM public.student_enrollments AS enrollment
            WHERE enrollment.student_id = student.id
              AND enrollment.class_id = NEW.class_id
              AND enrollment.started_on <= NEW.exam_date
              AND (enrollment.ended_on IS NULL OR enrollment.ended_on >= NEW.exam_date)
          )
          OR (
            student.class_id = NEW.class_id
            AND NOT EXISTS (SELECT 1 FROM public.student_enrollments WHERE student_id = student.id)
          )
        )
      )
      SELECT 1
      FROM roster
      CROSS JOIN public.result_exam_subjects AS exam_subject
      LEFT JOIN public.result_marks AS mark
        ON mark.exam_subject_id = exam_subject.id AND mark.student_id = roster.id
      WHERE exam_subject.exam_id = NEW.id
        AND public.student_takes_exam_subject(roster.id, exam_subject.id)
        AND (
          mark.id IS NULL
          OR (NOT mark.is_absent AND (
            (exam_subject.creative_max > 0 AND mark.creative_marks IS NULL)
            OR (exam_subject.written_max > 0 AND mark.written_marks IS NULL)
            OR (exam_subject.practical_max > 0 AND mark.practical_marks IS NULL)
          ))
        )
    ) THEN
      RAISE EXCEPTION 'Enter marks or mark absent for every student and assigned subject before publishing';
    END IF;
    NEW.published_at := now();
  ELSIF NEW.status = 'draft' THEN
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
