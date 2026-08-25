/* Complete student result system with delegated permissions and secure guardian sharing. */

ALTER TABLE public.sub_admin_permissions
  DROP CONSTRAINT IF EXISTS sub_admin_permissions_permission_key_check;
ALTER TABLE public.sub_admin_permissions
  ADD CONSTRAINT sub_admin_permissions_permission_key_check CHECK (permission_key IN (
    'dashboard', 'students', 'classes', 'attendance', 'punches', 'reports',
    'vacations', 'departure_anomalies', 'devices', 'sms_messages', 'complaints',
    'announcements', 'results'
  ));

CREATE TABLE public.result_exam_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.result_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  exam_type_id uuid NOT NULL REFERENCES public.result_exam_types(id) ON DELETE RESTRICT,
  title text,
  exam_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, exam_type_id, exam_date)
);

CREATE TABLE public.result_exam_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.result_exams(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  creative_max numeric(6,2) NOT NULL DEFAULT 0 CHECK (creative_max >= 0),
  written_max numeric(6,2) NOT NULL DEFAULT 100 CHECK (written_max >= 0),
  practical_max numeric(6,2) NOT NULL DEFAULT 0 CHECK (practical_max >= 0),
  pass_mark numeric(6,2) NOT NULL DEFAULT 33 CHECK (pass_mark >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, subject_id),
  CONSTRAINT result_exam_subjects_total_check CHECK (
    creative_max + written_max + practical_max > 0
    AND pass_mark <= creative_max + written_max + practical_max
  )
);

CREATE TABLE public.result_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_subject_id uuid NOT NULL REFERENCES public.result_exam_subjects(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  creative_marks numeric(6,2),
  written_marks numeric(6,2),
  practical_marks numeric(6,2),
  is_absent boolean NOT NULL DEFAULT false,
  remarks text,
  entered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_subject_id, student_id),
  CHECK (creative_marks IS NULL OR creative_marks >= 0),
  CHECK (written_marks IS NULL OR written_marks >= 0),
  CHECK (practical_marks IS NULL OR practical_marks >= 0)
);

CREATE TABLE public.result_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.result_exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0)
);

CREATE INDEX result_exams_class_date_idx ON public.result_exams(class_id, exam_date DESC);
CREATE INDEX result_marks_student_idx ON public.result_marks(student_id);
CREATE INDEX result_share_links_lookup_idx ON public.result_share_links(token) WHERE revoked_at IS NULL;

CREATE TRIGGER result_exam_types_updated_at BEFORE UPDATE ON public.result_exam_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER result_exams_updated_at BEFORE UPDATE ON public.result_exams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER result_exam_subjects_updated_at BEFORE UPDATE ON public.result_exam_subjects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER result_marks_updated_at BEFORE UPDATE ON public.result_marks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_result_exam()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_year_id uuid;
  v_start date;
  v_end date;
BEGIN
  SELECT class.academic_year_id, year.start_date, year.end_date
  INTO v_year_id, v_start, v_end
  FROM public.classes AS class
  JOIN public.academic_years AS year ON year.id = class.academic_year_id
  WHERE class.id = NEW.class_id;

  IF v_year_id IS NULL OR NEW.academic_year_id <> v_year_id THEN
    RAISE EXCEPTION 'Exam academic year must match the selected class';
  END IF;
  IF NEW.exam_date < v_start OR NEW.exam_date > v_end THEN
    RAISE EXCEPTION 'Exam date must fall within the class academic session';
  END IF;
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    IF NOT EXISTS (SELECT 1 FROM public.result_exam_subjects WHERE exam_id = NEW.id) THEN
      RAISE EXCEPTION 'Add at least one subject before publishing results';
    END IF;
    IF EXISTS (
      WITH roster AS (
        SELECT DISTINCT student.id
        FROM public.students AS student
        WHERE student.is_active = true AND (
          EXISTS (
            SELECT 1 FROM public.student_enrollments AS enrollment
            WHERE enrollment.student_id = student.id
              AND enrollment.class_id = NEW.class_id
              AND enrollment.started_on <= NEW.exam_date
              AND (enrollment.ended_on IS NULL OR enrollment.ended_on >= NEW.exam_date)
          )
          OR (
            student.class_id = NEW.class_id
            AND NOT EXISTS (SELECT 1 FROM public.student_enrollments WHERE student_id = student.id)
          )
        )
      )
      SELECT 1
      FROM roster
      CROSS JOIN public.result_exam_subjects AS exam_subject
      LEFT JOIN public.result_marks AS mark
        ON mark.exam_subject_id = exam_subject.id AND mark.student_id = roster.id
      WHERE exam_subject.exam_id = NEW.id
        AND (
          mark.id IS NULL
          OR (NOT mark.is_absent AND (
            (exam_subject.creative_max > 0 AND mark.creative_marks IS NULL)
            OR (exam_subject.written_max > 0 AND mark.written_marks IS NULL)
            OR (exam_subject.practical_max > 0 AND mark.practical_marks IS NULL)
          ))
        )
    ) THEN
      RAISE EXCEPTION 'Enter marks or mark absent for every student and subject before publishing';
    END IF;
    NEW.published_at := now();
  ELSIF NEW.status = 'draft' THEN
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_result_exam_before_write
  BEFORE INSERT OR UPDATE ON public.result_exams
  FOR EACH ROW EXECUTE FUNCTION public.validate_result_exam();

