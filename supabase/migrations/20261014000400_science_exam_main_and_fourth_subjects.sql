/* Science students take both Biology and Higher Mathematics. The selected
   profile option is the fourth subject; the other course remains main. */
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
    WHEN student.class_group = 'science' THEN 'main'
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

COMMENT ON FUNCTION public.student_exam_subject_role(uuid, uuid) IS
  'Returns a student-specific main/fourth role; Science includes both Biology and Higher Mathematics and uses the profile choice as fourth.';
