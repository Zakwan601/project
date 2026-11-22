-- Each dropdown choice has its own routine; return only that class's periods.
CREATE OR REPLACE FUNCTION public.get_public_class_routines(p_class_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
 'classes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'grade',c.grade,
   'class_group',c.class_group,'session',a.name,'has_routine',EXISTS(SELECT 1 FROM public.class_routine_entries r WHERE r.class_id=c.id))
   ORDER BY c.grade,CASE c.class_group::text WHEN 'science' THEN 0 WHEN 'humanities' THEN 1 ELSE 2 END,a.name DESC),'[]')
   FROM public.classes c LEFT JOIN public.academic_years a ON a.id=c.academic_year_id WHERE c.is_active),
 'settings',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM public.class_routine_settings s
   JOIN public.classes c ON c.id=s.class_id WHERE c.is_active AND c.id=p_class_id),
 'entries',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'class_id',r.class_id,'day_of_week',r.day_of_week,
   'start_time',r.start_time,'end_time',r.end_time,'subject_name',r.subject_name,'subject_name_bn',r.subject_name_bn,
   'entry_kind',r.entry_kind,'teacher_name',r.teacher_name,'room',r.room)
   ORDER BY r.day_of_week,r.start_time,r.subject_name),'[]')
   FROM public.class_routine_entries r JOIN public.classes c ON c.id=r.class_id WHERE c.is_active AND c.id=p_class_id));
$$;
