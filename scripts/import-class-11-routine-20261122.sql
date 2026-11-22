-- Class 11, academic session 2026-2027. Source effective 27 September 2026.
-- Transcribed from the supplied upright image. All teacher names intentionally blank.
BEGIN;
CREATE TEMP TABLE routine_reference (
 class_group text, day integer, first_period integer, last_period integer, codes text, kind text
) ON COMMIT DROP;
INSERT INTO routine_reference VALUES
 ('business',0,1,1,'275','lesson'),('business',0,2,2,'253','lesson'),('business',0,3,3,'107','lesson'),('business',0,4,4,'277','lesson'),('business',0,5,5,'101','lesson'),
 ('science',0,1,1,'265','lesson'),('science',0,2,2,'275','lesson'),('science',0,3,3,'178','lesson'),('science',0,4,4,'174','lesson'),('science',0,5,5,'176','lesson'),('science',0,6,6,'176','lab'),
 ('humanities',0,1,1,'275','lesson'),('humanities',0,2,2,'101','lesson'),('humanities',0,3,3,'269','lesson'),('humanities',0,4,4,'107','lesson'),('humanities',0,5,6,'275','lab'),
 ('business',1,1,1,'101','lesson'),('business',1,2,2,'253','lesson'),('business',1,3,3,'286','lesson'),('business',1,4,4,'277','lesson'),('business',1,5,6,'games','activity'),
 ('science',1,1,1,'265','lesson'),('science',1,2,2,'178','lesson'),('science',1,3,3,'101','lesson'),('science',1,4,4,'174','lesson'),('science',1,5,5,'107','lesson'),('science',1,6,6,'174','lab'),
 ('humanities',1,1,1,'101','lesson'),('humanities',1,2,2,'109/267','lesson'),('humanities',1,3,3,'275','lesson'),('humanities',1,4,4,'271','lesson'),('humanities',1,5,6,'games','activity'),
 ('business',2,1,1,'107','lesson'),('business',2,2,2,'292','lesson'),('business',2,3,3,'286','lesson'),('business',2,4,4,'275','lesson'),('business',2,5,5,'101','lesson'),
 ('science',2,1,1,'176','lesson'),('science',2,2,2,'101','lesson'),('science',2,3,3,'265','lesson'),('science',2,4,4,'275','lesson'),('science',2,5,5,'178','lesson'),('science',2,6,6,'178','lab'),
 ('humanities',2,1,1,'275','lesson'),('humanities',2,2,2,'249/121/273','lesson'),('humanities',2,3,3,'107','lesson'),('humanities',2,4,4,'271','lesson'),('humanities',2,5,5,'101','lesson'),
 ('business',3,1,1,'107','lesson'),('business',3,2,2,'277','lesson'),('business',3,3,3,'253','lesson'),('business',3,4,4,'286','lesson'),('business',3,5,5,'292','lesson'),
 ('science',3,1,1,'101','lesson'),('science',3,2,2,'107','lesson'),('science',3,3,3,'275','lesson'),('science',3,4,4,'174','lesson'),('science',3,5,5,'176','lesson'),('science',3,6,6,'265','lab'),
 ('humanities',3,1,1,'101','lesson'),('humanities',3,2,2,'269','lesson'),('humanities',3,3,3,'109/267','lesson'),('humanities',3,4,4,'107','lesson'),('humanities',3,5,6,'249/121/273','lesson'),
 ('business',4,1,1,'275','lesson'),('business',4,2,2,'101','lesson'),('business',4,3,3,'253','lesson'),('business',4,4,4,'107','lesson'),('business',4,5,5,'292','lesson'),
 ('science',4,1,1,'176','lesson'),('science',4,2,2,'178','lesson'),('science',4,3,3,'107','lesson'),('science',4,4,4,'174','lesson'),('science',4,5,5,'265','lesson'),('science',4,6,6,'games','activity'),
 ('humanities',4,1,1,'109/267','lesson'),('humanities',4,2,2,'107','lesson'),('humanities',4,3,3,'269','lesson'),('humanities',4,4,4,'271','lesson'),('humanities',4,5,6,'249/121/273','lesson');

CREATE TEMP TABLE routine_periods (number integer,start_time time,end_time time,kind text) ON COMMIT DROP;
INSERT INTO routine_periods VALUES
 (1,'08:30','09:00','lesson'),(2,'09:00','09:45','lesson'),(3,'09:45','10:25','lesson'),
 (0,'10:25','10:45','break'),(4,'10:45','11:30','lesson'),(5,'11:30','12:15','lesson'),(6,'12:15','13:00','lesson');

