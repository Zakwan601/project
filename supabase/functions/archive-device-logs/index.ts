import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeviceLogRow = {
  id: string;
  device_id: string | null;
  archive_class_id: string;
  student_biometric_id: string;
  punched_at: string;
  processed: boolean;
  attendance_record_id: string | null;
  raw_data: unknown;
  created_at: string | null;
};

type StudentSummary = {
  admission_number: string;
  first_name: string;
  last_name: string;
  photo_url: string | null;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  let archiveDb: ReturnType<typeof postgres> | null = null;
  try {
    const body = await readJsonBody(request);
    const action = String(body.action ?? "query");
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    archiveDb = postgres(requiredEnv("ARCHIVE_DATABASE_URL"), {
      ssl: archiveDatabaseSsl(),
      max: 1,
      prepare: false,
      connect_timeout: 15,
      idle_timeout: 5,
    });

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return jsonResponse(401, { error: "Authentication required" });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse(401, { error: "Invalid session" });

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role,is_active")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError || !profile?.is_active) {
      return jsonResponse(403, { error: "An active profile is required" });
    }

    if (action === "archive") {
      if (profile.role !== "admin") {
        return jsonResponse(403, { error: "Only a full administrator can archive punches" });
      }

      const classId = String(body.classId ?? "");
      if (!uuidPattern.test(classId)) {
        return jsonResponse(400, { error: "A valid classId is required" });
      }
      const { data: selectedClass, error: classError } = await adminClient
        .from("classes")
        .select("id,name,grade,section")
        .eq("id", classId)
        .maybeSingle();
      if (classError) throw classError;
      if (!selectedClass) return jsonResponse(404, { error: "Class not found" });

      const archiveBefore = String(body.archiveBefore ?? "");
      if (!isValidDate(archiveBefore)) {
        return jsonResponse(400, { error: "archiveBefore must be a real date in YYYY-MM-DD format" });
      }
      const today = dateInTimeZone(new Date(), "Asia/Dhaka");
      if (archiveBefore > today) {
        return jsonResponse(400, { error: "The archive cutoff cannot be in the future" });
      }

      const batchSize = boundedInteger(body.batchSize, 500, 1, 1000);
      const maxBatches = boundedInteger(body.maxBatches, 20, 1, 50);
      const cutoff = new Date(archiveBefore + "T00:00:00+06:00").toISOString();
      await archiveDb.unsafe("select 1 as connected");
      const { data: archiveRun, error: archiveRunError } = await adminClient
        .from("device_log_archive_runs")
        .insert({
          archive_before: archiveBefore,
          class_id: classId,
          archived_rows: 0,
          deleted_rows: 0,
          requested_by: authData.user.id,
        })
        .select("id")
        .single();
      if (archiveRunError) throw archiveRunError;

      let archived = 0;
      let deleted = 0;

      for (let batch = 0; batch < maxBatches; batch += 1) {
        const { data, error } = await adminClient.rpc(
          "get_class_device_logs_for_archive",
          {
            p_class_id: classId,
            p_archive_before: archiveBefore,
            p_limit: batchSize,
          },
        );

        if (error) throw error;
        const rows = (data ?? []) as DeviceLogRow[];
        if (rows.length === 0) break;

        await archiveDb.begin(async transaction => {
          await Promise.all(rows.map(row => transaction.unsafe(
            "insert into public.device_logs_archive " +
              "(id, device_id, class_id, student_biometric_id, punched_at, processed, attendance_record_id, raw_data, source_created_at, archived_at) " +
              "values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz, $6::boolean, $7::uuid, $8::jsonb, $9::timestamptz, now()) " +
              "on conflict (id) do update set " +
              "device_id = excluded.device_id, class_id = excluded.class_id, student_biometric_id = excluded.student_biometric_id, " +
              "punched_at = excluded.punched_at, processed = excluded.processed, " +
              "attendance_record_id = excluded.attendance_record_id, raw_data = excluded.raw_data, " +
              "source_created_at = excluded.source_created_at",
            [
              row.id,
              row.device_id,
              row.archive_class_id,
              row.student_biometric_id,
              row.punched_at,
              row.processed,
              row.attendance_record_id,
              JSON.stringify(row.raw_data ?? null),
              row.created_at,
            ],
          )));
        });

        const ids = rows.map(row => row.id);
        const verification = await archiveDb.unsafe(
          "select count(*)::integer as count from public.device_logs_archive where id = any($1::uuid[])",
          [ids],
        );
        const confirmed = Number(verification[0]?.count ?? 0);
        if (confirmed !== ids.length) {
          throw new Error("Archive verification failed; no source rows were deleted");
        }

        const { error: deleteError, count } = await adminClient
          .from("device_logs")
          .delete({ count: "exact" })
          .in("id", ids);
        if (deleteError) throw deleteError;

        archived += confirmed;
        deleted += count ?? ids.length;
        if (rows.length < batchSize) break;
      }

      const { data: remaining, error: remainingError } = await adminClient.rpc(
        "get_class_device_logs_for_archive",
        {
          p_class_id: classId,
          p_archive_before: archiveBefore,
          p_limit: 1,
        },
      );
      if (remainingError) throw remainingError;
      const hasMore = (remaining ?? []).length > 0;

      const { error: runError } = await adminClient
        .from("device_log_archive_runs")
        .update({ archived_rows: archived, deleted_rows: deleted })
        .eq("id", archiveRun.id);
      if (runError) throw runError;

      return jsonResponse(200, {
        archive_before: archiveBefore,
        class_id: classId,
        class_name: selectedClass.name,
        archived,
        deleted,
        has_more: hasMore,
      });
    }

    if (action !== "query") return jsonResponse(400, { error: "Unknown action" });
    if (profile.role !== "admin") {
      return jsonResponse(403, { error: "Only a full administrator can view archived punches" });
    }

    const date = String(body.date ?? "");
    if (!isValidDate(date)) {
      return jsonResponse(400, { error: "A real date in YYYY-MM-DD format is required" });
    }

    const includeHot = body.includeHot === true;
    const page = boundedInteger(body.page, 1, 1, 1_000_000);
    const pageSize = boundedInteger(body.pageSize, 25, 1, 100);
    const search = String(body.search ?? "").trim().toLowerCase();
    const requestedAdmission = String(body.admissionNumber ?? "").trim();
    const requestedClassId = String(body.classId ?? "").trim();
    if (requestedClassId && !uuidPattern.test(requestedClassId)) {
      return jsonResponse(400, { error: "classId must be a valid UUID" });
    }
    let allowedAdmissions: string[] | null = null;

    if (profile.role === "student") {
      const { data: linkedStudent, error: studentError } = await adminClient
        .from("students")
        .select("admission_number")
        .eq("profile_id", authData.user.id)
        .maybeSingle();
      if (studentError || !linkedStudent) {
        return jsonResponse(403, { error: "Student profile is not linked" });
      }
      if (requestedAdmission && requestedAdmission !== linkedStudent.admission_number) {
        return jsonResponse(403, { error: "Students can only view their own punches" });
      }
      allowedAdmissions = [linkedStudent.admission_number];
    } else {
      const { data: allowed, error: permissionError } = await userClient.rpc("has_permission", {
        p_permission_key: "punches",
        p_access: "read",
      });
      if (permissionError || allowed !== true) {
        return jsonResponse(403, { error: "Punch read permission is required" });
      }

      if (requestedAdmission) allowedAdmissions = [requestedAdmission];
      if (search) {
        const students = await loadStudents(adminClient);
        const matches = students
          .filter(student => (
            student.admission_number.toLowerCase().includes(search) ||
            (student.first_name + " " + student.last_name).toLowerCase().includes(search)
          ))
          .map(student => student.admission_number);
        allowedAdmissions = allowedAdmissions
          ? allowedAdmissions.filter(admission => matches.includes(admission))
          : matches;
      }
    }

    if (requestedClassId) {
      const { data: classStudents, error: classStudentsError } = await adminClient.rpc(
        "get_class_students_for_period",
        {
          p_class_id: requestedClassId,
          p_start_date: date,
          p_end_date: date,
        },
      );
      if (classStudentsError) throw classStudentsError;
      const classAdmissions = new Set(
        (classStudents ?? []).map((student: { admission_number: string }) =>
          String(student.admission_number)
        ),
      );
      allowedAdmissions = allowedAdmissions
        ? allowedAdmissions.filter(admission => classAdmissions.has(admission))
        : [...classAdmissions];
    }

    if (allowedAdmissions && allowedAdmissions.length === 0) {
      return jsonResponse(200, { rows: [], total: 0, source: "archive" });
    }

    const start = new Date(date + "T00:00:00+06:00").toISOString();
    const end = new Date(new Date(start).getTime() + 86_400_000).toISOString();
    const params: unknown[] = [start, end];
    let admissionClause = "";

    if (allowedAdmissions) {
      params.push(allowedAdmissions);
      admissionClause = " and student_biometric_id = any($3::text[])";
    }

    const archivedRows = await archiveDb.unsafe(
      "select student_biometric_id, (punched_at at time zone 'Asia/Dhaka')::date as punch_date, " +
        "array_agg(id order by punched_at, id) as punch_ids, " +
        "array_agg(punched_at order by punched_at, id) as punch_times " +
        "from public.device_logs_archive " +
        "where punched_at >= $1::timestamptz and punched_at < $2::timestamptz" + admissionClause + " " +
        "group by student_biometric_id, (punched_at at time zone 'Asia/Dhaka')::date",
      params,
    );

    let hotRows: Array<{ id: string; student_biometric_id: string; punched_at: string }> = [];
    if (includeHot) {
      let hotQuery = adminClient
        .from("device_logs")
        .select("id,student_biometric_id,punched_at")
        .gte("punched_at", start)
        .lt("punched_at", end)
        .order("punched_at");

      if (allowedAdmissions) hotQuery = hotQuery.in("student_biometric_id", allowedAdmissions);
      const { data, error: hotError } = await hotQuery;
      if (hotError) throw hotError;
      hotRows = data ?? [];
    }

    type CombinedGroup = {
      student_biometric_id: string;
      punch_date: string;
      punches: Map<string, string>;
    };
    const groups = new Map<string, CombinedGroup>();

    const addPunch = (admission: string, punchDate: string, id: string, punchedAt: string) => {
      const key = admission + ":" + punchDate;
      const group = groups.get(key) ?? {
        student_biometric_id: admission,
        punch_date: punchDate,
        punches: new Map<string, string>(),
      };
      group.punches.set(id, punchedAt);
      groups.set(key, group);
    };

    for (const row of archivedRows) {
      const admission = String(row.student_biometric_id);
      const punchDate = String(row.punch_date);
      const ids = (row.punch_ids as unknown[]).map(String);
      const times = (row.punch_times as Array<Date | string>).map(value =>
        value instanceof Date ? value.toISOString() : String(value)
      );
      times.forEach((punchedAt, index) => addPunch(admission, punchDate, ids[index], punchedAt));
    }

    for (const row of hotRows ?? []) {
      addPunch(
        String(row.student_biometric_id),
        date,
        String(row.id),
        String(row.punched_at),
      );
    }

    const combined = [...groups.values()]
      .map(group => {
        const punches = [...group.punches.entries()]
          .sort((left, right) => left[1].localeCompare(right[1]));
        return {
          student_biometric_id: group.student_biometric_id,
          punch_date: group.punch_date,
          punch_ids: punches.map(punch => punch[0]),
          punch_times: punches.map(punch => punch[1]),
        };
      })
      .sort((left, right) =>
        right.punch_times[0].localeCompare(left.punch_times[0]) ||
        left.student_biometric_id.localeCompare(right.student_biometric_id)
      );

    const total = combined.length;
    const offset = (page - 1) * pageSize;
    const pageRows = combined.slice(offset, offset + pageSize);
    const admissions = pageRows.map(row => row.student_biometric_id);
    const students = admissions.length > 0
      ? await loadStudents(adminClient, admissions)
      : [];
    const studentByAdmission = new Map(students.map(student => [student.admission_number, student]));

    return jsonResponse(200, {
      source: includeHot ? "archive+hot" : "archive",
      total,
      rows: pageRows.map(row => {
        const student = studentByAdmission.get(row.student_biometric_id);
        return {
          ...row,
          first_name: student?.first_name ?? null,
          last_name: student?.last_name ?? null,
          photo_url: student?.photo_url ?? null,
          total_count: total,
        };
      }),
    });
  } catch (error) {
    console.error("Device-log archive request failed:", error);
    return jsonResponse(500, { error: (error as Error).message });
  } finally {
    if (archiveDb) await archiveDb.end({ timeout: 5 });
  }
});

