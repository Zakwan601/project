/* Guarantee one current academic year and provide an atomic admin setter. */

WITH selected_year AS (
  SELECT id
  FROM public.academic_years
  ORDER BY
    (current_date BETWEEN start_date AND end_date) DESC,
    (start_date <= current_date) DESC,
    start_date DESC
  LIMIT 1
)
UPDATE public.academic_years AS year
SET is_current = (year.id = (SELECT id FROM selected_year));

CREATE UNIQUE INDEX IF NOT EXISTS academic_years_one_current_idx
  ON public.academic_years (is_current)
  WHERE is_current = true;

CREATE OR REPLACE FUNCTION public.set_current_academic_year(p_academic_year_id uuid)
RETURNS public.academic_years
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year public.academic_years;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active administrators can change the current academic year';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.academic_years WHERE id = p_academic_year_id) THEN
    RAISE EXCEPTION 'Academic year not found';
  END IF;

  LOCK TABLE public.academic_years IN SHARE ROW EXCLUSIVE MODE;

  UPDATE public.academic_years SET is_current = false WHERE is_current = true;
  UPDATE public.academic_years
  SET is_current = true
  WHERE id = p_academic_year_id
  RETURNING * INTO v_year;

  RETURN v_year;
END;
$$;

REVOKE ALL ON FUNCTION public.set_current_academic_year(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_current_academic_year(uuid) TO authenticated;

COMMENT ON INDEX public.academic_years_one_current_idx IS
  'Prevents more than one academic year from being marked current.';
