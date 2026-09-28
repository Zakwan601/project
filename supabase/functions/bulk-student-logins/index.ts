import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "student-login-exports";
const MAX_STUDENTS = 500;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Access-Control-Expose-Headers": "Content-Disposition",
};

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  admission_number: string;
  roll_number: number | null;
  profile_id: string | null;
  classes: { name?: string; section?: string } | Array<{ name?: string; section?: string }> | null;
};

type CreatedCredential = {
  name: string;
  rollNumber: number | null;
  className: string;
  email: string;
  password: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(401, { error: "Missing authorization header" });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse(401, { error: "Invalid or expired token" });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: caller } = await adminClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!caller || caller.role !== "admin" || caller.is_active === false) {
      return jsonResponse(403, { error: "Only active administrators can create student logins" });
    }

    await cleanupExpiredExports(adminClient);
    const body = await req.json();
    if (body.action === "download") {
      return downloadOnce(adminClient, userData.user.id, body.export_id);
    }
    if (body.action !== "create") {
      return jsonResponse(400, { error: "Unsupported action" });
    }

    const studentIds = Array.from(new Set(
      Array.isArray(body.student_ids) ? body.student_ids.filter((id: unknown) => typeof id === "string") : [],
    )) as string[];
    if (studentIds.length === 0) {
      return jsonResponse(400, { error: "Select at least one student" });
    }
    if (studentIds.length > MAX_STUDENTS) {
      return jsonResponse(400, { error: `A maximum of ${MAX_STUDENTS} students can be processed at once` });
    }

    const domain = String(body.domain || "nmdc.edu").trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || !domain.includes(".")) {
      return jsonResponse(400, { error: "The student login domain is invalid" });
    }

    const { data, error: studentError } = await adminClient
      .from("students")
      .select("id, first_name, last_name, admission_number, roll_number, profile_id, classes(name, section)")
      .in("id", studentIds)
      .eq("is_active", true);
    if (studentError) throw studentError;

    const students = (data ?? []) as StudentRow[];
    const order = new Map(studentIds.map((id, index) => [id, index]));
    students.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));

    const credentials: CreatedCredential[] = [];
    const failures: Array<{ student_id: string; name: string; error: string }> = [];
    let skipped = studentIds.length - students.length;

    for (let index = 0; index < students.length; index += 5) {
      const results = await Promise.all(students.slice(index, index + 5).map(student =>
        createStudentLogin(adminClient, student, domain)
      ));
      for (const result of results) {
        if (result.status === "created") credentials.push(result.credential);
        else if (result.status === "skipped") skipped += 1;
        else failures.push(result.failure);
      }
    }

    if (credentials.length === 0) {
      return jsonResponse(409, {
        error: failures.length > 0
          ? "No student logins were created. Review the reported failures."
          : "All selected students already have login accounts.",
        created: 0,
        skipped,
        failed: failures.length,
        failures: failures.slice(0, 20),
      });
    }

    const exportId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `student-login-credentials-${timestamp}.csv`;
    const objectPath = `${userData.user.id}/${exportId}.csv`;
    const csv = buildCsv(credentials);
    const { error: uploadError } = await adminClient.storage
      .from(BUCKET)
      .upload(objectPath, new Blob([csv], { type: "text/csv;charset=utf-8" }), {
        contentType: "text/csv",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { error: metadataError } = await adminClient.from("student_login_exports").insert({
      id: exportId,
      object_path: objectPath,
      file_name: fileName,
      created_by: userData.user.id,
      created_count: credentials.length,
      skipped_count: skipped,
      failed_count: failures.length,
    });
    if (metadataError) {
      await adminClient.storage.from(BUCKET).remove([objectPath]);
      throw metadataError;
    }

    return jsonResponse(200, {
      export_id: exportId,
      file_name: fileName,
      created: credentials.length,
      skipped,
      failed: failures.length,
      failures: failures.slice(0, 20),
      expires_in_hours: 24,
    });
  } catch (error) {
    return jsonResponse(500, { error: (error as Error).message });
  }
});

