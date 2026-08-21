import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller is authenticated and is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Missing authorization header" });
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse(401, { error: "Invalid or expired token" });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check caller's role
    const { data: callerProfile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (profileErr || !callerProfile) {
      return jsonResponse(403, { error: "Profile not found" });
    }

    if (callerProfile.role !== "admin") {
      return jsonResponse(403, { error: "Only admins can create accounts" });
    }

    // Parse request body
    const body = await req.json();
    const { action = "create", email, password, full_name, role, extra, student_id } = body;

    if (action === "get-student-login" || action === "reset-student-password") {
      if (!student_id) {
        return jsonResponse(400, { error: "Missing required field: student_id" });
      }

      const { data: student, error: studentErr } = await adminClient
        .from("students")
        .select("id, profile_id")
        .eq("id", student_id)
        .maybeSingle();

      if (studentErr || !student) {
        return jsonResponse(404, { error: "Student record not found" });
      }

      if (!student.profile_id) {
        return jsonResponse(404, { error: "This student does not have a login yet" });
      }

      const { data: linkedUser, error: linkedUserErr } = await adminClient.auth.admin
        .getUserById(student.profile_id);

      if (linkedUserErr || !linkedUser.user) {
        return jsonResponse(404, { error: "The linked login account could not be found" });
      }

      if (action === "reset-student-password") {
        if (!password || password.length < 8) {
          return jsonResponse(400, { error: "Password must be at least 8 characters" });
        }

        const { error: resetErr } = await adminClient.auth.admin.updateUserById(
          student.profile_id,
          { password },
        );
        if (resetErr) {
          return jsonResponse(400, { error: resetErr.message });
        }
      }

      return jsonResponse(200, {
        success: true,
        user_id: linkedUser.user.id,
        email: linkedUser.user.email,
        password_reset: action === "reset-student-password",
      });
    }

    if (action !== "create") {
      return jsonResponse(400, { error: "Unsupported action" });
    }

    if (!email || !password || !full_name || !role) {
      return jsonResponse(400, { error: "Missing required fields: email, password, full_name, role" });
    }

    if (role !== "student") {
      return jsonResponse(400, { error: "Role must be 'student'" });
    }

    if (password.length < 8) {
      return jsonResponse(400, { error: "Password must be at least 8 characters" });
    }

    const targetStudentId = extra?.student_id;
    if (!targetStudentId) {
      return jsonResponse(400, { error: "A student record is required to create a student login" });
    }

    const { data: targetStudent, error: targetStudentErr } = await adminClient
      .from("students")
      .select("id, profile_id")
      .eq("id", targetStudentId)
      .maybeSingle();

    if (targetStudentErr || !targetStudent) {
      return jsonResponse(404, { error: "Student record not found" });
    }

    if (targetStudent.profile_id) {
      return jsonResponse(409, { error: "This student already has a login account" });
    }

    // Create the auth user with admin API
    const { data: newUserData, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role, student_id: targetStudentId },
    });

    if (createErr) {
      return jsonResponse(400, { error: createErr.message });
    }

    const newUserId = newUserData.user.id;

    // The auth trigger normally creates this row. Upsert it explicitly so every
    // student login is guaranteed to have the profile ID used by RLS and queries.
    const { error: ensuredProfileErr } = await adminClient
      .from("profiles")
      .upsert({
        id: newUserId,
        full_name,
        role: "student",
        is_active: true,
      }, { onConflict: "id" });

    if (ensuredProfileErr) {
      await adminClient.auth.admin.deleteUser(newUserId);
      return jsonResponse(400, {
        error: `Failed to create student profile: ${ensuredProfileErr.message}`,
      });
    }

    // Link only an unlinked student. If another request won the race, roll back
    // this newly created auth user instead of leaving an orphan login/profile.
    const { data: linkedStudent, error: linkErr } = await adminClient
      .from("students")
      .update({ profile_id: newUserId })
      .eq("id", targetStudentId)
      .is("profile_id", null)
      .select("id, profile_id")
      .maybeSingle();

    if (linkErr || !linkedStudent || linkedStudent.profile_id !== newUserId) {
      await adminClient.auth.admin.deleteUser(newUserId);
      return jsonResponse(400, {
        error: `Failed to link student: ${linkErr?.message ?? "student record is already linked"}`,
      });
    }

    return jsonResponse(200, {
      success: true,
      user_id: newUserId,
      profile_id: newUserId,
      email,
      role,
      full_name,
    });
  } catch (err) {
    return jsonResponse(500, { error: (err as Error).message });
  }
});

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