CREATE OR REPLACE FUNCTION public.validate_result_subject_and_marks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_subject_class uuid;
  v_exam_class uuid;
  v_exam_status text;
BEGIN
  SELECT subject.class_id, exam.class_id, exam.status
  INTO v_subject_class, v_exam_class, v_exam_status
  FROM public.subjects AS subject
  JOIN public.result_exams AS exam ON exam.id = NEW.exam_id
  WHERE subject.id = NEW.subject_id;
  IF v_subject_class IS DISTINCT FROM v_exam_class THEN
    RAISE EXCEPTION 'Subject must belong to the exam class';
  END IF;
  IF v_exam_status = 'published' THEN
    RAISE EXCEPTION 'Unpublish this result before changing its subjects';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_result_subject_before_write
  BEFORE INSERT OR UPDATE ON public.result_exam_subjects
  FOR EACH ROW EXECUTE FUNCTION public.validate_result_subject_and_marks();

CREATE OR REPLACE FUNCTION public.validate_result_marks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_config public.result_exam_subjects;
  v_exam public.result_exams;
BEGIN
  SELECT * INTO v_config FROM public.result_exam_subjects WHERE id = NEW.exam_subject_id;
  SELECT exam.* INTO v_exam
  FROM public.result_exams AS exam WHERE exam.id = v_config.exam_id;

  IF v_exam.status = 'published' THEN
    RAISE EXCEPTION 'Unpublish this result before changing marks';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.student_enrollments AS enrollment
    WHERE enrollment.student_id = NEW.student_id
      AND enrollment.class_id = v_exam.class_id
      AND enrollment.started_on <= v_exam.exam_date
      AND (enrollment.ended_on IS NULL OR enrollment.ended_on >= v_exam.exam_date)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.students AS student
    WHERE student.id = NEW.student_id AND student.class_id = v_exam.class_id
  ) THEN
    RAISE EXCEPTION 'Student was not enrolled in the exam class';
  END IF;
  IF NEW.creative_marks > v_config.creative_max
     OR NEW.written_marks > v_config.written_max
     OR NEW.practical_marks > v_config.practical_max THEN
    RAISE EXCEPTION 'Marks cannot exceed the configured maximum';
  END IF;
  IF NEW.is_absent THEN
    NEW.creative_marks := NULL;
    NEW.written_marks := NULL;
    NEW.practical_marks := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_result_marks_before_write
  BEFORE INSERT OR UPDATE ON public.result_marks
  FOR EACH ROW EXECUTE FUNCTION public.validate_result_marks();

