/* Admin-only, audited individual and bulk attendance corrections. */

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS manually_corrected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS corrected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS corrected_at timestamptz,
  ADD COLUMN IF NOT EXISTS correction_reason text;

/* The automatic late-arrival trigger must not override an explicit admin decision. */
CREATE OR REPLACE FUNCTION public.mark_post_9_biometric_arrival_late()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.manually_corrected = true THEN
    RETURN NEW;
  END IF;

  IF NEW.biometric_verified = true
     AND NEW.check_in_at IS NOT NULL
     AND (NEW.check_in_at AT TIME ZONE 'UTC')::time > TIME '09:00:00'
  THEN
    NEW.status := 'late'::attendance_status;
    NEW.remarks := 'Late arrival after the 09:00 attendance cutoff';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.attendance_correction_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id uuid NOT NULL REFERENCES public.attendance_records(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  old_status attendance_status,
  new_status attendance_status NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  corrected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  corrected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_correction_audit_record_idx
  ON public.attendance_correction_audit(attendance_record_id, corrected_at DESC);
CREATE INDEX IF NOT EXISTS attendance_correction_audit_student_idx
  ON public.attendance_correction_audit(student_id, corrected_at DESC);

ALTER TABLE public.attendance_correction_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendance_correction_audit FROM anon, authenticated;
GRANT SELECT ON TABLE public.attendance_correction_audit TO authenticated;

DROP POLICY IF EXISTS "Active admins can view attendance correction audit"
  ON public.attendance_correction_audit;
CREATE POLICY "Active admins can view attendance correction audit"
ON public.attendance_correction_audit
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);

CREATE OR REPLACE FUNCTION public.preserve_manual_attendance_correction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  /* Sync updates do not change corrected_at; keep the administrator's override. */
  IF OLD.manually_corrected = true
     AND NEW.corrected_at IS NOT DISTINCT FROM OLD.corrected_at
  THEN
    NEW.status := OLD.status;
    NEW.remarks := OLD.remarks;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_preserve_manual_attendance_correction
  ON public.attendance_records;
CREATE TRIGGER zz_preserve_manual_attendance_correction
BEFORE UPDATE ON public.attendance_records
FOR EACH ROW
EXECUTE FUNCTION public.preserve_manual_attendance_correction();

CREATE OR REPLACE FUNCTION public.correct_attendance_records(
  p_session_id uuid,
  p_corrections jsonb,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_student_id uuid;
  v_status attendance_status;
  v_record_id uuid;
  v_old_status attendance_status;
  v_count integer := 0;
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active administrators can correct attendance';
  END IF;

  IF length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A correction reason of at least 5 characters is required';
  END IF;

  IF jsonb_typeof(p_corrections) <> 'array'
     OR jsonb_array_length(p_corrections) = 0
  THEN
    RAISE EXCEPTION 'At least one attendance correction is required';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_corrections)
  LOOP
    v_student_id := (v_item->>'student_id')::uuid;
    v_status := (v_item->>'status')::attendance_status;

    IF NOT EXISTS (
      SELECT 1
      FROM public.attendance_sessions session
      JOIN public.students student ON student.class_id = session.class_id
      WHERE session.id = p_session_id AND student.id = v_student_id
    ) THEN
      RAISE EXCEPTION 'Student does not belong to this attendance session';
    END IF;

    SELECT id, status INTO v_record_id, v_old_status
    FROM public.attendance_records
    WHERE session_id = p_session_id AND student_id = v_student_id
    FOR UPDATE;

    IF v_record_id IS NULL THEN
      INSERT INTO public.attendance_records (
        session_id, student_id, status, biometric_verified, remarks,
        marked_at, manually_corrected, corrected_by, corrected_at, correction_reason
      ) VALUES (
        p_session_id, v_student_id, v_status, false,
        'Manual correction: ' || v_reason, now(), true, auth.uid(), now(), v_reason
      )
      RETURNING id INTO v_record_id;
    ELSE
      UPDATE public.attendance_records
      SET status = v_status,
          remarks = 'Manual correction: ' || v_reason,
          manually_corrected = true,
          corrected_by = auth.uid(),
          corrected_at = now(),
          correction_reason = v_reason,
          marked_at = now()
      WHERE id = v_record_id;
    END IF;

    INSERT INTO public.attendance_correction_audit (
      attendance_record_id, session_id, student_id, old_status,
      new_status, reason, corrected_by
    ) VALUES (
      v_record_id, p_session_id, v_student_id, v_old_status,
      v_status, v_reason, auth.uid()
    );

    v_count := v_count + 1;
    v_record_id := NULL;
    v_old_status := NULL;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_attendance_records(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_attendance_records(uuid, jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.correct_attendance_records(uuid, jsonb, text) IS
  'Atomically applies audited admin attendance corrections for one or many students.';