async function createStudentLogin(
  adminClient: ReturnType<typeof createClient>,
  student: StudentRow,
  domain: string,
) {
  const name = `${student.first_name} ${student.last_name}`.trim();
  if (student.profile_id) return { status: "skipped" as const };

  const localPart = student.admission_number.toLowerCase().replace(/[^a-z0-9._-]/g, "")
    || student.id.slice(0, 8);
  const email = `${localPart}@${domain}`;
  const password = makePassword();
  const { data: authData, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: name,
      role: "student",
      student_id: student.id,
      must_change_password: true,
    },
  });
  if (createError || !authData.user) {
    return {
      status: "failed" as const,
      failure: { student_id: student.id, name, error: createError?.message ?? "Account creation failed" },
    };
  }

  const userId = authData.user.id;
  const { error: profileError } = await adminClient.from("profiles").upsert({
    id: userId,
    full_name: name,
    role: "student",
    is_active: true,
  }, { onConflict: "id" });
  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId);
    return {
      status: "failed" as const,
      failure: { student_id: student.id, name, error: profileError.message },
    };
  }

  const { data: linked, error: linkError } = await adminClient
    .from("students")
    .update({ profile_id: userId })
    .eq("id", student.id)
    .is("profile_id", null)
    .select("id")
    .maybeSingle();
  if (linkError || !linked) {
    await adminClient.auth.admin.deleteUser(userId);
    return {
      status: "failed" as const,
      failure: {
        student_id: student.id,
        name,
        error: linkError?.message ?? "The student was linked by another request",
      },
    };
  }

  const relatedClass = Array.isArray(student.classes) ? student.classes[0] : student.classes;
  const className = relatedClass
    ? [relatedClass.name, relatedClass.section && `Section ${relatedClass.section}`].filter(Boolean).join(" - ")
    : "";
  return {
    status: "created" as const,
    credential: {
      name,
      rollNumber: student.roll_number,
      className,
      email,
      password,
    },
  };
}

async function downloadOnce(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  exportId: unknown,
) {
  if (typeof exportId !== "string") return jsonResponse(400, { error: "Missing export ID" });

  const claimedAt = new Date().toISOString();
  const { data: record, error: claimError } = await adminClient
    .from("student_login_exports")
    .update({ downloaded_at: claimedAt })
    .eq("id", exportId)
    .eq("created_by", userId)
    .is("downloaded_at", null)
    .gt("expires_at", claimedAt)
    .select("id, object_path, file_name")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!record) {
    return jsonResponse(404, { error: "This export is unavailable, expired, or has already been downloaded" });
  }

  const { data: file, error: downloadError } = await adminClient.storage
    .from(BUCKET)
    .download(record.object_path);
  if (downloadError || !file) {
    await adminClient.from("student_login_exports")
      .update({ downloaded_at: null }).eq("id", record.id).eq("downloaded_at", claimedAt);
    throw downloadError ?? new Error("Credential file could not be read");
  }

  const bytes = await file.arrayBuffer();
  const { error: removeError } = await adminClient.storage.from(BUCKET).remove([record.object_path]);
  if (removeError) {
    console.error("Credential export could not be deleted after download", removeError.message);
  }

  const safeName = String(record.file_name).replace(/[\r\n"]/g, "");
  return new Response(bytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache",
    },
  });
}

async function cleanupExpiredExports(adminClient: ReturnType<typeof createClient>) {
  const now = new Date().toISOString();
  const { data } = await adminClient.from("student_login_exports")
    .select("id, object_path")
    .lt("expires_at", now)
    .limit(100);
  if (!data?.length) return;
  await adminClient.storage.from(BUCKET).remove(data.map(record => record.object_path));
  await adminClient.from("student_login_exports").delete().in("id", data.map(record => record.id));
}

function makePassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "!@#$%";
  const all = upper + lower + numbers + symbols;
  const pick = (characters: string) => {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return characters[values[0] % characters.length];
  };
  const characters = [pick(upper), pick(lower), pick(numbers), pick(symbols)];
  while (characters.length < 12) characters.push(pick(all));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    const swapIndex = values[0] % (index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

function buildCsv(credentials: CreatedCredential[]) {
  const rows = [
    ["Student Name", "Roll", "Class", "Login Email", "Temporary Password"],
    ...credentials.map(item => [
      item.name,
      item.rollNumber,
      item.className,
      item.email,
      item.password,
    ]),
  ];
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string | number | null) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
