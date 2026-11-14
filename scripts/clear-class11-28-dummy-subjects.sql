-- One-time cleanup requested on 2026-11-14.
-- Run backup-class11-28-subjects.sql and save its output before executing.
-- The 155-student count was checked against the linked project before this run.
BEGIN;

LOCK TABLE public.students IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE subject_cleanup_before ON COMMIT DROP AS
SELECT student.id, to_jsonb(student) AS record,
  COALESCE(class.grade = '11' AND student.admission_number LIKE '28%', false) AS target
FROM public.students AS student
LEFT JOIN public.classes AS class ON class.id = student.class_id;

DO $$
BEGIN
  IF (SELECT count(*) FROM subject_cleanup_before WHERE target) <> 155 THEN
    RAISE EXCEPTION 'Expected exactly 155 Class 11 students with admission IDs starting 28; cleanup cancelled';
  END IF;
END;
$$;

UPDATE public.students AS student
SET group_elective_option_id = NULL,
    group_fourth_option_id = NULL,
    humanities_main_option_1_id = NULL,
    humanities_main_option_2_id = NULL,
    humanities_main_option_3_id = NULL,
    humanities_fourth_option_id = NULL,
    fourth_subject_id = NULL,
    optional_subject_2_id = NULL
FROM subject_cleanup_before AS snapshot
WHERE snapshot.target AND student.id = snapshot.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.students AS student
    JOIN subject_cleanup_before AS snapshot ON snapshot.id = student.id
    WHERE snapshot.target AND (
      student.group_elective_option_id IS NOT NULL OR student.group_fourth_option_id IS NOT NULL
      OR student.humanities_main_option_1_id IS NOT NULL OR student.humanities_main_option_2_id IS NOT NULL
      OR student.humanities_main_option_3_id IS NOT NULL OR student.humanities_fourth_option_id IS NOT NULL
      OR student.fourth_subject_id IS NOT NULL OR student.optional_subject_2_id IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'Some target subject choices were not cleared; rolling back';
  END IF;
  IF EXISTS (
    SELECT 1 FROM subject_cleanup_before AS snapshot
    LEFT JOIN public.students AS student ON student.id = snapshot.id
    WHERE NOT snapshot.target AND snapshot.record IS DISTINCT FROM to_jsonb(student)
  ) THEN
    RAISE EXCEPTION 'A student outside the requested cohort changed; rolling back';
  END IF;
END;
$$;

COMMIT;

SELECT student.class_group, count(*) AS cleared_students
FROM public.students AS student
JOIN public.classes AS class ON class.id = student.class_id
WHERE class.grade = '11' AND student.admission_number LIKE '28%'
  AND student.group_elective_option_id IS NULL AND student.group_fourth_option_id IS NULL
  AND student.humanities_main_option_1_id IS NULL AND student.humanities_main_option_2_id IS NULL
  AND student.humanities_main_option_3_id IS NULL AND student.humanities_fourth_option_id IS NULL
  AND student.fourth_subject_id IS NULL AND student.optional_subject_2_id IS NULL
GROUP BY student.class_group ORDER BY student.class_group;
