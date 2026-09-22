import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Sync-Secret",
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");
    const suppliedSyncSecret = req.headers.get("X-Sync-Secret");
    const configuredSyncSecret = Deno.env.get("ATTENDANCE_SYNC_SECRET");

    const isServiceRequest = Boolean(
      configuredSyncSecret &&
      suppliedSyncSecret &&
      await secretsMatch(suppliedSyncSecret, configuredSyncSecret),
    );

    let userClient: ReturnType<typeof createClient> | null = null;

    if (!isServiceRequest) {
      if (!authHeader) return jsonResponse(401, { error: "Authentication required" });

      userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: authData, error: authError } = await userClient.auth.getUser();
      if (authError || !authData.user) return jsonResponse(401, { error: "Invalid session" });

      const { data: profile, error: profileError } = await userClient
        .from("profiles")
        .select("is_active")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (profileError || !profile?.is_active) {
        return jsonResponse(403, { error: "An active user profile is required" });
      }

      const { data: allowed, error: permissionError } = await userClient.rpc("has_permission", {
        p_permission_key: "attendance",
        p_access: "write",
      });
      if (permissionError || allowed !== true) {
        return jsonResponse(403, { error: "Attendance write permission is required" });
      }
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return jsonResponse(400, { error: (error as Error).message });
    }
    const date = body.date == null || body.date === ""
      ? dateInTimeZone(new Date(), "Asia/Dhaka")
      : String(body.date);

    if (!isValidDate(date)) {
      return jsonResponse(400, { error: "date must be a real calendar date in YYYY-MM-DD format" });
    }

    const rpcClient = isServiceRequest
      ? createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : userClient!;

    const { data: dateIsArchived, error: archiveStatusError } = await rpcClient.rpc(
      "is_device_log_date_archived",
      { p_date: date },
    );
    if (archiveStatusError) {
      return jsonResponse(400, { error: archiveStatusError.message });
    }

    if (dateIsArchived === true) {
      const archiveDb = postgres(requiredEnv("ARCHIVE_DATABASE_URL"), {
        ssl: "require",
        max: 1,
        prepare: false,
        connect_timeout: 15,
        idle_timeout: 5,
      });

      try {
        const start = new Date(date + "T00:00:00+06:00").toISOString();
        const end = new Date(new Date(start).getTime() + 86_400_000).toISOString();
        const archivedPunches = await archiveDb.unsafe(
          "select id, student_biometric_id, punched_at " +
            "from public.device_logs_archive " +
            "where punched_at >= $1::timestamptz and punched_at < $2::timestamptz " +
            "order by punched_at, id",
          [start, end],
        );

        const archiveRpcClient = createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: hotPunches, error: hotPunchesError } = await archiveRpcClient
          .from("device_logs")
          .select("id,student_biometric_id,punched_at")
          .gte("punched_at", start)
          .lt("punched_at", end)
          .order("punched_at");
        if (hotPunchesError) return jsonResponse(400, { error: hotPunchesError.message });

        const punchesById = new Map<string, {
          id: string;
          student_biometric_id: string;
          punched_at: string;
        }>();
        for (const row of [...archivedPunches, ...(hotPunches ?? [])]) {
          const id = String(row.id);
          punchesById.set(id, {
            id,
            student_biometric_id: String(row.student_biometric_id),
            punched_at: row.punched_at instanceof Date
              ? row.punched_at.toISOString()
              : String(row.punched_at),
          });
        }

        const { data, error } = await archiveRpcClient.rpc(
          "sync_archived_attendance_as_service",
          {
            p_date: date,
            p_punches: [...punchesById.values()],
          },
        );

        if (error) return jsonResponse(400, { error: error.message });
        return jsonResponse(200, {
          ...data as Record<string, unknown>,
          invoked_by: isServiceRequest ? "service" : "user",
        });
      } finally {
        await archiveDb.end({ timeout: 5 });
      }
    }

    const rpcName = isServiceRequest
      ? "sync_daily_attendance_as_service"
      : "sync_daily_attendance";
    const { data, error } = await rpcClient.rpc(rpcName, { p_date: date });

    if (error) return jsonResponse(400, { error: error.message });

    return jsonResponse(200, {
      ...data as Record<string, unknown>,
      invoked_by: isServiceRequest ? "service" : "user",
      source: "hot",
    });
  } catch (error) {
    console.error("Attendance sync failed:", error);
    return jsonResponse(500, { error: (error as Error).message });
  }
});

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};

  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function dateInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isValidDate(value: string) {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

async function secretsMatch(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
