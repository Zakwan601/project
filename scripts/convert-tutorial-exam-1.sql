-- One-off conversion requested for the three existing 2026-2027 examinations.
-- Lock writes, require no entered marks, and preserve subject identities/order.
BEGIN;
LOCK TABLE public.result_exams, public.result_exam_subjects, public.result_marks IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE tutorial_conversion_targets ON COMMIT DROP AS
SELECT e.id,c.class_group FROM public.result_exams e
JOIN public.classes c ON c.id=e.class_id
JOIN public.academic_years y ON y.id=e.academic_year_id
WHERE e.id IN ('396cfcb7-f51f-4ccd-999a-fbc64bcd20c0'::uuid,
 '17b07c7d-34a8-4831-bab9-11f641358d46'::uuid,'63fa5e73-93a0-4902-9b15-188edbdbc297'::uuid)
AND e.title='Tutorial Exam - 1' AND y.name='2026-2027'
AND c.class_group IN ('science','humanities','business');
CREATE TEMP TABLE tutorial_conversion_subjects ON COMMIT DROP AS
SELECT s.* FROM public.result_exam_subjects s JOIN tutorial_conversion_targets t ON t.id=s.exam_id;
DO $$
DECLARE admin_id uuid;
BEGIN
 IF (SELECT count(*) FROM tutorial_conversion_targets)<>3
 OR (SELECT count(DISTINCT class_group) FROM tutorial_conversion_targets)<>3
 OR (SELECT count(*) FROM tutorial_conversion_subjects)<>25 THEN
   RAISE EXCEPTION 'Expected exactly three examinations and 25 configured subjects';
 END IF;
 IF EXISTS(SELECT 1 FROM public.result_marks m JOIN tutorial_conversion_subjects s ON s.id=m.exam_subject_id) THEN
   RAISE EXCEPTION 'Marks have been entered; conversion aborted to preserve them';
 END IF;
 IF (SELECT count(*) FROM public.result_exam_types WHERE name='Tutorial exam' AND marks_mode='total_only' AND is_active)<>1 THEN
   RAISE EXCEPTION 'Expected one active total-only Tutorial exam type';
 END IF;
 SELECT id INTO STRICT admin_id FROM public.profiles WHERE role='admin' AND is_active ORDER BY id LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END;
$$;
-- The normal format-change guard intentionally blocks configured exams.
-- Only this guard is suspended inside the locked, atomic conversion.
ALTER TABLE public.result_exams DISABLE TRIGGER protect_configured_exam_marks_mode;
UPDATE public.result_exams SET exam_type_id=(SELECT id FROM public.result_exam_types
 WHERE name='Tutorial exam' AND marks_mode='total_only' AND is_active)
WHERE id IN (SELECT id FROM tutorial_conversion_targets);
ALTER TABLE public.result_exams ENABLE TRIGGER protect_configured_exam_marks_mode;
UPDATE public.result_exam_subjects SET creative_max=0,written_max=20,practical_max=0,
 pass_mark=0,creative_pass_mark=0,written_pass_mark=0,practical_pass_mark=0
WHERE exam_id IN (SELECT id FROM tutorial_conversion_targets);
DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM tutorial_conversion_subjects b FULL JOIN
     (SELECT s.* FROM public.result_exam_subjects s JOIN tutorial_conversion_targets t ON t.id=s.exam_id) a
   ON a.id=b.id
   WHERE a.id IS NULL OR b.id IS NULL
     OR ROW(a.exam_id,a.subject_id,a.paper_group_id,a.sort_order,a.created_at)
       IS DISTINCT FROM ROW(b.exam_id,b.subject_id,b.paper_group_id,b.sort_order,b.created_at)
     OR a.creative_max<>0 OR a.written_max<>20 OR a.practical_max<>0
     OR a.pass_mark<>0 OR a.creative_pass_mark<>0 OR a.written_pass_mark<>0 OR a.practical_pass_mark<>0
 ) THEN RAISE EXCEPTION 'Subject preservation or mark settings verification failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.result_exams'::regclass
   AND tgname='protect_configured_exam_marks_mode' AND tgenabled='O') THEN
   RAISE EXCEPTION 'Exam format-change protection was not restored';
 END IF;
END;
$$;
COMMIT;
SELECT c.name AS class_name,e.title,t.name AS exam_type,count(s.id) AS subjects,
 min(s.creative_max+s.written_max+s.practical_max) AS minimum_total,
 max(s.creative_max+s.written_max+s.practical_max) AS maximum_total,max(s.pass_mark) AS pass_mark
FROM public.result_exams e JOIN public.classes c ON c.id=e.class_id
JOIN public.result_exam_types t ON t.id=e.exam_type_id
JOIN public.result_exam_subjects s ON s.exam_id=e.id
WHERE e.id IN ('396cfcb7-f51f-4ccd-999a-fbc64bcd20c0'::uuid,
 '17b07c7d-34a8-4831-bab9-11f641358d46'::uuid,'63fa5e73-93a0-4902-9b15-188edbdbc297'::uuid)
GROUP BY c.name,e.title,t.name ORDER BY c.name;
