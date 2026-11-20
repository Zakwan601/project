CREATE TABLE public.fine_collections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 request_id uuid NOT NULL UNIQUE,
 student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
 period_start date NOT NULL, period_end date NOT NULL CHECK(period_end>=period_start),
 gross_amount numeric(12,2) NOT NULL CHECK(gross_amount>=0),
 waiver_amount numeric(12,2) NOT NULL CHECK(waiver_amount>=0 AND waiver_amount<=gross_amount),
 paid_amount numeric(12,2) GENERATED ALWAYS AS (gross_amount-waiver_amount) STORED,
 fine_snapshot jsonb NOT NULL, monthly_breakdown jsonb NOT NULL,
 student_snapshot jsonb NOT NULL,
 collected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 collector_name text NOT NULL, collected_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(student_id,period_end)
);
CREATE INDEX fine_collections_student_period_idx ON public.fine_collections(student_id,period_end DESC);
ALTER TABLE public.fine_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fine_collections FROM anon,authenticated;
GRANT SELECT ON public.fine_collections TO authenticated;
CREATE POLICY fine_collection_read ON public.fine_collections FOR SELECT TO authenticated
USING(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='admin' AND p.is_active)
 OR EXISTS(SELECT 1 FROM public.students s WHERE s.id=student_id AND s.profile_id=auth.uid()));