DO $$
DECLARE r record; cls uuid; names text[]; subject_code text; label text; english text; bangla text; starts time; ends time;
BEGIN
 IF (SELECT count(*) FROM public.classes c JOIN public.academic_years a ON a.id=c.academic_year_id
   WHERE c.is_active AND c.grade='11' AND a.name='2026-2027')<>3 THEN RAISE EXCEPTION 'Expected exactly three active Class 11 classes in 2026-2027'; END IF;
 FOR r IN SELECT * FROM routine_reference LOOP
   SELECT c.id INTO STRICT cls FROM public.classes c JOIN public.academic_years a ON a.id=c.academic_year_id
   WHERE c.is_active AND c.grade='11' AND c.class_group::text=r.class_group AND a.name='2026-2027';
   english:=''; bangla:='';
   IF r.codes='games' THEN english:='Indoor Games'; bangla:='ইনডোর গেমস';
   ELSE
     names:=string_to_array(r.codes,'/');
     FOREACH subject_code IN ARRAY names LOOP
       label:=NULL;
       IF subject_code='275' THEN
         SELECT name INTO STRICT label FROM public.subjects s WHERE s.code='275' AND s.class_group::text=r.class_group AND s.is_active;
       ELSE
         SELECT name INTO STRICT label FROM public.result_subject_paper_groups g
         WHERE split_part(g.code,'+',1)=subject_code AND g.class_group::text=r.class_group AND g.is_active;
       END IF;
       IF label IS NULL THEN RAISE EXCEPTION 'No database subject for % / %',r.class_group,subject_code; END IF;
       english:=english || CASE WHEN english='' THEN '' ELSE ' / ' END || regexp_replace(label,'\s*\([^)]*\)$','');
       bangla:=bangla || CASE WHEN bangla='' THEN '' ELSE ' / ' END || coalesce(substring(label from '\((.*)\)$'),label);
     END LOOP;
     IF r.kind='lab' THEN english:=english || ' practical'; bangla:=bangla || ' ব্যবহারিক'; END IF;
   END IF;
   SELECT start_time INTO STRICT starts FROM routine_periods WHERE number=r.first_period;
   SELECT end_time INTO STRICT ends FROM routine_periods WHERE number=r.last_period;
   INSERT INTO public.class_routine_entries(class_id,day_of_week,start_time,end_time,subject_name,subject_name_bn,entry_kind,teacher_name,room,source_key)
   VALUES(cls,r.day,starts,ends,english,bangla,r.kind,'','',format('printed-20261122:11:%s:%s:%s',r.class_group,r.day,r.first_period))
   ON CONFLICT(source_key) DO UPDATE SET class_id=excluded.class_id,day_of_week=excluded.day_of_week,start_time=excluded.start_time,
     end_time=excluded.end_time,subject_name=excluded.subject_name,subject_name_bn=excluded.subject_name_bn,entry_kind=excluded.entry_kind,teacher_name='';
 END LOOP;
 INSERT INTO public.class_routine_settings(class_id,title,periods,effective_from,assembly_time)
 SELECT c.id,'Class 11 weekly routine',
 (SELECT jsonb_agg(jsonb_build_object('number',number,'start_time',start_time,'end_time',end_time,'kind',kind) ORDER BY start_time) FROM routine_periods),
 '2026-09-27'::date,'08:00'::time
 FROM public.classes c JOIN public.academic_years a ON a.id=c.academic_year_id
 WHERE c.is_active AND c.grade='11' AND a.name='2026-2027'
 ON CONFLICT(class_id) DO UPDATE SET title=excluded.title,periods=excluded.periods,effective_from=excluded.effective_from,assembly_time=excluded.assembly_time;
 IF (SELECT count(*) FROM public.class_routine_entries WHERE source_key LIKE 'printed-20261122:11:%')<>80
 OR (SELECT count(*) FROM routine_reference)<>80 THEN RAISE EXCEPTION 'Routine import count mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.class_routine_entries a JOIN public.class_routine_entries b ON a.id<b.id AND a.class_id=b.class_id AND a.day_of_week=b.day_of_week
   AND a.start_time<b.end_time AND b.start_time<a.end_time WHERE a.source_key LIKE 'printed-20261122:11:%') THEN RAISE EXCEPTION 'Overlapping routine entries'; END IF;
END;
$$;
COMMIT;
SELECT c.name,a.name AS academic_session,count(r.id) AS entries,count(*) FILTER(WHERE r.teacher_name<>'') AS named_teachers
FROM public.class_routine_entries r JOIN public.classes c ON c.id=r.class_id JOIN public.academic_years a ON a.id=c.academic_year_id
WHERE r.source_key LIKE 'printed-20261122:11:%' GROUP BY c.name,a.name ORDER BY c.name;
