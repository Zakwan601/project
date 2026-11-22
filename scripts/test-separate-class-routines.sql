BEGIN READ ONLY;
DO $$
DECLARE cls record; payload jsonb; expected integer; checked integer:=0;
BEGIN
 FOR cls IN SELECT c.id,c.grade,c.class_group FROM public.classes c JOIN public.academic_years a ON a.id=c.academic_year_id
   WHERE c.is_active AND ((c.grade='11' AND a.name='2026-2027') OR (c.grade='12' AND a.name='2025-2026')) LOOP
   expected:=CASE WHEN cls.class_group='science' THEN 30 WHEN cls.grade='11' THEN 25 WHEN cls.class_group='business' THEN 26 ELSE 28 END;
   EXECUTE 'SET LOCAL ROLE anon';
   payload:=public.get_public_class_routines(cls.id);
   IF jsonb_array_length(payload->'classes')<>6 THEN RAISE EXCEPTION 'Expected six selectable class/group routines'; END IF;
   IF jsonb_array_length(payload->'entries')<>expected OR jsonb_array_length(payload->'settings')<>1 THEN
     RAISE EXCEPTION 'Routine count incorrect for % / %',cls.grade,cls.class_group;
   END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'entries') e WHERE e->>'class_id'<>cls.id::text)
     OR payload#>>'{settings,0,class_id}'<>cls.id::text THEN RAISE EXCEPTION 'Routine contains another group'; END IF;
   EXECUTE 'RESET ROLE';
   checked:=checked+1;
 END LOOP;
 IF checked<>6 THEN RAISE EXCEPTION 'Expected six active routines'; END IF;
END;
$$;
ROLLBACK;
SELECT 'Verified all six routines separately before login: each contains only its own class/group and settings.' AS verification;