CREATE OR REPLACE FUNCTION public.can_view_result_exam(p_exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_permission('results', 'read') OR EXISTS (
    SELECT 1
    FROM public.result_exams AS exam
    JOIN public.result_exam_subjects AS exam_subject ON exam_subject.exam_id = exam.id
    JOIN public.result_marks AS mark ON mark.exam_subject_id = exam_subject.id
    JOIN public.students AS student ON student.id = mark.student_id
    WHERE exam.id = p_exam_id
      AND exam.status = 'published'
      AND student.profile_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_result_exam(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_result_exam(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_view_result_mark(p_exam_subject_id uuid, p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_permission('results', 'read') OR EXISTS (
    SELECT 1
    FROM public.result_exam_subjects AS exam_subject
    JOIN public.result_exams AS exam ON exam.id = exam_subject.exam_id
    JOIN public.students AS student ON student.id = p_student_id
    WHERE exam_subject.id = p_exam_subject_id
      AND exam.status = 'published'
      AND student.profile_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_result_mark(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_result_mark(uuid, uuid) TO authenticated;

ALTER TABLE public.result_exam_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_exam_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY result_exam_types_read ON public.result_exam_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY result_exam_types_admin_insert ON public.result_exam_types
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('results', 'write') AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ));
CREATE POLICY result_exam_types_admin_update ON public.result_exam_types
  FOR UPDATE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ));
CREATE POLICY result_exam_types_admin_delete ON public.result_exam_types
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ));

CREATE POLICY result_exams_read ON public.result_exams
  FOR SELECT TO authenticated USING (public.can_view_result_exam(id));
CREATE POLICY result_exams_staff_insert ON public.result_exams
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('results', 'write'));
CREATE POLICY result_exams_staff_update ON public.result_exams
  FOR UPDATE TO authenticated USING (public.has_permission('results', 'write'))
  WITH CHECK (public.has_permission('results', 'write'));
CREATE POLICY result_exams_staff_delete ON public.result_exams
  FOR DELETE TO authenticated USING (public.has_permission('results', 'write'));

CREATE POLICY result_exam_subjects_read ON public.result_exam_subjects
  FOR SELECT TO authenticated USING (public.can_view_result_exam(exam_id));
CREATE POLICY result_exam_subjects_staff_insert ON public.result_exam_subjects
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('results', 'write') AND EXISTS (
    SELECT 1 FROM public.result_exams AS exam WHERE exam.id = result_exam_subjects.exam_id AND exam.status = 'draft'
  ));
CREATE POLICY result_exam_subjects_staff_update ON public.result_exam_subjects
  FOR UPDATE TO authenticated USING (public.has_permission('results', 'write') AND EXISTS (
    SELECT 1 FROM public.result_exams AS exam WHERE exam.id = result_exam_subjects.exam_id AND exam.status = 'draft'
  )) WITH CHECK (public.has_permission('results', 'write'));
CREATE POLICY result_exam_subjects_staff_delete ON public.result_exam_subjects
  FOR DELETE TO authenticated USING (public.has_permission('results', 'write') AND EXISTS (
    SELECT 1 FROM public.result_exams AS exam WHERE exam.id = result_exam_subjects.exam_id AND exam.status = 'draft'
  ));

CREATE POLICY result_marks_read ON public.result_marks
  FOR SELECT TO authenticated USING (public.can_view_result_mark(exam_subject_id, student_id));
CREATE POLICY result_marks_staff_insert ON public.result_marks
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('results', 'write') AND EXISTS (
    SELECT 1 FROM public.result_exam_subjects AS exam_subject
    JOIN public.result_exams AS exam ON exam.id = exam_subject.exam_id
    WHERE exam_subject.id = result_marks.exam_subject_id AND exam.status = 'draft'
  ));
CREATE POLICY result_marks_staff_update ON public.result_marks
  FOR UPDATE TO authenticated USING (public.has_permission('results', 'write') AND EXISTS (
    SELECT 1 FROM public.result_exam_subjects AS exam_subject
    JOIN public.result_exams AS exam ON exam.id = exam_subject.exam_id
    WHERE exam_subject.id = result_marks.exam_subject_id AND exam.status = 'draft'
  ))
  WITH CHECK (public.has_permission('results', 'write'));
CREATE POLICY result_marks_staff_delete ON public.result_marks
  FOR DELETE TO authenticated USING (public.has_permission('results', 'write') AND EXISTS (
    SELECT 1 FROM public.result_exam_subjects AS exam_subject
    JOIN public.result_exams AS exam ON exam.id = exam_subject.exam_id
    WHERE exam_subject.id = result_marks.exam_subject_id AND exam.status = 'draft'
  ));

