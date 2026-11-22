CREATE INDEX fine_collections_collected_at_idx ON public.fine_collections(collected_at);

CREATE FUNCTION public.get_fine_collection_totals(p_from date DEFAULT NULL,p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active) THEN
   RAISE EXCEPTION 'Only administrators can view collection totals' USING ERRCODE='42501';
 END IF;
 IF p_from>p_to THEN RAISE EXCEPTION 'From date must not be after to date'; END IF;
 SELECT jsonb_build_object('received',coalesce(sum(paid_amount),0),'waived',coalesce(sum(waiver_amount),0),
   'assessed',coalesce(sum(gross_amount),0),'receipts',count(*)) INTO result
 FROM public.fine_collections
 WHERE (p_from IS NULL OR collected_at >= (p_from::timestamp AT TIME ZONE 'Asia/Dhaka'))
 AND (p_to IS NULL OR collected_at < ((p_to+1)::timestamp AT TIME ZONE 'Asia/Dhaka'));
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_fine_collection_totals(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_fine_collection_totals(date,date) TO authenticated;

-- A public weekly timetable, independent of biometric attendance and exam routines.
CREATE TABLE public.class_routine_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
 day_of_week smallint NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
 start_time time NOT NULL,
 end_time time NOT NULL CHECK(end_time>start_time),
 subject_name text NOT NULL CHECK(length(trim(subject_name)) BETWEEN 1 AND 160),
 teacher_name text NOT NULL DEFAULT '' CHECK(length(teacher_name)<=120),
 room text NOT NULL DEFAULT '' CHECK(length(room)<=80),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX class_routine_entries_class_day_idx ON public.class_routine_entries(class_id,day_of_week,start_time);
ALTER TABLE public.class_routine_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.class_routine_entries FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.class_routine_entries TO authenticated;
CREATE POLICY class_routine_admin ON public.class_routine_entries FOR ALL TO authenticated
USING(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active))
WITH CHECK(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active));

-- Expose only routine labels; never expose student lists or private class records.
CREATE FUNCTION public.get_public_class_routines(p_class_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
 'classes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'session',a.name) ORDER BY a.name DESC,c.name),'[]')
   FROM public.classes c LEFT JOIN public.academic_years a ON a.id=c.academic_year_id WHERE c.is_active),
 'entries',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'class_id',r.class_id,'day_of_week',r.day_of_week,
   'start_time',r.start_time,'end_time',r.end_time,'subject_name',r.subject_name,'teacher_name',r.teacher_name,'room',r.room)
   ORDER BY r.day_of_week,r.start_time,r.subject_name),'[]')
   FROM public.class_routine_entries r JOIN public.classes c ON c.id=r.class_id
   WHERE c.is_active AND r.class_id=p_class_id));
$$;
REVOKE ALL ON FUNCTION public.get_public_class_routines(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_class_routines(uuid) TO anon,authenticated;
