import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALGORITHM_VERSION = "departure-risk-v1";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Access-Control-Max-Age": "86400",
};

type RiskLevel = "High" | "Medium" | "Low";
type Confidence = "High" | "Medium" | "Low";
type Category = "missing_departure" | "significantly_early" | "statistical_outlier";

interface RawCandidate {
  student_id: string;
  admission_number: string;
  roll_number: number | null;
  student_name: string;
  photo_url: string | null;
  arrival_at: string;
  departure_at: string | null;
  arrival_time: string;
  departure_time: string | null;
  scan_count: number;
  flags: Record<Category, boolean>;
  evidence: {
    minutes_before_dismissal: number | null;
    minutes_before_cohort_median: number | null;
    modified_z_score: number | null;
    outlier_method: "median_mad" | "iqr_lower_fence" | "median_distance_fallback";
  };
  history: {
    window_days: number;
    observed_days: number;
    comparable_early_departure_days: number;
    missing_departure_days: number;
    early_departure_days: number;
  };
}

interface AnalysisData {
  status: string;
  message?: string;
  algorithm_version: string;
  generated_at: string;
  date: string;
  class: { id: string; name: string; grade: string; section: string };
  configuration: {
    departure_time: string;
    timezone: string;
    early_threshold_minutes: number;
    history_window_days: number;
    minimum_cohort_size: number;
    cache_ttl_seconds: number;
  };
  cohort: {
    total_active_students: number;
    students_arrived: number;
    with_departure: number;
    without_departure: number;
    minimum_size_for_outliers: number;
    median_departure_time: string | null;
    q1_departure_time: string | null;
    q3_departure_time: string | null;
    iqr_minutes: number | null;
    mad_minutes: number | null;
    statistics_reliable: boolean;
  };
  candidates: RawCandidate[];
}

