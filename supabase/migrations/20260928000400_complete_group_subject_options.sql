/* Idempotent follow-up: ensure late-created curriculum papers have course options. */

UPDATE public.subjects
SET is_active = true,
    is_fourth_subject = code IN ('267','268','109','110','249','250','273','274','121','122')
WHERE class_group = 'humanities'
  AND code IN ('101','102','107','108','275','269','270','271','272','267','268','109','110','249','250','273','274','121','122');

INSERT INTO public.subject_course_options (
  class_group, name, first_paper_subject_id, second_paper_subject_id,
  exclusive_group, available_as_elective, available_as_fourth, is_active
)
SELECT
  requested.class_group::public.class_group,
  'Home Science',
  first_paper.id,
  second_paper.id,
  NULL,
  false,
  true,
  true
FROM (VALUES ('business'), ('humanities')) AS requested(class_group)
JOIN public.subjects AS first_paper
  ON first_paper.class_group = requested.class_group::public.class_group
 AND first_paper.code = '273'
JOIN public.subjects AS second_paper
  ON second_paper.class_group = requested.class_group::public.class_group
 AND second_paper.code = '274'
ON CONFLICT (class_group, name) DO UPDATE SET
  first_paper_subject_id = EXCLUDED.first_paper_subject_id,
  second_paper_subject_id = EXCLUDED.second_paper_subject_id,
  available_as_elective = false,
  available_as_fourth = true,
  is_active = true;

UPDATE public.subject_course_options
SET available_as_elective = name IN ('Islamic History & Culture', 'Economics'),
    available_as_fourth = name IN ('Islamic Studies', 'Home Science', 'Logic'),
    is_active = name IN (
      'Islamic History & Culture', 'Economics',
      'Islamic Studies', 'Home Science', 'Logic'
    )
WHERE class_group = 'humanities';

