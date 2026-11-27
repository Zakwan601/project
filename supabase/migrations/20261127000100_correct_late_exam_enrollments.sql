BEGIN;
-- These eight students were entered after Tutorial Exam - 1 started.
-- Repair class membership on the exam date, retaining actual account creation dates.
CREATE TEMP TABLE late_exam_enrollment_targets ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('28255','3e6ae432-85f9-429e-99ef-2dfe26f4c78e'::uuid,'58b5771f-2dcd-46e5-bcb0-d054c21f407c'::uuid,'38b8ac0a-9c21-49be-8256-f4a11d471057'::uuid),
  ('28647','a8a4ea6d-6bdc-4dd1-be65-e703fc64638d'::uuid,'4a01a529-b186-40e8-83ab-852d4c972fd5'::uuid,'c9a9aa77-ca08-470d-b320-2fdc97ab557a'::uuid),
  ('28648','f2e46e25-3208-45ae-85c2-30d477d242e4'::uuid,'b1c04bda-9ad6-4cf2-bcd5-a3419d1d87ef'::uuid,'c9a9aa77-ca08-470d-b320-2fdc97ab557a'::uuid),
  ('28651','6edb590f-3b8f-4da8-af37-b0fb17ef544b'::uuid,'12f4c83f-67bb-4c9d-a15d-77347f35b622'::uuid,'c9a9aa77-ca08-470d-b320-2fdc97ab557a'::uuid),
  ('28652','2dd5d328-754c-4fd3-8783-c7447ace150c'::uuid,'99845a5a-0c69-452d-8c0c-f5cdf985dc22'::uuid,'c9a9aa77-ca08-470d-b320-2fdc97ab557a'::uuid),
  ('28657','1e666053-29e9-4c28-8faf-ade93a52fa6d'::uuid,'6a95ecff-032b-494f-8d3d-7c8e38adcab2'::uuid,'c9a9aa77-ca08-470d-b320-2fdc97ab557a'::uuid),
  ('28671','50c3019e-5409-4301-9181-04d8a8077934'::uuid,'f144b9f6-4e59-4d60-852e-f5d2a9f92475'::uuid,'c9a9aa77-ca08-470d-b320-2fdc97ab557a'::uuid),
  ('28681','654a6328-29ca-4e0d-889f-aabfcfd2f24c'::uuid,'d43b8a64-b654-4a99-bfa5-515e8560c25f'::uuid,'c9a9aa77-ca08-470d-b320-2fdc97ab557a'::uuid)
) AS target(admission_number,student_id,enrollment_id,class_id);

DO $repair$
DECLARE changed_count integer;
BEGIN
 PERFORM 1 FROM public.students s JOIN late_exam_enrollment_targets t ON t.student_id=s.id FOR UPDATE OF s;
 PERFORM 1 FROM public.student_enrollments e JOIN late_exam_enrollment_targets t ON t.enrollment_id=e.id FOR UPDATE OF e;
 IF (SELECT count(*) FROM late_exam_enrollment_targets t
     JOIN public.students s ON s.id=t.student_id AND s.admission_number=t.admission_number AND s.class_id=t.class_id
     JOIN public.student_enrollments e ON e.id=t.enrollment_id AND e.student_id=s.id AND e.class_id=t.class_id
     JOIN public.academic_years y ON y.id=e.academic_year_id
     WHERE e.ended_on IS NULL AND e.status='active' AND s.is_active
       AND DATE '2026-11-15' BETWEEN y.start_date AND y.end_date
       AND EXISTS (SELECT 1 FROM public.result_exams ex WHERE ex.class_id=t.class_id AND ex.academic_year_id=y.id
         AND ex.title='Tutorial Exam - 1' AND ex.exam_date=DATE '2026-11-15'))<>8 THEN
   RAISE EXCEPTION 'The eight expected student/class/enrollment/exam records did not match';
 END IF;
 IF EXISTS (SELECT 1 FROM late_exam_enrollment_targets t JOIN public.student_enrollments e ON e.id=t.enrollment_id
   JOIN public.student_enrollments previous ON previous.student_id=t.student_id AND previous.id<>e.id
   WHERE e.started_on>DATE '2026-11-15' AND previous.started_on<e.started_on
     AND (previous.ended_on IS NULL OR previous.ended_on>=DATE '2026-11-15')) THEN
   RAISE EXCEPTION 'Correcting enrollment would overlap another class enrollment';
 END IF;
 UPDATE public.student_enrollments e SET started_on=DATE '2026-11-15'
 FROM late_exam_enrollment_targets t
 WHERE e.id=t.enrollment_id AND e.started_on>DATE '2026-11-15';
 GET DIAGNOSTICS changed_count=ROW_COUNT;
 RAISE NOTICE 'Corrected % late enrollment start dates',changed_count;
 IF EXISTS (SELECT 1 FROM late_exam_enrollment_targets t WHERE NOT EXISTS (
   SELECT 1 FROM public.get_class_students_for_period(t.class_id,DATE '2026-11-15',DATE '2026-11-15') roster
   WHERE roster.id=t.student_id
 )) THEN RAISE EXCEPTION 'An affected student is still missing from the exam roster'; END IF;
END;
$repair$;
COMMIT;
