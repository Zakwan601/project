-- Rollback-only checks. Explicit receipt numbers avoid advancing the live sequence.
BEGIN;
DO $$
DECLARE admin_id uuid; pupil_id uuid; class_id uuid; routine_id uuid; baseline numeric; payload jsonb; affected integer;
BEGIN
 SELECT id INTO STRICT admin_id FROM public.profiles WHERE role='admin' AND is_active ORDER BY id LIMIT 1;
 SELECT id INTO STRICT pupil_id FROM public.students ORDER BY id LIMIT 1;
 SELECT id INTO STRICT class_id FROM public.classes WHERE is_active ORDER BY id LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 baseline:=(public.get_fine_collection_totals()->>'received')::numeric;
 INSERT INTO public.fine_collections(receipt_number,request_id,student_id,period_start,period_end,gross_amount,waiver_amount,
 fine_snapshot,monthly_breakdown,student_snapshot,collector_name,collected_at)
 OVERRIDING SYSTEM VALUE VALUES
 (-900000001,gen_random_uuid(),pupil_id,'2099-01-01','2099-01-01',100,20,'{}','[]','{}','Test','2099-01-01 18:00:00+00'),
 (-900000002,gen_random_uuid(),pupil_id,'2099-01-02','2099-01-02',50,10,'{}','[]','{}','Test','2099-01-02 18:00:00+00');
 IF (public.get_fine_collection_totals()->>'received')::numeric<>baseline+120 THEN RAISE EXCEPTION 'All-time total incorrect'; END IF;
 payload:=public.get_fine_collection_totals('2099-01-02','2099-01-02');
 IF (payload->>'received')::numeric<>80 OR (payload->>'waived')::numeric<>20 OR (payload->>'receipts')::int<>1 THEN
 RAISE EXCEPTION 'Bangladesh inclusive date boundaries or net amount incorrect: %',payload; END IF;
 IF (public.get_fine_collection_totals('2098-12-31','2098-12-31')->>'received')::numeric<>0 THEN RAISE EXCEPTION 'Empty total incorrect'; END IF;
 BEGIN
   PERFORM public.get_fine_collection_totals('1900-01-03','1900-01-02');
   RAISE EXCEPTION 'Reversed dates accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'From date must not be after to date' THEN RAISE; END IF; END;
 EXECUTE 'SET LOCAL ROLE authenticated';
 INSERT INTO public.class_routine_entries(class_id,day_of_week,start_time,end_time,subject_name,teacher_name,room)
 VALUES(class_id,0,'08:30','09:15','Routine regression test','Example teacher','1') RETURNING id INTO routine_id;
 UPDATE public.class_routine_entries SET room='2' WHERE id=routine_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Admin cannot update routine'; END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN
   PERFORM public.get_fine_collection_totals();
   RAISE EXCEPTION 'Non-admin saw collection totals';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   INSERT INTO public.class_routine_entries(class_id,day_of_week,start_time,end_time,subject_name)
   VALUES(class_id,0,'10:00','11:00','Forbidden');
   RAISE EXCEPTION 'Non-admin added routine';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 DELETE FROM public.class_routine_entries WHERE id=routine_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'Non-admin deleted routine'; END IF;
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE anon';
 payload:=public.get_public_class_routines(class_id);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'entries') r WHERE r->>'id'=routine_id::text AND r->>'room'='2') THEN
   RAISE EXCEPTION 'Visitor cannot view published routine'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'classes') c WHERE c - ARRAY['id','name','session','grade','class_group','has_routine'] <> '{}'::jsonb) THEN
   RAISE EXCEPTION 'Public class response contains unexpected fields'; END IF;
 BEGIN
   PERFORM public.get_fine_collection_totals();
   RAISE EXCEPTION 'Visitor saw collection totals';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM * FROM public.class_routine_entries;
   RAISE EXCEPTION 'Visitor has direct table access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 DELETE FROM public.class_routine_entries WHERE id=routine_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Admin cannot remove routine'; END IF;
 EXECUTE 'RESET ROLE';
END;
$$;
ROLLBACK;
SELECT 'Passed collection totals, Bangladesh date boundaries, public routines and admin-only mutations. All test changes rolled back.' AS verification;
