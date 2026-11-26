-- Expose the student's assigned role without changing grades, ranking or access checks.
DO $patch$
DECLARE
 definition text;
 anchor text := '''id'', id, ''name'', name, ''code'', code,';
BEGIN
 SELECT pg_get_functiondef('public.build_student_result(uuid,uuid)'::regprocedure) INTO definition;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Report subject payload anchor missing'; END IF;
 IF strpos(definition,'''subject_role'', subject_role')<>0 THEN RAISE EXCEPTION 'Report subject role already installed'; END IF;
 EXECUTE replace(definition,anchor,anchor || E'\n      ''subject_role'', subject_role,');
END;
$patch$;
