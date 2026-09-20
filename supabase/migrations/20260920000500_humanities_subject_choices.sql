/* Course-level humanities selections: three main electives and one fourth subject. */

INSERT INTO public.subjects (name, code, class_group, is_fourth_subject, is_active)
SELECT subject.name, subject.code, 'humanities'::public.class_group, true, true
FROM (
  VALUES
    ('Islamic History & Culture 1st Paper', '267'),
    ('Islamic History & Culture 2nd Paper', '268'),
    ('Logic 2nd Paper', '122')
) AS subject(name, code)
WHERE NOT EXISTS (
  SELECT 1 FROM public.subjects existing
  WHERE existing.class_group = 'humanities' AND existing.code = subject.code
);

UPDATE public.subjects SET is_fourth_subject = true
WHERE class_group = 'humanities'
  AND code IN ('304','305','267','268','269','270','109','110','121','122','117','118','271','272','125','126','249','250');

CREATE TABLE public.subject_course_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_group public.class_group NOT NULL,
  name text NOT NULL,
  first_paper_subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  second_paper_subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  exclusive_group text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_group, name),
  CHECK (first_paper_subject_id <> second_paper_subject_id)
);

ALTER TABLE public.subject_course_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subject_course_options_select" ON public.subject_course_options
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.subject_course_options (class_group, name, first_paper_subject_id, second_paper_subject_id, exclusive_group)
SELECT 'humanities'::public.class_group, option.name, first_paper.id, second_paper.id, option.exclusive_group
FROM (
  VALUES
    ('History', '304', '305', 'history'),
    ('Islamic History & Culture', '267', '268', 'history'),
    ('Civics & Good Governance', '269', '270', NULL),
    ('Economics', '109', '110', NULL),
    ('Logic', '121', '122', NULL),
    ('Sociology', '117', '118', 'social_science'),
    ('Social Work', '271', '272', 'social_science'),
    ('Geography', '125', '126', NULL),
    ('Islamic Studies', '249', '250', NULL)
) AS option(name, first_code, second_code, exclusive_group)
JOIN public.subjects first_paper ON first_paper.class_group = 'humanities' AND first_paper.code = option.first_code
JOIN public.subjects second_paper ON second_paper.class_group = 'humanities' AND second_paper.code = option.second_code
ON CONFLICT (class_group, name) DO UPDATE SET
  first_paper_subject_id = EXCLUDED.first_paper_subject_id,
  second_paper_subject_id = EXCLUDED.second_paper_subject_id,
  exclusive_group = EXCLUDED.exclusive_group,
  is_active = true;

ALTER TABLE public.students
  ADD COLUMN humanities_main_option_1_id uuid REFERENCES public.subject_course_options(id) ON DELETE SET NULL,
  ADD COLUMN humanities_main_option_2_id uuid REFERENCES public.subject_course_options(id) ON DELETE SET NULL,
  ADD COLUMN humanities_main_option_3_id uuid REFERENCES public.subject_course_options(id) ON DELETE SET NULL,
  ADD COLUMN humanities_fourth_option_id uuid REFERENCES public.subject_course_options(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.validate_humanities_subject_choices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids uuid[];
  v_id uuid;
  v_option_count integer;
  v_distinct_count integer;
BEGIN
  IF NEW.class_group <> 'humanities' THEN
    NEW.humanities_main_option_1_id := NULL;
    NEW.humanities_main_option_2_id := NULL;
    NEW.humanities_main_option_3_id := NULL;
    NEW.humanities_fourth_option_id := NULL;
    RETURN NEW;
  END IF;

  v_ids := ARRAY[
    NEW.humanities_main_option_1_id,
    NEW.humanities_main_option_2_id,
    NEW.humanities_main_option_3_id,
    NEW.humanities_fourth_option_id
  ];

  SELECT count(*), count(DISTINCT selected_id)
  INTO v_option_count, v_distinct_count
  FROM unnest(v_ids) AS selected(selected_id)
  WHERE selected_id IS NOT NULL;

  IF v_option_count <> v_distinct_count THEN
    RAISE EXCEPTION 'Humanities main and fourth subjects must be different';
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    IF v_id IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.subject_course_options
      WHERE id = v_id AND class_group = 'humanities' AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Select an active humanities subject option';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.subject_course_options
    WHERE id = ANY(v_ids) AND exclusive_group IS NOT NULL
    GROUP BY exclusive_group HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'History alternatives and Sociology alternatives are mutually exclusive';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER students_validate_humanities_subject_choices
  BEFORE INSERT OR UPDATE OF class_group, humanities_main_option_1_id, humanities_main_option_2_id,
    humanities_main_option_3_id, humanities_fourth_option_id
  ON public.students FOR EACH ROW
  EXECUTE FUNCTION public.validate_humanities_subject_choices();