async function loadStudents(
  client: ReturnType<typeof createClient>,
  admissions?: string[],
): Promise<StudentSummary[]> {
  const pageSize = 1000;
  const students: StudentSummary[] = [];
  let from = 0;

  while (true) {
    let query = client
      .from("students")
      .select("admission_number,first_name,last_name,photo_url")
      .order("admission_number")
      .range(from, from + pageSize - 1);

    if (admissions) query = query.in("admission_number", admissions);

    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as StudentSummary[];
    students.push(...page);
    if (page.length < pageSize || admissions) break;
    from += pageSize;
  }

  return students;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function isValidDate(value: string) {
  if (!datePattern.test(value)) return false;
  const parts = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return parsed.getUTCFullYear() === parts[0] &&
    parsed.getUTCMonth() === parts[1] - 1 &&
    parsed.getUTCDate() === parts[2];
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
function archiveDatabaseSsl() {
  const encodedCa = requiredEnv("ARCHIVE_DATABASE_CA_BASE64").replace(/\s+/g, "");
  const lines = encodedCa.match(/.{1,64}/g);
  if (!lines) throw new Error("ARCHIVE_DATABASE_CA_BASE64 is invalid");
  return {
    ca: `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`,
    rejectUnauthorized: true,
  };
}
function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(name + " is not configured");
  return value;
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