interface RiskReason {
  code: string;
  category: Category | "history";
  message: string;
  evidence: Record<string, string | number | boolean | null>;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const requestId = crypto.randomUUID();
  let authorizedAdmin = false;

  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 4096) return jsonResponse(413, { error: "Request body is too large", request_id: requestId });

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return jsonResponse(401, { error: "Authentication required", request_id: requestId });

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return jsonResponse(401, { error: "Invalid or expired session", request_id: requestId });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError || profile?.role !== "admin" || profile.is_active !== true) {
      return jsonResponse(403, { error: "An active administrator account is required", request_id: requestId });
    }
    authorizedAdmin = true;

    if (request.method === "GET") {
      const url = new URL(request.url);
      const classId = String(url.searchParams.get("class_id") ?? "").trim();
      const date = String(url.searchParams.get("date") ?? "").trim();

      if (!UUID_PATTERN.test(classId)) {
        return jsonResponse(400, { error: "class_id must be a valid UUID", request_id: requestId });
      }
      if (!isValidDate(date)) {
        return jsonResponse(400, {
          error: "date must be a real calendar date in YYYY-MM-DD format",
          request_id: requestId,
        });
      }

      const { data: savedReport, error: savedReportError } = await adminClient
        .from("student_departure_anomaly_reports")
        .select("id, response, created_at, expires_at")
        .eq("class_id", classId)
        .eq("analysis_date", date)
        .eq("algorithm_version", ALGORITHM_VERSION)
        .maybeSingle();

      if (savedReportError) {
        throw new Error(`Could not read saved analysis: ${savedReportError.message}`);
      }
      if (!savedReport) {
        return jsonResponse(404, {
          error: "No saved analysis exists for this class and date",
          code: "saved_analysis_not_found",
          request_id: requestId,
        });
      }

      return jsonResponse(200, {
        ...(savedReport.response as Record<string, unknown>),
        report_id: savedReport.id,
        cached: true,
        saved: true,
        cache_expires_at: savedReport.expires_at,
        request_id: requestId,
      });
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return jsonResponse(400, {
        error: error instanceof Error ? error.message : "Invalid JSON request body",
        request_id: requestId,
      });
    }
    const classId = String(body.class_id ?? "").trim();
    const date = String(body.date ?? "").trim();
    const departureTime = normalizeTime(String(body.departure_time ?? "").trim());

    if (!UUID_PATTERN.test(classId)) {
      return jsonResponse(400, { error: "class_id must be a valid UUID", request_id: requestId });
    }
    if (!isValidDate(date)) {
      return jsonResponse(400, {
        error: "date must be a real calendar date in YYYY-MM-DD format",
        request_id: requestId,
      });
    }
    if (!departureTime) {
      return jsonResponse(400, {
        error: "departure_time must be a valid 24-hour time in HH:MM or HH:MM:SS format",
        request_id: requestId,
      });
    }

    const nowIso = new Date().toISOString();
    const { data: cachedReport, error: cacheReadError } = await adminClient
      .from("student_departure_anomaly_reports")
      .select("id, response, created_at, expires_at")
      .eq("class_id", classId)
      .eq("analysis_date", date)
      .eq("dismissal_time", departureTime)
      .eq("algorithm_version", ALGORITHM_VERSION)
      .gt("expires_at", nowIso)
      .maybeSingle();

    if (cacheReadError) throw new Error(`Could not read analysis cache: ${cacheReadError.message}`);
    if (cachedReport) {
      return jsonResponse(200, {
        ...(cachedReport.response as Record<string, unknown>),
        report_id: cachedReport.id,
        cached: true,
        cache_expires_at: cachedReport.expires_at,
        request_id: requestId,
      });
    }

    const { data: rpcResult, error: analysisError } = await adminClient.rpc(
      "analyze_student_departures",
      { p_class_id: classId, p_date: date, p_departure_time: departureTime },
    );

    if (analysisError) throw new Error(`Departure analysis failed: ${analysisError.message}`);
    const analysis = rpcResult as AnalysisData;

    if (analysis.status !== "ok") {
      const statusCode = analysis.status === "class_not_found"
        ? 404
        : analysis.status === "analysis_not_ready" || analysis.status === "future_date"
        ? 409
        : 422;
      return jsonResponse(statusCode, {
        error: analysis.message ?? "Analysis could not be completed",
        code: analysis.status,
        details: analysis,
        request_id: requestId,
      });
    }

    const { error: departureTimeError } = await adminClient
      .from("class_daily_dismissal_times")
      .upsert({
        class_id: classId,
        dismissal_date: date,
        dismissal_time: departureTime,
        provided_by: authData.user.id,
      }, { onConflict: "class_id,dismissal_date" });

    if (departureTimeError) {
      throw new Error(`Could not store the supplied departure time: ${departureTimeError.message}`);
    }

    const flaggedStudents = analysis.candidates
      .map(candidate => scoreCandidate(candidate, analysis))
      .sort((left, right) => right.risk_score - left.risk_score ||
        (left.roll_number ?? Number.MAX_SAFE_INTEGER) - (right.roll_number ?? Number.MAX_SAFE_INTEGER));

    const response = {
      algorithm_version: ALGORITHM_VERSION,
      generated_at: analysis.generated_at,
      date: analysis.date,
      class: analysis.class,
      configuration: analysis.configuration,
      cohort: analysis.cohort,
      summary: {
        total_flagged: flaggedStudents.length,
        by_category: {
          missing_departure: flaggedStudents.filter(item => item.categories.includes("missing_departure")).length,
          significantly_early: flaggedStudents.filter(item => item.categories.includes("significantly_early")).length,
          statistical_outlier: flaggedStudents.filter(item => item.categories.includes("statistical_outlier")).length,
        },
        by_risk_level: {
          high: flaggedStudents.filter(item => item.risk_level === "High").length,
          medium: flaggedStudents.filter(item => item.risk_level === "Medium").length,
          low: flaggedStudents.filter(item => item.risk_level === "Low").length,
        },
      },
      flagged_students: flaggedStudents,
    };

    const ttlSeconds = clamp(Number(analysis.configuration.cache_ttl_seconds) || 300, 30, 3600);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const { data: savedReport, error: cacheWriteError } = await adminClient
      .from("student_departure_anomaly_reports")
      .upsert({
        class_id: classId,
        analysis_date: date,
        dismissal_time: departureTime,
        algorithm_version: ALGORITHM_VERSION,
        response,
        created_by: authData.user.id,
        created_at: nowIso,
        expires_at: expiresAt,
      }, { onConflict: "class_id,analysis_date,algorithm_version" })
      .select("id, expires_at")
      .single();

    if (cacheWriteError) {
      throw new Error(`Analysis completed but could not be saved: ${cacheWriteError.message}`);
    }

    return jsonResponse(200, {
      ...response,
      report_id: savedReport?.id ?? null,
      cached: false,
      cache_expires_at: savedReport?.expires_at ?? expiresAt,
      request_id: requestId,
    });
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      requestId,
      event: "departure_analysis_failed",
      error: internalMessage,
    }));
    return jsonResponse(500, {
      error: "Could not complete departure analysis",
      code: "departure_analysis_backend_error",
      ...(authorizedAdmin ? { details: internalMessage } : {}),
      request_id: requestId,
    });
  }
});

