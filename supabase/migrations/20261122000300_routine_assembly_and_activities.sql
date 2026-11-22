ALTER TABLE public.class_routine_settings ADD COLUMN assembly_time time;
ALTER TABLE public.class_routine_entries DROP CONSTRAINT class_routine_entries_entry_kind_check;
ALTER TABLE public.class_routine_entries ADD CONSTRAINT class_routine_entries_entry_kind_check
 CHECK(entry_kind IN ('lesson','lab','support','activity'));
