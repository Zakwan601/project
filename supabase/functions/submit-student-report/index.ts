import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const categories = new Set(["attendance", "academic", "safety", "technical", "other"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(401, { error: "Authentication required" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse(401, { error: "Invalid session" });

    const { data: student, error: studentError } = await adminClient
      .from("students")
      .select("id, admission_number, first_name, last_name, is_active")
      .eq("profile_id", authData.user.id)
      .maybeSingle();

    if (studentError || !student?.is_active) {
      return jsonResponse(403, { error: "An active student profile is required" });
    }

    const body = await req.json();
    const category = String(body.category ?? "").trim().toLowerCase();
    const subject = String(body.subject ?? "").trim();
    const message = String(body.message ?? "").trim();

    if (!categories.has(category)) return jsonResponse(400, { error: "Invalid category" });
    if (subject.length < 3 || subject.length > 120) {
      return jsonResponse(400, { error: "Subject must be between 3 and 120 characters" });
    }
    if (message.length < 10 || message.length > 2000) {
      return jsonResponse(400, { error: "Message must be between 10 and 2000 characters" });
    }

    const { data: report, error: insertError } = await adminClient
      .from("student_reports")
      .insert({ student_id: student.id, category, subject, message })
      .select("*")
      .single();

    if (insertError) return jsonResponse(400, { error: insertError.message });

    let discordDelivered = false;
    const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
    if (webhookUrl) {
      try {
        const discordResponse = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "Axentra@Zuanshi Reports",
            allowed_mentions: { parse: [] },
            embeds: [{
              title: `New student report: ${subject}`,
              description: message,
              color: category === "safety" ? 15158332 : 3447003,
              fields: [
                { name: "Student", value: `${student.first_name} ${student.last_name}`, inline: true },
                { name: "Admission", value: student.admission_number, inline: true },
                { name: "Category", value: category, inline: true },
              ],
              timestamp: report.created_at,
              footer: { text: `Report ${report.id}` },
            }],
          }),
        });
        discordDelivered = discordResponse.ok;
      } catch (discordError) {
        console.error("Discord delivery failed:", discordError);
      }
    }

    if (discordDelivered) {
      await adminClient
        .from("student_reports")
        .update({ discord_delivered: true })
        .eq("id", report.id);
    }

    return jsonResponse(200, { report: { ...report, discord_delivered: discordDelivered }, discord_delivered: discordDelivered });
  } catch (error) {
    return jsonResponse(500, { error: (error as Error).message });
  }
});

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