CREATE POLICY result_subject_admin_guard ON public.subjects AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (NOT public.current_user_is_sub_admin())
  WITH CHECK (NOT public.current_user_is_sub_admin());

CREATE POLICY result_share_links_staff_all ON public.result_share_links
  FOR ALL TO authenticated
  USING (public.has_permission('results', 'write'))
  WITH CHECK (public.has_permission('results', 'write'));

/* Existing restrictive policies must recognize the Results module dependencies. */
DROP POLICY IF EXISTS sub_admin_read_guard ON public.students;
DROP POLICY IF EXISTS sub_admin_read_grant ON public.students;
CREATE POLICY sub_admin_read_guard ON public.students AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.current_user_is_sub_admin() OR public.has_permission('students','read') OR public.has_permission('attendance','read') OR public.has_permission('punches','read') OR public.has_permission('reports','read') OR public.has_permission('departure_anomalies','read') OR public.has_permission('results','read'));
CREATE POLICY sub_admin_read_grant ON public.students FOR SELECT TO authenticated
  USING (public.current_user_is_sub_admin() AND (public.has_permission('students','read') OR public.has_permission('attendance','read') OR public.has_permission('punches','read') OR public.has_permission('reports','read') OR public.has_permission('departure_anomalies','read') OR public.has_permission('results','read')));

DROP POLICY IF EXISTS sub_admin_read_guard ON public.student_enrollments;
DROP POLICY IF EXISTS sub_admin_read_grant ON public.student_enrollments;
CREATE POLICY sub_admin_read_guard ON public.student_enrollments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.current_user_is_sub_admin() OR public.has_permission('students','read') OR public.has_permission('attendance','read') OR public.has_permission('reports','read') OR public.has_permission('results','read'));
CREATE POLICY sub_admin_read_grant ON public.student_enrollments FOR SELECT TO authenticated
  USING (public.current_user_is_sub_admin() AND (public.has_permission('students','read') OR public.has_permission('attendance','read') OR public.has_permission('reports','read') OR public.has_permission('results','read')));

DROP POLICY IF EXISTS sub_admin_read_guard ON public.classes;
DROP POLICY IF EXISTS sub_admin_read_grant ON public.classes;
CREATE POLICY sub_admin_read_guard ON public.classes AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.current_user_is_sub_admin() OR public.has_permission('classes','read') OR public.has_permission('attendance','read') OR public.has_permission('punches','read') OR public.has_permission('reports','read') OR public.has_permission('departure_anomalies','read') OR public.has_permission('results','read'));
CREATE POLICY sub_admin_read_grant ON public.classes FOR SELECT TO authenticated
  USING (public.current_user_is_sub_admin() AND (public.has_permission('classes','read') OR public.has_permission('attendance','read') OR public.has_permission('punches','read') OR public.has_permission('reports','read') OR public.has_permission('departure_anomalies','read') OR public.has_permission('results','read')));

DROP POLICY IF EXISTS sub_admin_read_guard ON public.academic_years;
DROP POLICY IF EXISTS sub_admin_read_grant ON public.academic_years;
CREATE POLICY sub_admin_read_guard ON public.academic_years AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.current_user_is_sub_admin() OR public.has_permission('classes','read') OR public.has_permission('attendance','read') OR public.has_permission('reports','read') OR public.has_permission('results','read'));
CREATE POLICY sub_admin_read_grant ON public.academic_years FOR SELECT TO authenticated
  USING (public.current_user_is_sub_admin() AND (public.has_permission('classes','read') OR public.has_permission('attendance','read') OR public.has_permission('reports','read') OR public.has_permission('results','read')));

DROP POLICY IF EXISTS sub_admin_read_guard ON public.subjects;
DROP POLICY IF EXISTS sub_admin_read_grant ON public.subjects;
CREATE POLICY sub_admin_read_guard ON public.subjects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.current_user_is_sub_admin() OR public.has_permission('classes','read') OR public.has_permission('attendance','read') OR public.has_permission('reports','read') OR public.has_permission('results','read'));
CREATE POLICY sub_admin_read_grant ON public.subjects FOR SELECT TO authenticated
  USING (public.current_user_is_sub_admin() AND (public.has_permission('classes','read') OR public.has_permission('attendance','read') OR public.has_permission('reports','read') OR public.has_permission('results','read')));

