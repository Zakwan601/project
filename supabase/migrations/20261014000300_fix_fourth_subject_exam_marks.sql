/* Keep mark entry and result generation aware of fourth subjects in combined-paper exams. */
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
    WHEN EXISTS (
      SELECT 1
      FROM (VALUES
        (exam_subject.subject_id),
        (paper_group.first_paper_subject_id),
        (paper_group.second_paper_subject_id)
      ) AS represented(subject_id)
      WHERE represented.subject_id IN (
        fourth_option.first_paper_subject_id,
        fourth_option.second_paper_subject_id,
        student.fourth_subject_id,
        student.optional_subject_2_id
      )
    ) THEN 'fourth'
    WHEN EXISTS (
      SELECT 1
      FROM (VALUES
        (exam_subject.subject_id),
        (paper_group.first_paper_subject_id),
        (paper_group.second_paper_subject_id)
      ) AS represented(subject_id)
      WHERE represented.subject_id IN (
        elective.first_paper_subject_id,
        elective.second_paper_subject_id
      )
    ) OR EXISTS (
      SELECT 1
      FROM public.subject_course_options AS selected
      WHERE selected.id IN (
        student.humanities_main_option_1_id,
        student.humanities_main_option_2_id,
        student.humanities_main_option_3_id
      )
      AND EXISTS (
        SELECT 1
        FROM (VALUES
          (exam_subject.subject_id),
          (paper_group.first_paper_subject_id),
          (paper_group.second_paper_subject_id)
        ) AS represented(subject_id)
        WHERE represented.subject_id IN (
          selected.first_paper_subject_id,
          selected.second_paper_subject_id
        )
      )
    ) THEN 'main'
    ELSE NULL
  END
  FROM public.result_exam_subjects AS exam_subject
  JOIN public.subjects AS subject ON subject.id = exam_subject.subject_id
  JOIN public.students AS student ON student.id = p_student_id
  LEFT JOIN public.result_subject_paper_groups AS paper_group
    ON paper_group.id = exam_subject.paper_group_id
  LEFT JOIN public.subject_course_options AS elective
    ON elective.id = student.group_elective_option_id
  LEFT JOIN public.subject_course_options AS fourth_option
    ON fourth_option.id = COALESCE(student.group_fourth_option_id, student.humanities_fourth_option_id)
  WHERE exam_subject.id = p_exam_subject_id;
$$;

/* Home Science was added to the Humanities curriculum after the current Pre-Test
   exam had already been configured. Add it only to the affected draft exam. */
INSERT INTO public.result_exam_subjects (
  exam_id, subject_id, paper_group_id,
  creative_max, written_max, practical_max, pass_mark, sort_order
)
SELECT exam.id, paper_group.first_paper_subject_id, paper_group.id,
       template.creative_max, template.written_max, template.practical_max,
       template.pass_mark, template.sort_order + 1
FROM public.result_exams AS exam
JOIN public.classes AS class ON class.id = exam.class_id
JOIN public.result_subject_paper_groups AS paper_group
  ON paper_group.class_group = class.class_group
 AND paper_group.name = 'Home Science'
 AND paper_group.is_active = true
CROSS JOIN LATERAL (
  SELECT configured.creative_max, configured.written_max,
         configured.practical_max, configured.pass_mark,
         max(configured.sort_order) OVER () AS sort_order
  FROM public.result_exam_subjects AS configured
  WHERE configured.exam_id = exam.id
  ORDER BY configured.sort_order
  LIMIT 1
) AS template
WHERE exam.status = 'draft'
  AND exam.title = 'Pre-Test Exam'
  AND class.class_group = 'humanities'
  AND exam.combine_subject_papers = true
  AND EXISTS (
    SELECT 1
    FROM public.students AS student
    JOIN public.subject_course_options AS selected
      ON selected.id = COALESCE(student.group_fourth_option_id, student.humanities_fourth_option_id)
    WHERE student.class_id = exam.class_id
      AND student.is_active = true
      AND selected.name = 'Home Science'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.result_exam_subjects AS configured
    WHERE configured.exam_id = exam.id
      AND (
        configured.paper_group_id = paper_group.id
        OR configured.subject_id IN (
          paper_group.first_paper_subject_id,
          paper_group.second_paper_subject_id
        )
      )
  );

COMMENT ON FUNCTION public.student_exam_subject_role(uuid, uuid) IS
  'Returns a student-specific main/fourth role, including both papers represented by a combined exam subject.';
