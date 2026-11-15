/* Bilingual suffixes must not disable established first/second-paper pairs. */
BEGIN;

CREATE OR REPLACE FUNCTION public.result_subject_paper_identity(p_name text)
RETURNS TABLE (base_name text, paper_number integer)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(btrim(regexp_replace(
           regexp_replace(english_name, '\s+(1st|first|2nd|second)\s+paper\s*$', '', 'i'),
           '\s+', ' ', 'g'
         ))),
         CASE
           WHEN english_name ~* '\s+(1st|first)\s+paper\s*$' THEN 1
           WHEN english_name ~* '\s+(2nd|second)\s+paper\s*$' THEN 2
         END
  FROM (
    SELECT regexp_replace(btrim(p_name), '\s*\([^()]*\)\s*$', '') AS english_name
  ) AS normalized;
$$;

CREATE OR REPLACE FUNCTION public.sync_result_subject_paper_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_name text;
  v_paper_number integer;
  v_first public.subjects%ROWTYPE;
  v_second public.subjects%ROWTYPE;
BEGIN
  -- Stable paper IDs are authoritative; keep the manually maintained bilingual name.
  UPDATE public.result_subject_paper_groups AS paper_group
  SET is_active = first_paper.is_active AND second_paper.is_active
        AND first_paper.class_group = paper_group.class_group
        AND second_paper.class_group = paper_group.class_group,
      code = concat(first_paper.code, '+', second_paper.code)
  FROM public.subjects AS first_paper, public.subjects AS second_paper
  WHERE first_paper.id = paper_group.first_paper_subject_id
    AND second_paper.id = paper_group.second_paper_subject_id
    AND NEW.id IN (paper_group.first_paper_subject_id, paper_group.second_paper_subject_id);

  IF EXISTS (
    SELECT 1
    FROM public.result_subject_paper_groups AS paper_group
    JOIN public.subjects AS first_paper ON first_paper.id = paper_group.first_paper_subject_id
    JOIN public.subjects AS second_paper ON second_paper.id = paper_group.second_paper_subject_id
    WHERE NEW.id IN (first_paper.id, second_paper.id)
      AND paper_group.class_group = NEW.class_group
      AND first_paper.class_group = NEW.class_group
      AND second_paper.class_group = NEW.class_group
  ) THEN
    RETURN NEW;
  END IF;

  SELECT parsed.base_name, parsed.paper_number INTO v_base_name, v_paper_number
  FROM public.result_subject_paper_identity(NEW.name) AS parsed;
  IF v_paper_number IS NULL THEN RETURN NEW; END IF;

  SELECT subject.* INTO v_first
  FROM public.subjects AS subject
  CROSS JOIN LATERAL public.result_subject_paper_identity(subject.name) AS parsed
  WHERE subject.class_group = NEW.class_group
    AND parsed.paper_number = 1 AND parsed.base_name = v_base_name
  ORDER BY subject.created_at, subject.id LIMIT 1;

  SELECT subject.* INTO v_second
  FROM public.subjects AS subject
  CROSS JOIN LATERAL public.result_subject_paper_identity(subject.name) AS parsed
  WHERE subject.class_group = NEW.class_group
    AND parsed.paper_number = 2 AND parsed.base_name = v_base_name
  ORDER BY subject.created_at, subject.id LIMIT 1;

  IF v_first.id IS NOT NULL AND v_second.id IS NOT NULL THEN
    INSERT INTO public.result_subject_paper_groups (
      class_group, name, code, first_paper_subject_id, second_paper_subject_id, is_active
    ) VALUES (
      NEW.class_group,
      btrim(regexp_replace(v_first.name, '\s+(1st|first)\s+paper(\s*\([^()]*\))?\s*$', '\2', 'i')),
      concat(v_first.code, '+', v_second.code),
      v_first.id, v_second.id, v_first.is_active AND v_second.is_active
    )
    ON CONFLICT (class_group, first_paper_subject_id, second_paper_subject_id) DO UPDATE SET
      code = EXCLUDED.code,
      is_active = EXCLUDED.is_active;
  END IF;
  RETURN NEW;
END;
$$;

-- Repair flags invalidated by the old end-of-name matcher. Disabled papers stay disabled.
UPDATE public.result_subject_paper_groups AS paper_group
SET is_active = first_paper.is_active AND second_paper.is_active
      AND first_paper.class_group = paper_group.class_group
      AND second_paper.class_group = paper_group.class_group
FROM public.subjects AS first_paper, public.subjects AS second_paper
WHERE first_paper.id = paper_group.first_paper_subject_id
  AND second_paper.id = paper_group.second_paper_subject_id
  AND paper_group.is_active IS DISTINCT FROM (
    first_paper.is_active AND second_paper.is_active
    AND first_paper.class_group = paper_group.class_group
    AND second_paper.class_group = paper_group.class_group
  );

COMMIT;
