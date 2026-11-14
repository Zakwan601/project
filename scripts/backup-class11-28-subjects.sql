-- Subject choices only; excludes names, phone numbers, and account credentials.
SELECT jsonb_build_object(
  'captured_at', now(),
  'project_ref', 'cswkotivlmtaegaiyxdm',
  'students', jsonb_agg(jsonb_build_object(
    'id', student.id,
    'admission_number', student.admission_number,
    'class_id', student.class_id,
    'class_group', student.class_group,
    'target', COALESCE(class.grade = '11' AND student.admission_number LIKE '28%', false),
    'choices', jsonb_build_object(
      'group_elective_option_id', student.group_elective_option_id,
      'group_fourth_option_id', student.group_fourth_option_id,
      'humanities_main_option_1_id', student.humanities_main_option_1_id,
      'humanities_main_option_2_id', student.humanities_main_option_2_id,
      'humanities_main_option_3_id', student.humanities_main_option_3_id,
      'humanities_fourth_option_id', student.humanities_fourth_option_id,
      'fourth_subject_id', student.fourth_subject_id,
      'optional_subject_2_id', student.optional_subject_2_id
    )
  ) ORDER BY student.admission_number)
) AS backup
FROM public.students AS student
LEFT JOIN public.classes AS class ON class.id = student.class_id;