function scoreCandidate(candidate: RawCandidate, analysis: AnalysisData) {
  const reasons: RiskReason[] = [];
  const categories: Category[] = [];
  let score = 0;

  if (candidate.flags.missing_departure) {
    categories.push("missing_departure");
    score += 55;
    reasons.push({
      code: "NO_DEPARTURE_SCAN",
      category: "missing_departure",
      message: `Arrival was recorded at ${candidate.arrival_time}, but no later departure scan was found.`,
      evidence: { arrival_time: candidate.arrival_time, scan_count: candidate.scan_count },
    });
  }

  if (candidate.flags.significantly_early) {
    categories.push("significantly_early");
    const minutes = numberOrZero(candidate.evidence.minutes_before_dismissal);
    const excess = Math.max(0, minutes - analysis.configuration.early_threshold_minutes);
    score += 45 + Math.min(20, Math.floor(excess / 5));
    reasons.push({
      code: "EARLY_BEFORE_OFFICIAL_DISMISSAL",
      category: "significantly_early",
      message: `Departure was ${minutes} minutes before the supplied ${analysis.configuration.departure_time} departure time.`,
      evidence: {
        actual_departure_time: candidate.departure_time,
        supplied_departure_time: analysis.configuration.departure_time,
        minutes_before_dismissal: minutes,
        configured_threshold_minutes: analysis.configuration.early_threshold_minutes,
      },
    });
  }

  if (candidate.flags.statistical_outlier) {
    categories.push("statistical_outlier");
    const minutes = numberOrZero(candidate.evidence.minutes_before_cohort_median);
    const zScore = numberOrZero(candidate.evidence.modified_z_score);
    score += 40 + Math.min(20, Math.max(Math.floor(minutes / 5), Math.floor(zScore * 2)));
    reasons.push({
      code: "EARLY_COHORT_OUTLIER",
      category: "statistical_outlier",
      message: `Departure was ${minutes} minutes earlier than the class median and crossed the robust outlier threshold.`,
      evidence: {
        departure_time: candidate.departure_time,
        cohort_median_departure_time: analysis.cohort.median_departure_time,
        minutes_before_cohort_median: minutes,
        modified_z_score: candidate.evidence.modified_z_score,
        method: candidate.evidence.outlier_method,
        cohort_departures: analysis.cohort.with_departure,
      },
    });
  }

  const observedDays = numberOrZero(candidate.history.observed_days);
  const comparableEarlyDays = numberOrZero(candidate.history.comparable_early_departure_days);
  const repeatedMissing = numberOrZero(candidate.history.missing_departure_days);
  const repeatedEarly = numberOrZero(candidate.history.early_departure_days);

  if (repeatedMissing >= 2) {
    score += Math.min(15, repeatedMissing * 3);
    reasons.push({
      code: "REPEATED_MISSING_DEPARTURES",
      category: "history",
      message: `${repeatedMissing} earlier days in the history window also had no departure scan.`,
      evidence: { occurrences: repeatedMissing, observed_days: observedDays, window_days: candidate.history.window_days },
    });
  }
  if (repeatedEarly >= 2) {
    score += Math.min(15, repeatedEarly * 3);
    reasons.push({
      code: "REPEATED_EARLY_DEPARTURES",
      category: "history",
      message: `${repeatedEarly} earlier days also had a significantly early departure.`,
      evidence: {
        occurrences: repeatedEarly,
        comparable_days: comparableEarlyDays,
        window_days: candidate.history.window_days,
      },
    });
  }

  if (observedDays >= 5) {
    const relevantHistoryCount = candidate.flags.missing_departure ? repeatedMissing : repeatedEarly;
    const relevantHistoryDays = candidate.flags.missing_departure ? observedDays : comparableEarlyDays;
    const recurrenceRate = relevantHistoryDays > 0 ? relevantHistoryCount / relevantHistoryDays : 0;
    score += Math.min(10, Math.floor(recurrenceRate * 20));
  }

  score = clamp(Math.round(score), 0, 100);
  const riskLevel: RiskLevel = score >= 75 ? "High" : score >= 50 ? "Medium" : "Low";
  const confidence = confidenceLevel(candidate, analysis);

  return {
    student_id: candidate.student_id,
    admission_number: candidate.admission_number,
    roll_number: candidate.roll_number,
    student_name: candidate.student_name,
    photo_url: candidate.photo_url,
    arrival_at: candidate.arrival_at,
    departure_at: candidate.departure_at,
    arrival_time: candidate.arrival_time,
    departure_time: candidate.departure_time,
    scan_count: candidate.scan_count,
    categories,
    risk_score: score,
    risk_level: riskLevel,
    confidence,
    reasons,
    evidence: candidate.evidence,
    history: candidate.history,
  };
}

function confidenceLevel(candidate: RawCandidate, analysis: AnalysisData): Confidence {
  let points = candidate.flags.missing_departure ? 2 : 1;
  const relevantHistoryDays = candidate.flags.missing_departure
    ? candidate.history.observed_days
    : candidate.history.comparable_early_departure_days;
  if (analysis.cohort.statistics_reliable) points += 2;
  if (relevantHistoryDays >= 5) points += 1;
  if (relevantHistoryDays >= 15) points += 1;
  return points >= 5 ? "High" : points >= 3 ? "Medium" : "Low";
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) throw new Error("Request body is required");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function isValidDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function normalizeTime(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${match[1]}:${match[2]}:${String(second).padStart(2, "0")}`;
}

function numberOrZero(value: number | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
