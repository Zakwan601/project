BEGIN;
DO $test$
DECLARE
 admin_id uuid; staff_id uuid:=gen_random_uuid(); teacher_id uuid:=gen_random_uuid(); actor_id uuid;
 year_id uuid; class_id uuid; student_id uuid; changed integer; blocked boolean;
 suffix text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
BEGIN
 SELECT id INTO STRICT admin_id FROM public.profiles WHERE role='admin' AND is_active ORDER BY id LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (staff_id,'delete-staff-'||suffix||'@example.invalid','{"full_name":"Delete test staff"}'),
 (teacher_id,'delete-teacher-'||suffix||'@example.invalid','{"full_name":"Delete test teacher"}');
 UPDATE public.profiles SET role='sub_admin' WHERE id=staff_id;
 UPDATE public.profiles SET role='sub_admin',sub_admin_label='teacher' WHERE id=teacher_id;
 INSERT INTO public.sub_admin_permissions(profile_id,permission_key,can_read,can_write)
 SELECT actor.id,'students',true,true FROM unnest(ARRAY[staff_id,teacher_id]) actor(id);
 INSERT INTO public.academic_years(name,start_date,end_date,is_current)
 VALUES('Delete test '||suffix,'2035-01-01','2035-12-31',false) RETURNING id INTO year_id;
 INSERT INTO public.classes(name,grade,section,class_group,academic_year_id)
 VALUES('Delete test '||suffix,'11','A','science',year_id) RETURNING id INTO class_id;
 INSERT INTO public.teacher_class_assignments(profile_id,class_id) VALUES(teacher_id,class_id);
 PERFORM set_config('app.promotion_effective_date','2035-01-01',true);
 INSERT INTO public.students(admission_number,first_name,last_name,class_id,class_group)
 VALUES('DELETE-TEST-'||suffix,'Delete','Test',class_id,'science') RETURNING id INTO student_id;
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 FOREACH actor_id IN ARRAY ARRAY[staff_id,teacher_id] LOOP
   PERFORM set_config('request.jwt.claim.sub',actor_id::text,true);
   EXECUTE 'SET LOCAL ROLE authenticated';
   IF NOT EXISTS(SELECT 1 FROM public.students s WHERE s.id=student_id) THEN
     RAISE EXCEPTION 'Staff lost student read access';
   END IF;
   UPDATE public.students s SET first_name='Edited by staff' WHERE s.id=student_id;
   GET DIAGNOSTICS changed=ROW_COUNT;
   IF changed<>1 THEN RAISE EXCEPTION 'Staff lost permitted student editing'; END IF;
   DELETE FROM public.students s WHERE s.id=student_id;
   GET DIAGNOSTICS changed=ROW_COUNT;
   IF changed<>0 THEN RAISE EXCEPTION 'Non-admin deleted a student'; END IF;
   blocked:=false;
   BEGIN
     PERFORM public.link_student_account_by_email(student_id,'nobody@example.invalid');
   EXCEPTION WHEN raise_exception THEN
     IF SQLERRM='Only active administrators can link student accounts' THEN blocked:=true; ELSE RAISE; END IF;
   END;
   IF NOT blocked THEN RAISE EXCEPTION 'Non-admin gained student login management'; END IF;
   EXECUTE 'RESET ROLE';
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 DELETE FROM public.students s WHERE s.id=student_id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Full administrator cannot delete a student'; END IF;
 EXECUTE 'RESET ROLE';
END;
$test$;
ROLLBACK;
SELECT 'Passed assigned teacher and sub-admin read/edit access, blocked deletion and login linking, and full-admin deletion. All fixtures rolled back.' AS verification;