CREATE OR REPLACE FUNCTION public.build_student_result(p_exam_id uuid, p_student_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH exam_info AS (
    SELECT exam.id, exam.exam_date, exam.status, exam.title,
           type.name AS exam_type, class.id AS class_id, class.name AS class_name,
           class.grade, class.section, year.name AS academic_year
    FROM public.result_exams AS exam
    JOIN public.result_exam_types AS type ON type.id = exam.exam_type_id
    JOIN public.classes AS class ON class.id = exam.class_id
    JOIN public.academic_years AS year ON year.id = exam.academic_year_id
    WHERE exam.id = p_exam_id
  ), student_info AS (
    SELECT student.id, student.admission_number,
           trim(student.first_name || ' ' || student.last_name) AS full_name,
           COALESCE(enrollment.roll_number, student.roll_number) AS roll_number
    FROM public.students AS student
    CROSS JOIN exam_info AS exam
    LEFT JOIN public.student_enrollments AS enrollment
      ON enrollment.student_id = student.id AND enrollment.class_id = exam.class_id
      AND enrollment.started_on <= exam.exam_date
      AND (enrollment.ended_on IS NULL OR enrollment.ended_on >= exam.exam_date)
    WHERE student.id = p_student_id
    ORDER BY enrollment.started_on DESC NULLS LAST
    LIMIT 1
  ), scored AS (
    SELECT exam_subject.id, subject.name, subject.code, exam_subject.sort_order,
           exam_subject.creative_max, exam_subject.written_max, exam_subject.practical_max,
           exam_subject.pass_mark, mark.creative_marks, mark.written_marks,
           mark.practical_marks, COALESCE(mark.is_absent, false) AS is_absent,
           mark.remarks,
           COALESCE(mark.creative_marks, 0) + COALESCE(mark.written_marks, 0) + COALESCE(mark.practical_marks, 0) AS obtained,
           exam_subject.creative_max + exam_subject.written_max + exam_subject.practical_max AS total_max
    FROM public.result_exam_subjects AS exam_subject
    JOIN public.subjects AS subject ON subject.id = exam_subject.subject_id
    LEFT JOIN public.result_marks AS mark
      ON mark.exam_subject_id = exam_subject.id AND mark.student_id = p_student_id
    WHERE exam_subject.exam_id = p_exam_id
  ), graded AS (
    SELECT scored.*,
      (NOT is_absent AND obtained >= pass_mark) AS passed,
      CASE WHEN is_absent OR obtained < pass_mark THEN 'F'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 80 THEN 'A+'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 70 THEN 'A'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 60 THEN 'A-'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 50 THEN 'B'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 40 THEN 'C'
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 33 THEN 'D' ELSE 'F' END AS letter_grade,
      CASE WHEN is_absent OR obtained < pass_mark THEN 0
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 80 THEN 5
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 70 THEN 4
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 60 THEN 3.5
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 50 THEN 3
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 40 THEN 2
           WHEN obtained * 100 / NULLIF(total_max, 0) >= 33 THEN 1 ELSE 0 END::numeric AS grade_point
    FROM scored
  ), summary AS (
    SELECT COALESCE(sum(obtained), 0) AS total_obtained,
           COALESCE(sum(total_max), 0) AS total_max,
           count(*) FILTER (WHERE NOT passed) AS failed_subjects,
           CASE WHEN count(*) = 0 OR count(*) FILTER (WHERE NOT passed) > 0 THEN 0
                ELSE round(avg(grade_point), 2) END AS gpa
    FROM graded
  ), all_totals AS (
    SELECT mark.student_id,
           sum(COALESCE(mark.creative_marks, 0) + COALESCE(mark.written_marks, 0) + COALESCE(mark.practical_marks, 0)) AS obtained
    FROM public.result_marks AS mark
    JOIN public.result_exam_subjects AS exam_subject ON exam_subject.id = mark.exam_subject_id
    WHERE exam_subject.exam_id = p_exam_id
    GROUP BY mark.student_id
  ), ranking AS (
    SELECT student_id, rank() OVER (ORDER BY obtained DESC) AS position,
           count(*) OVER () AS total_students
    FROM all_totals
  )
  SELECT jsonb_build_object(
    'exam', (SELECT to_jsonb(exam_info) FROM exam_info),
    'student', (SELECT to_jsonb(student_info) FROM student_info),
    'subjects', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'code', code,
      'creative_max', creative_max, 'creative_marks', creative_marks,
      'written_max', written_max, 'written_marks', written_marks,
      'practical_max', practical_max, 'practical_marks', practical_marks,
      'pass_mark', pass_mark, 'obtained', obtained, 'total_max', total_max,
      'is_absent', is_absent, 'remarks', remarks, 'passed', passed,
      'letter_grade', letter_grade, 'grade_point', grade_point
    ) ORDER BY sort_order, name) FROM graded), '[]'::jsonb),
    'summary', (SELECT jsonb_build_object(
      'total_obtained', total_obtained, 'total_max', total_max,
      'failed_subjects', failed_subjects, 'gpa', gpa,
      'letter_grade', CASE WHEN failed_subjects > 0 OR gpa < 1 THEN 'F'
        WHEN gpa >= 5 THEN 'A+' WHEN gpa >= 4 THEN 'A' WHEN gpa >= 3.5 THEN 'A-'
        WHEN gpa >= 3 THEN 'B' WHEN gpa >= 2 THEN 'C' ELSE 'D' END,
      'position', ranking.position, 'total_students', ranking.total_students
    ) FROM summary LEFT JOIN ranking ON ranking.student_id = p_student_id)
  );