-- Incremental late penalties retain the odd late day from previous periods.
CREATE FUNCTION public.fine_collection_quote(p_student_id uuid,p_start date,p_end date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE f jsonb; before_f jsonb; through_f jsonb; penalties integer; amount numeric;
BEGIN
 IF p_start IS NULL OR p_end IS NULL OR p_start>p_end THEN
   RETURN jsonb_build_object('from_date',p_start,'to_date',p_end,'gross_amount',0,'eligible',false,'fine',NULL);
 END IF;
 f:=public.get_student_attendance_fine_details(p_student_id,p_start,p_end);
 before_f:=public.get_student_attendance_fine_details(p_student_id,NULL,p_start-1);
 through_f:=public.get_student_attendance_fine_details(p_student_id,NULL,p_end);
 penalties:=(through_f->>'latePenaltyAbsences')::integer-(before_f->>'latePenaltyAbsences')::integer;
 amount:=((f->>'recordedAbsences')::integer+penalties)*(f->>'finePerAbsentDay')::numeric;
 f:=f||jsonb_build_object('latePenaltyAbsences',penalties,
   'fineableAbsences',(f->>'recordedAbsences')::integer+penalties,'attendanceFine',amount,
   'totalFine',amount+(f->>'examMissedFine')::numeric);
 RETURN jsonb_build_object('from_date',p_start,'to_date',p_end,'gross_amount',(f->>'totalFine')::numeric,'eligible',true,'fine',f);
END;
$$;
REVOKE ALL ON FUNCTION public.fine_collection_quote(uuid,date,date) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fine_collection_start(p_student_id uuid)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE last_end date; first_day date;
BEGIN
 SELECT max(period_end) INTO last_end FROM public.fine_collections WHERE student_id=p_student_id;
 IF last_end IS NOT NULL THEN RETURN last_end+1; END IF;
 SELECT min(day) INTO first_day FROM (
   SELECT session.date AS day FROM public.attendance_records r JOIN public.attendance_sessions session ON session.id=r.session_id
   WHERE r.student_id=p_student_id AND public.teacher_can_access_session(session.id)
   UNION ALL
   SELECT (e->>'date')::date FROM jsonb_array_elements(public.get_student_attendance_exceptions(p_student_id)->'missedExams') e
 ) days WHERE day<=(now() AT TIME ZONE 'Asia/Dhaka')::date;
 RETURN coalesce(first_day,(now() AT TIME ZONE 'Asia/Dhaka')::date);
END;
$$;
REVOKE ALL ON FUNCTION public.fine_collection_start(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_student_fine_account(p_student_id uuid,p_until date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE today date:=(now() AT TIME ZONE 'Asia/Dhaka')::date; cutoff date:=coalesce(p_until,today);
 start_day date; paid_through date; payments jsonb; months jsonb:='[]'; month_day date; month_end date;
 breakdown jsonb; q jsonb; allocated jsonb; status text;
BEGIN
 PERFORM public.get_student_attendance_fine_details(p_student_id);
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active)
   AND NOT EXISTS(SELECT 1 FROM public.students WHERE id=p_student_id AND profile_id=auth.uid()) THEN
   RAISE EXCEPTION 'Fine collection accounts are available only to administrators and the linked student' USING ERRCODE='42501';
 END IF;
 IF cutoff>today THEN RAISE EXCEPTION 'The collection date cannot be in the future'; END IF;
 start_day:=public.fine_collection_start(p_student_id);
 SELECT max(period_end),coalesce(jsonb_agg(to_jsonb(c) ORDER BY period_end DESC),'[]'::jsonb)
 INTO paid_through,payments FROM public.fine_collections c WHERE student_id=p_student_id;
 breakdown:=public.get_student_attendance_fine_breakdown(p_student_id);
 FOR month_day IN SELECT DISTINCT m FROM (
   SELECT (entry->>'month')::date AS m FROM jsonb_array_elements(breakdown->'months') entry
   UNION
   SELECT date_trunc('month',d)::date FROM public.fine_collections c
   CROSS JOIN LATERAL generate_series(date_trunc('month',c.period_start),date_trunc('month',c.period_end),interval '1 month') d
   WHERE c.student_id=p_student_id
 ) available WHERE m<=today ORDER BY m DESC LOOP
   month_end:=least((month_day+interval '1 month - 1 day')::date,today);
   q:=public.fine_collection_quote(p_student_id,greatest(month_day,start_day),month_end);
   SELECT jsonb_build_object('gross_amount',coalesce(sum((item->>'gross_amount')::numeric),0),
     'waiver_amount',coalesce(sum((item->>'waiver_amount')::numeric),0),
     'paid_amount',coalesce(sum((item->>'paid_amount')::numeric),0)) INTO allocated
   FROM public.fine_collections c CROSS JOIN LATERAL jsonb_array_elements(c.monthly_breakdown) item
   WHERE c.student_id=p_student_id AND (item->>'month')::date=month_day;
   status:=CASE WHEN paid_through>=month_end THEN 'paid' WHEN paid_through>=month_day THEN 'partial' ELSE 'unpaid' END;
   months:=months||jsonb_build_array(jsonb_build_object('month',month_day,'through',month_end,'status',status,
     'paid_through',CASE WHEN paid_through>=month_day THEN least(paid_through,month_end) END,
     'unpaid_amount',(q->>'gross_amount')::numeric,'settled',allocated));
 END LOOP;
 RETURN jsonb_build_object('student_id',p_student_id,'paid_through',paid_through,'next_start',start_day,
   'quote',public.fine_collection_quote(p_student_id,start_day,cutoff),'months',months,'payments',payments);
END;
$$;
REVOKE ALL ON FUNCTION public.get_student_fine_account(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_student_fine_account(uuid,date) TO authenticated,service_role;

CREATE FUNCTION public.collect_student_fine(p_student_id uuid,p_until date,p_waiver numeric,
 p_expected_start date,p_expected_gross numeric,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.profiles%ROWTYPE; student_row public.students%ROWTYPE; existing public.fine_collections%ROWTYPE;
 result public.fine_collections%ROWTYPE; start_day date; q jsonb; gross numeric; month_day date; monthly jsonb:='[]';
 part jsonb; part_gross numeric; cumulative numeric:=0; allocated numeric:=0; part_waiver numeric; class_name text;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active;
 IF actor.id IS NULL THEN RAISE EXCEPTION 'Only active administrators can collect fines' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_until IS NULL OR p_waiver IS NULL OR p_waiver<0 OR p_waiver<>round(p_waiver,2)
   OR p_until>(now() AT TIME ZONE 'Asia/Dhaka')::date THEN RAISE EXCEPTION 'Enter a valid date and waiver amount'; END IF;
 SELECT * INTO student_row FROM public.students WHERE id=p_student_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;
 PERFORM 1 FROM public.attendance_fine_settings WHERE id=true FOR SHARE;
 SELECT * INTO existing FROM public.fine_collections WHERE request_id=p_request_id;
 IF FOUND THEN
   IF existing.student_id<>p_student_id OR existing.period_end<>p_until OR existing.waiver_amount<>p_waiver
     OR existing.period_start IS DISTINCT FROM p_expected_start OR existing.gross_amount IS DISTINCT FROM p_expected_gross THEN
     RAISE EXCEPTION 'This payment request was already used for different details';
   END IF;
   RETURN to_jsonb(existing);
 END IF;
 start_day:=public.fine_collection_start(p_student_id);
 q:=public.fine_collection_quote(p_student_id,start_day,p_until);
 gross:=(q->>'gross_amount')::numeric;
 IF NOT (q->>'eligible')::boolean OR start_day IS DISTINCT FROM p_expected_start OR gross IS DISTINCT FROM p_expected_gross THEN
   RAISE EXCEPTION 'The unpaid balance changed. Refresh the account before collecting';
 END IF;
 IF p_waiver>gross THEN RAISE EXCEPTION 'Waiver cannot exceed the fine'; END IF;
 FOR month_day IN SELECT d::date FROM generate_series(date_trunc('month',start_day),date_trunc('month',p_until),interval '1 month') d LOOP
   part:=public.fine_collection_quote(p_student_id,greatest(start_day,month_day),least(p_until,(month_day+interval '1 month - 1 day')::date));
   part_gross:=(part->>'gross_amount')::numeric; cumulative:=cumulative+part_gross;
   part_waiver:=CASE WHEN gross=0 THEN 0 ELSE round(cumulative*p_waiver/gross,2)-allocated END;
   allocated:=allocated+part_waiver;
   monthly:=monthly||jsonb_build_array(part||jsonb_build_object('month',month_day,'waiver_amount',part_waiver,'paid_amount',part_gross-part_waiver));
 END LOOP;
 IF cumulative IS DISTINCT FROM gross OR allocated IS DISTINCT FROM p_waiver THEN
   RAISE EXCEPTION 'Fine calculation changed. Refresh the account before collecting';
 END IF;
 SELECT name INTO class_name FROM public.classes WHERE id=student_row.class_id;
 INSERT INTO public.fine_collections(request_id,student_id,period_start,period_end,gross_amount,waiver_amount,
   fine_snapshot,monthly_breakdown,student_snapshot,collected_by,collector_name)
 VALUES(p_request_id,p_student_id,start_day,p_until,gross,p_waiver,q->'fine',monthly,
   jsonb_build_object('name',trim(student_row.first_name||' '||student_row.last_name),'student_id',student_row.admission_number,
     'class_name',class_name,'student_phone',student_row.student_phone,'guardian_phone',student_row.guardian_phone),actor.id,coalesce(nullif(trim(actor.full_name),''),'Administration'))
 RETURNING * INTO result;
 RETURN to_jsonb(result);
END;
$$;
REVOKE ALL ON FUNCTION public.collect_student_fine(uuid,date,numeric,date,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.collect_student_fine(uuid,date,numeric,date,numeric,uuid) TO authenticated;

CREATE FUNCTION public.get_student_fine_month_details(p_student_id uuid,p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE start_day date:=date_trunc('month',p_month)::date; end_day date; attendance jsonb; missed jsonb;
BEGIN
 PERFORM public.get_student_attendance_fine_details(p_student_id);
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active)
   AND NOT EXISTS(SELECT 1 FROM public.students WHERE id=p_student_id AND profile_id=auth.uid()) THEN
   RAISE EXCEPTION 'Fine collection accounts are available only to administrators and the linked student' USING ERRCODE='42501';
 END IF;
 end_day:=least((start_day+interval '1 month - 1 day')::date,(now() AT TIME ZONE 'Asia/Dhaka')::date);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'date',s.date,'status',r.status,'class_name',c.name) ORDER BY s.date DESC,r.id),'[]') INTO attendance
 FROM public.attendance_records r JOIN public.attendance_sessions s ON s.id=r.session_id JOIN public.classes c ON c.id=s.class_id
 WHERE r.student_id=p_student_id AND s.date BETWEEN start_day AND end_day AND public.teacher_can_access_session(s.id);
 SELECT coalesce(jsonb_agg(e ORDER BY e->>'date' DESC),'[]') INTO missed
 FROM jsonb_array_elements(public.get_student_attendance_exceptions(p_student_id)->'missedExams') e
 WHERE (e->>'date')::date BETWEEN start_day AND end_day;
 RETURN jsonb_build_object('attendance',attendance,'missed_exams',missed);
END;
$$;
REVOKE ALL ON FUNCTION public.get_student_fine_month_details(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_student_fine_month_details(uuid,date) TO authenticated,service_role;
