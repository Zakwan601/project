ALTER TABLE public.class_routine_entries
 ADD COLUMN subject_name_bn text NOT NULL DEFAULT '' CHECK(length(subject_name_bn)<=240),
 ADD COLUMN entry_kind text NOT NULL DEFAULT 'lesson' CHECK(entry_kind IN ('lesson','lab','support')),
 ADD COLUMN source_key text UNIQUE;

CREATE TABLE public.class_routine_settings (
 class_id uuid PRIMARY KEY REFERENCES public.classes(id) ON DELETE CASCADE,
 title text NOT NULL,
 periods jsonb NOT NULL CHECK(jsonb_typeof(periods)='array' AND jsonb_array_length(periods)>0),
 effective_from date,
 room text NOT NULL DEFAULT ''
);
ALTER TABLE public.class_routine_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.class_routine_settings FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.class_routine_settings TO authenticated;
CREATE POLICY class_routine_settings_admin ON public.class_routine_settings FOR ALL TO authenticated
USING(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active))
WITH CHECK(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active));

CREATE OR REPLACE FUNCTION public.get_public_class_routines(p_class_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH selected AS (SELECT grade,academic_year_id FROM public.classes WHERE id=p_class_id AND is_active),
 peers AS (SELECT c.* FROM public.classes c JOIN selected s ON c.grade=s.grade
   AND c.academic_year_id IS NOT DISTINCT FROM s.academic_year_id WHERE c.is_active)
 SELECT jsonb_build_object(
 'classes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'grade',c.grade,
   'class_group',c.class_group,'session',a.name,'has_routine',EXISTS(SELECT 1 FROM public.class_routine_entries r WHERE r.class_id=c.id))
   ORDER BY a.name DESC,c.name),'[]')
   FROM public.classes c LEFT JOIN public.academic_years a ON a.id=c.academic_year_id WHERE c.is_active),
 'settings',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM public.class_routine_settings s JOIN peers c ON c.id=s.class_id),
 'entries',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'class_id',r.class_id,'day_of_week',r.day_of_week,
   'start_time',r.start_time,'end_time',r.end_time,'subject_name',r.subject_name,'subject_name_bn',r.subject_name_bn,
   'entry_kind',r.entry_kind,'teacher_name',r.teacher_name,'room',r.room)
   ORDER BY r.day_of_week,r.start_time,r.subject_name),'[]')
   FROM public.class_routine_entries r JOIN peers c ON c.id=r.class_id));
$$;