$$;

REVOKE ALL ON FUNCTION public.build_student_result(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_student_result(p_exam_id uuid, p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_permission('results', 'read') THEN
    RETURN public.build_student_result(p_exam_id, p_student_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.students AS student
    JOIN public.result_exam_subjects AS exam_subject ON exam_subject.exam_id = p_exam_id
    JOIN public.result_marks AS mark ON mark.exam_subject_id = exam_subject.id AND mark.student_id = student.id
    JOIN public.result_exams AS exam ON exam.id = p_exam_id AND exam.status = 'published'
    WHERE student.id = p_student_id AND student.profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Published result not found';
  END IF;
  RETURN public.build_student_result(p_exam_id, p_student_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_result_share_link(
  p_exam_id uuid,
  p_student_id uuid,
  p_expires_at timestamptz DEFAULT (now() + interval '30 days')
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_token uuid;
BEGIN
  IF NOT public.has_permission('results', 'write') THEN
    RAISE EXCEPTION 'Result write permission is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.result_exams AS exam
    JOIN public.result_exam_subjects AS exam_subject ON exam_subject.exam_id = exam.id
    JOIN public.result_marks AS mark ON mark.exam_subject_id = exam_subject.id
    WHERE exam.id = p_exam_id AND exam.status = 'published' AND mark.student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'Publish the student result before creating a guardian link';
  END IF;
  INSERT INTO public.result_share_links (exam_id, student_id, expires_at, created_by)
  VALUES (p_exam_id, p_student_id, p_expires_at, auth.uid())
  RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_shared_student_result(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_link public.result_share_links;
DECLARE v_payload jsonb;
BEGIN
  SELECT * INTO v_link FROM public.result_share_links
  WHERE token = p_token AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());
  IF v_link.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.result_exams WHERE id = v_link.exam_id AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'This result link is invalid, expired, or revoked';
  END IF;
  v_payload := public.build_student_result(v_link.exam_id, v_link.student_id);
  UPDATE public.result_share_links
  SET last_viewed_at = now(), view_count = view_count + 1 WHERE id = v_link.id;
  RETURN v_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_result(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_result_share_link(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_shared_student_result(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_result(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_result_share_link(uuid, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_student_result(uuid) TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.result_exam_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.result_exams TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.result_exam_subjects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.result_marks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.result_share_links TO authenticated;

INSERT INTO public.result_exam_types (name, sort_order)
VALUES ('Monthly Exam', 10), ('Test', 20), ('Mid Term', 30), ('Final', 40)
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE public.result_marks IS 'Per-student component marks for a configured exam subject.';
COMMENT ON FUNCTION public.get_shared_student_result(uuid) IS 'Returns one published result for an unexpired, unrevoked guardian token.';
