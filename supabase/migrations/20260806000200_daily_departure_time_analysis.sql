/*
  Robust, admin-only student departure anomaly analysis.

  Raw device logs are authoritative because attendance synchronization can lag.
  Device timestamps in this project are UTC-tagged school wall-clock values, so
  their date/time components are deliberately read with AT TIME ZONE 'UTC'.
*/

CREATE TABLE IF NOT EXISTS public.class_departure_analysis_settings (
  class_id uuid PRIMARY KEY REFERENCES public.classes(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Asia/Dhaka',
  early_threshold_minutes smallint NOT NULL DEFAULT 30
    CHECK (early_threshold_minutes BETWEEN 5 AND 240),
  analysis_grace_minutes smallint NOT NULL DEFAULT 15
    CHECK (analysis_grace_minutes BETWEEN 0 AND 120),
  minimum_cohort_size smallint NOT NULL DEFAULT 8
    CHECK (minimum_cohort_size BETWEEN 4 AND 100),
  history_window_days smallint NOT NULL DEFAULT 60
    CHECK (history_window_days BETWEEN 14 AND 365),
  cache_ttl_seconds integer NOT NULL DEFAULT 300
    CHECK (cache_ttl_seconds BETWEEN 30 AND 3600),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

/* Upgrade installations that applied the original fixed-dismissal version. */
ALTER TABLE public.class_departure_analysis_settings
  DROP COLUMN IF EXISTS dismissal_time,
  DROP COLUMN IF EXISTS is_configured;

INSERT INTO public.class_departure_analysis_settings (class_id)
SELECT id FROM public.classes
ON CONFLICT (class_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_class_departure_analysis_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.class_departure_analysis_settings (class_id)
  VALUES (NEW.id)
  ON CONFLICT (class_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_class_departure_analysis_settings ON public.classes;
CREATE TRIGGER create_class_departure_analysis_settings
AFTER INSERT ON public.classes
FOR EACH ROW EXECUTE FUNCTION public.create_class_departure_analysis_settings();

CREATE OR REPLACE FUNCTION public.validate_departure_analysis_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Unknown IANA timezone: %', NEW.timezone;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_departure_analysis_timezone
  ON public.class_departure_analysis_settings;
CREATE TRIGGER validate_departure_analysis_timezone
BEFORE INSERT OR UPDATE OF timezone ON public.class_departure_analysis_settings
FOR EACH ROW EXECUTE FUNCTION public.validate_departure_analysis_timezone();

DROP TRIGGER IF EXISTS class_departure_analysis_settings_updated_at
  ON public.class_departure_analysis_settings;
CREATE TRIGGER class_departure_analysis_settings_updated_at
BEFORE UPDATE ON public.class_departure_analysis_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.class_departure_analysis_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.class_departure_analysis_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.class_departure_analysis_settings TO authenticated;

DROP POLICY IF EXISTS "Active admins manage departure analysis settings"
  ON public.class_departure_analysis_settings;
CREATE POLICY "Active admins manage departure analysis settings"
ON public.class_departure_analysis_settings
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);

/*
  The official dismissal time varies by class and date. The Edge Function writes
  the manually supplied value here before analysis so historical comparisons use
  the actual dismissal time for each earlier day, never today's time as a proxy.
*/
CREATE TABLE IF NOT EXISTS public.class_daily_dismissal_times (
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  dismissal_date date NOT NULL,
  dismissal_time time NOT NULL,
  provided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, dismissal_date)
);

CREATE INDEX IF NOT EXISTS class_daily_dismissal_times_date_idx
  ON public.class_daily_dismissal_times(dismissal_date, class_id);

DROP TRIGGER IF EXISTS class_daily_dismissal_times_updated_at
  ON public.class_daily_dismissal_times;
CREATE TRIGGER class_daily_dismissal_times_updated_at
BEFORE UPDATE ON public.class_daily_dismissal_times
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.class_daily_dismissal_times ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.class_daily_dismissal_times FROM anon, authenticated;
GRANT ALL ON TABLE public.class_daily_dismissal_times TO service_role;

CREATE TABLE IF NOT EXISTS public.student_departure_anomaly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  analysis_date date NOT NULL,
  dismissal_time time NOT NULL,
  algorithm_version text NOT NULL,
  response jsonb NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (class_id, analysis_date, algorithm_version)
);

/* Existing cached reports are disposable and cannot be reused without the input time. */
ALTER TABLE public.student_departure_anomaly_reports
  ADD COLUMN IF NOT EXISTS dismissal_time time;

/* Preserve reports created by either earlier response contract when possible. */
UPDATE public.student_departure_anomaly_reports
SET dismissal_time = CASE
  WHEN COALESCE(
    response #>> '{configuration,departure_time}',
    response #>> '{configuration,dismissal_time}'
  ) ~ '^\d{2}:\d{2}(:\d{2})?$'
  THEN COALESCE(
    response #>> '{configuration,departure_time}',
    response #>> '{configuration,dismissal_time}'
  )::time
  ELSE NULL
END
WHERE dismissal_time IS NULL;

INSERT INTO public.class_daily_dismissal_times (
  class_id, dismissal_date, dismissal_time, provided_by
)
SELECT class_id, analysis_date, dismissal_time, created_by
FROM public.student_departure_anomaly_reports
WHERE dismissal_time IS NOT NULL
ON CONFLICT (class_id, dismissal_date) DO UPDATE
SET dismissal_time = EXCLUDED.dismissal_time,
    provided_by = EXCLUDED.provided_by;

DELETE FROM public.student_departure_anomaly_reports
WHERE dismissal_time IS NULL;
ALTER TABLE public.student_departure_anomaly_reports
  ALTER COLUMN dismissal_time SET NOT NULL;

CREATE INDEX IF NOT EXISTS departure_anomaly_reports_expiry_idx
  ON public.student_departure_anomaly_reports(expires_at);
CREATE INDEX IF NOT EXISTS device_logs_student_punched_at_idx
  ON public.device_logs(student_biometric_id, punched_at);

ALTER TABLE public.student_departure_anomaly_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.student_departure_anomaly_reports FROM anon, authenticated;
GRANT ALL ON TABLE public.student_departure_anomaly_reports TO service_role;

/*
  Returns only cohort statistics and flagged candidates. Risk scoring remains in
  the Edge Function, keeping policy changes deployable without rewriting SQL.
*/
DROP FUNCTION IF EXISTS public.analyze_student_departures(uuid, date);

CREATE OR REPLACE FUNCTION public.analyze_student_departures(
  p_class_id uuid,
  p_date date,
  p_departure_time time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_class_name text;
  v_class_grade text;
  v_class_section text;
  v_timezone text;
  v_early_threshold_minutes integer;
  v_analysis_grace_minutes integer;
  v_minimum_cohort_size integer;
  v_history_window_days integer;
  v_cache_ttl_seconds integer;
  v_now_local timestamp;
  v_candidates jsonb;
  v_cohort jsonb;
BEGIN
  IF p_class_id IS NULL OR p_date IS NULL OR p_departure_time IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'invalid_request',
      'message', 'class_id, date, and departure_time are required'
    );
  END IF;

  SELECT cls.name, cls.grade, cls.section,
         settings.timezone,
         settings.early_threshold_minutes,
         settings.analysis_grace_minutes,
         settings.minimum_cohort_size,
         settings.history_window_days,
         settings.cache_ttl_seconds
  INTO v_class_name, v_class_grade, v_class_section,
       v_timezone, v_early_threshold_minutes,
       v_analysis_grace_minutes, v_minimum_cohort_size,
       v_history_window_days, v_cache_ttl_seconds
  FROM public.classes AS cls
  LEFT JOIN public.class_departure_analysis_settings AS settings
    ON settings.class_id = cls.id
  WHERE cls.id = p_class_id AND cls.is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'class_not_found', 'message', 'Active class not found');
  END IF;

  IF v_timezone IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'configuration_required',
      'message', 'Departure analysis settings are missing for this class',
      'class_id', p_class_id
    );
  END IF;

  v_now_local := now() AT TIME ZONE v_timezone;
  IF p_date > v_now_local::date THEN
    RETURN jsonb_build_object('status', 'future_date', 'message', 'A future date cannot be analyzed');
  END IF;

  IF p_date = v_now_local::date
     AND v_now_local < (p_date + p_departure_time + make_interval(mins => v_analysis_grace_minutes))
  THEN
    RETURN jsonb_build_object(
      'status', 'analysis_not_ready',
      'message', 'Analysis is available after dismissal and the configured grace period',
      'available_after',
        to_char(p_date + p_departure_time + make_interval(mins => v_analysis_grace_minutes),
                'YYYY-MM-DD"T"HH24:MI:SS')
    );
  END IF;

  WITH class_students AS MATERIALIZED (
    SELECT student.id, student.admission_number, student.first_name,
           student.last_name, student.roll_number, student.photo_url
    FROM public.students AS student
    WHERE student.class_id = p_class_id AND student.is_active = true
  ),
  daily_punches AS MATERIALIZED (
    SELECT log.student_biometric_id,
           min(log.punched_at) AS arrival_at,
           CASE WHEN count(*) >= 2 THEN max(log.punched_at) END AS departure_at,
           count(*)::integer AS scan_count
    FROM public.device_logs AS log
    JOIN class_students AS student
      ON student.admission_number = log.student_biometric_id
    WHERE log.punched_at >= (p_date::timestamp AT TIME ZONE 'UTC')
      AND log.punched_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC')
    GROUP BY log.student_biometric_id
  ),
  daily AS MATERIALIZED (
    SELECT student.*,
           punches.arrival_at,
           punches.departure_at,
           COALESCE(punches.scan_count, 0) AS scan_count,
           extract(epoch FROM (punches.departure_at AT TIME ZONE 'UTC')::time)::numeric
             AS departure_second
    FROM class_students AS student
    LEFT JOIN daily_punches AS punches
      ON punches.student_biometric_id = student.admission_number
  ),
  departure_values AS MATERIALIZED (
    SELECT departure_second
    FROM daily
    WHERE departure_second IS NOT NULL
  ),
  base_stats AS (
    SELECT count(*)::integer AS departure_count,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY departure_second) AS q1,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY departure_second) AS median,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY departure_second) AS q3
    FROM departure_values
  ),
  robust_stats AS (
    SELECT stats.*,
           (stats.q3 - stats.q1) AS iqr,
           (
             SELECT percentile_cont(0.50) WITHIN GROUP (
               ORDER BY abs(values.departure_second - stats.median)
             )
             FROM departure_values AS values
           ) AS mad
    FROM base_stats AS stats
  ),
  history_daily AS MATERIALIZED (
    SELECT student.id AS student_id,
           (log.punched_at AT TIME ZONE 'UTC')::date AS attendance_date,
           count(*)::integer AS scan_count,
           max(log.punched_at) AS last_punch_at,
           schedule.dismissal_time
    FROM class_students AS student
    JOIN public.device_logs AS log
      ON log.student_biometric_id = student.admission_number
    LEFT JOIN public.class_daily_dismissal_times AS schedule
      ON schedule.class_id = p_class_id
     AND schedule.dismissal_date = (log.punched_at AT TIME ZONE 'UTC')::date
    WHERE log.punched_at >= ((p_date - v_history_window_days)::timestamp AT TIME ZONE 'UTC')
      AND log.punched_at < (p_date::timestamp AT TIME ZONE 'UTC')
    GROUP BY student.id, (log.punched_at AT TIME ZONE 'UTC')::date,
             schedule.dismissal_time
  ),
  history AS MATERIALIZED (
    SELECT student.id AS student_id,
           count(history_daily.attendance_date)::integer AS observed_days,
           count(history_daily.dismissal_time)::integer AS comparable_early_departure_days,
           count(*) FILTER (WHERE history_daily.scan_count = 1)::integer AS missing_departure_days,
           count(*) FILTER (
             WHERE history_daily.scan_count >= 2
               AND history_daily.dismissal_time IS NOT NULL
               AND extract(epoch FROM (history_daily.last_punch_at AT TIME ZONE 'UTC')::time)
                   < extract(epoch FROM history_daily.dismissal_time) - (v_early_threshold_minutes * 60)
           )::integer AS early_departure_days
    FROM class_students AS student
    LEFT JOIN history_daily ON history_daily.student_id = student.id
    GROUP BY student.id
  ),
  assessed AS MATERIALIZED (
    SELECT daily.*,
           history.observed_days,
           history.comparable_early_departure_days,
           history.missing_departure_days,
           history.early_departure_days,
           (daily.arrival_at IS NOT NULL AND daily.departure_at IS NULL) AS missing_departure,
           (
             daily.departure_second IS NOT NULL
             AND daily.departure_second
                 < extract(epoch FROM p_departure_time) - (v_early_threshold_minutes * 60)
           ) AS significantly_early,
           (
             stats.departure_count >= v_minimum_cohort_size
             AND daily.departure_second IS NOT NULL
             AND daily.departure_second < stats.median
             AND CASE
               WHEN stats.mad > 0 THEN
                 (0.6745 * (stats.median - daily.departure_second) / stats.mad) > 3.5
               WHEN stats.iqr > 0 THEN
                 daily.departure_second < (stats.q1 - 1.5 * stats.iqr)
               ELSE
                 daily.departure_second
                   < stats.median - greatest(900, v_early_threshold_minutes * 30)
             END
           ) AS statistical_outlier,
           CASE
             WHEN stats.mad > 0 AND daily.departure_second IS NOT NULL
               THEN round((0.6745 * (stats.median - daily.departure_second) / stats.mad)::numeric, 2)
             ELSE NULL
           END AS modified_z_score,
           CASE
             WHEN daily.departure_second IS NOT NULL
               THEN greatest(0, round((extract(epoch FROM p_departure_time) - daily.departure_second) / 60.0, 1))
             ELSE NULL
           END AS minutes_before_dismissal,
           CASE
             WHEN daily.departure_second IS NOT NULL AND stats.median IS NOT NULL
               THEN greatest(0, round(((stats.median - daily.departure_second) / 60.0)::numeric, 1))
             ELSE NULL
           END AS minutes_before_cohort_median,
           stats.departure_count, stats.q1, stats.median, stats.q3, stats.iqr, stats.mad
    FROM daily
    CROSS JOIN robust_stats AS stats
    JOIN history ON history.student_id = daily.id
  ),
  candidates AS MATERIALIZED (
    SELECT * FROM assessed
    WHERE missing_departure OR significantly_early OR statistical_outlier
  )
  SELECT
    jsonb_build_object(
      'total_active_students', (SELECT count(*) FROM class_students),
      'students_arrived', (SELECT count(*) FROM daily WHERE arrival_at IS NOT NULL),
      'with_departure', stats.departure_count,
      'without_departure', (SELECT count(*) FROM daily WHERE arrival_at IS NOT NULL AND departure_at IS NULL),
      'minimum_size_for_outliers', v_minimum_cohort_size,
      'median_departure_time', CASE WHEN stats.median IS NULL THEN NULL ELSE
        to_char(TIME '00:00:00' + stats.median * INTERVAL '1 second', 'HH24:MI:SS') END,
      'q1_departure_time', CASE WHEN stats.q1 IS NULL THEN NULL ELSE
        to_char(TIME '00:00:00' + stats.q1 * INTERVAL '1 second', 'HH24:MI:SS') END,
      'q3_departure_time', CASE WHEN stats.q3 IS NULL THEN NULL ELSE
        to_char(TIME '00:00:00' + stats.q3 * INTERVAL '1 second', 'HH24:MI:SS') END,
      'iqr_minutes', CASE WHEN stats.iqr IS NULL THEN NULL ELSE round((stats.iqr / 60.0)::numeric, 2) END,
      'mad_minutes', CASE WHEN stats.mad IS NULL THEN NULL ELSE round((stats.mad / 60.0)::numeric, 2) END,
      'statistics_reliable', stats.departure_count >= v_minimum_cohort_size
    ),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'student_id', candidate.id,
          'admission_number', candidate.admission_number,
          'roll_number', candidate.roll_number,
          'student_name', concat_ws(' ', candidate.first_name, candidate.last_name),
          'photo_url', candidate.photo_url,
          'arrival_at', candidate.arrival_at,
          'departure_at', candidate.departure_at,
          'arrival_time', to_char(candidate.arrival_at AT TIME ZONE 'UTC', 'HH24:MI:SS'),
          'departure_time', CASE WHEN candidate.departure_at IS NULL THEN NULL
            ELSE to_char(candidate.departure_at AT TIME ZONE 'UTC', 'HH24:MI:SS') END,
          'scan_count', candidate.scan_count,
          'flags', jsonb_build_object(
            'missing_departure', candidate.missing_departure,
            'significantly_early', candidate.significantly_early,
            'statistical_outlier', candidate.statistical_outlier
          ),
          'evidence', jsonb_build_object(
            'minutes_before_dismissal', candidate.minutes_before_dismissal,
            'minutes_before_cohort_median', candidate.minutes_before_cohort_median,
            'modified_z_score', candidate.modified_z_score,
            'outlier_method', CASE
              WHEN candidate.mad > 0 THEN 'median_mad'
              WHEN candidate.iqr > 0 THEN 'iqr_lower_fence'
              ELSE 'median_distance_fallback'
            END
          ),
          'history', jsonb_build_object(
            'window_days', v_history_window_days,
            'observed_days', candidate.observed_days,
            'comparable_early_departure_days', candidate.comparable_early_departure_days,
            'missing_departure_days', candidate.missing_departure_days,
            'early_departure_days', candidate.early_departure_days
          )
        )
        ORDER BY candidate.roll_number NULLS LAST,
                 concat_ws(' ', candidate.first_name, candidate.last_name)
      )
      FROM candidates AS candidate
    ), '[]'::jsonb)
  INTO v_cohort, v_candidates
  FROM robust_stats AS stats;

  RETURN jsonb_build_object(
    'status', 'ok',
    'algorithm_version', 'departure-risk-v1',
    'generated_at', now(),
    'date', p_date,
    'class', jsonb_build_object(
      'id', p_class_id,
      'name', v_class_name,
      'grade', v_class_grade,
      'section', v_class_section
    ),
    'configuration', jsonb_build_object(
      'departure_time', to_char(p_departure_time, 'HH24:MI:SS'),
      'timezone', v_timezone,
      'early_threshold_minutes', v_early_threshold_minutes,
      'history_window_days', v_history_window_days,
      'minimum_cohort_size', v_minimum_cohort_size,
      'cache_ttl_seconds', v_cache_ttl_seconds
    ),
    'cohort', v_cohort,
    'candidates', v_candidates
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analyze_student_departures(uuid, date, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analyze_student_departures(uuid, date, time) TO service_role;

COMMENT ON FUNCTION public.analyze_student_departures(uuid, date, time) IS
  'Computes missing departure, official-time early departure, robust cohort outliers, and historical recurrence from raw scans.';
