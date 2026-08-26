import { createClient } from "jsr:@supabase/supabase-js@2";

interface AutomasResponseItem {
  status?: number | string;
  id?: string | number;
  msisdn?: string;
  recipient?: string;
  message?: string;
}

interface SendToAutomasInput {
  apiKey: string;
  senderId: string;
  contacts: string[];
  message: string;
  scheduledDateTime?: string;
}

interface RecipientResult {
  recipient: string;
  accepted: boolean;
  providerMessageId: string | null;
  providerStatusCode: number | null;
  providerStatusText: string;
  providerItem: AutomasResponseItem | null;
}

interface AutomasSendResult {
  httpStatus: number;
  responseBody: unknown;
  recipients: RecipientResult[];
}

function normalizePhoneNumber(value: string): string {
  let number = String(value ?? "").trim().replace(/\D/g, "");

  if (number.startsWith("00880")) number = number.slice(2);
  if (number.startsWith("01") && number.length === 11) number = `88${number}`;

  return number;
}

function normalizeContacts(input: string | string[]): string[] {
  const values = Array.isArray(input) ? input : [input];

  return [
    ...new Set(
      values
        .flatMap((value) => String(value ?? "").split(/[,+\s]+/))
        .map(normalizePhoneNumber)
        .filter((number) => /^8801\d{9}$/.test(number)),
    ),
  ];
}

function numbersMatch(first: string, second: string): boolean {
  const a = normalizePhoneNumber(first);
  const b = normalizePhoneNumber(second);
  return Boolean(a && b && (a === b || a.endsWith(b) || b.endsWith(a)));
}

function parseAutomasResponse(responseText: string): unknown {
  try {
    const safeResponseText = responseText.replace(
      /"id"\s*:\s*(\d{16,})/g,
      '"id":"$1"',
    );
    return JSON.parse(safeResponseText);
  } catch {
    return { raw_response: responseText };
  }
}

function extractProviderItems(body: unknown): AutomasResponseItem[] {
  if (Array.isArray(body)) return body as AutomasResponseItem[];
  if (!body || typeof body !== "object") return [];

  const object = body as Record<string, unknown>;
  if (Array.isArray(object.response)) return object.response as AutomasResponseItem[];
  if (Array.isArray(object.messages)) return object.messages as AutomasResponseItem[];
  if (Array.isArray(object.data)) return object.data as AutomasResponseItem[];
  return [];
}

function isAcceptedStatus(status: unknown): boolean {
  if (Number(status) === 0) return true;
  const text = String(status ?? "").toLowerCase().trim();
  return ["submitted", "accepted", "success", "sent", "queued"].includes(text);
}

async function sendToAutomas(
  input: SendToAutomasInput,
): Promise<AutomasSendResult> {
  const contacts = normalizeContacts(input.contacts);
  if (!contacts.length) throw new Error("No valid Bangladesh mobile number supplied");

  const response = await fetch("https://api.automas.com.bd/smsapiv4", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      api_key: input.apiKey,
      senderid: input.senderId,
      type: "text",
      scheduledDateTime: input.scheduledDateTime ?? "",
      msg: input.message,
      contacts: contacts.join("+"),
    }),
  });

  const responseText = await response.text();
  const responseBody = parseAutomasResponse(responseText);
  const items = extractProviderItems(responseBody);

  const recipients = contacts.map((recipient) => {
    const item = items.find((candidate) => {
      const providerNumber = candidate.msisdn ?? candidate.recipient;
      return providerNumber ? numbersMatch(String(providerNumber), recipient) : false;
    }) ?? (contacts.length === 1 && items.length === 1 ? items[0] : null);

    const accepted = response.ok && Boolean(item) && isAcceptedStatus(item?.status);
    const rawStatus = item?.status;
    const numericStatus = rawStatus !== undefined && !Number.isNaN(Number(rawStatus))
      ? Number(rawStatus)
      : null;

    return {
      recipient,
      accepted,
      providerMessageId: item?.id !== undefined ? String(item.id) : null,
      providerStatusCode: numericStatus,
      providerStatusText: accepted
        ? "Accepted by Automas"
        : !response.ok
        ? `Automas HTTP ${response.status}`
        : item
        ? `Automas status: ${String(rawStatus ?? "unknown")}`
        : "No recipient result returned by Automas",
      providerItem: item,
    } satisfies RecipientResult;
  });

  return {
    httpStatus: response.status,
    responseBody,
    recipients,
  };
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SendSmsRequest {
  contacts: string | string[];
  message: string;
  senderId?: string;
  scheduledDateTime?: string;
  source?: "manual" | "result_published";
  studentId?: string;
  resultExamId?: string;
  resultShareLinkId?: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Only POST is allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("AUTOMAS_API_KEY")!;
    const defaultSenderId = Deno.env.get("AUTOMAS_SENDER_ID")!;

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !apiKey || !defaultSenderId) {
      throw new Error("Missing required environment variables");
    }

    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization token" }, 401);
    }

    const accessToken = authorization.slice(7).trim();
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !user) return jsonResponse({ error: "Invalid or expired login" }, 401);

    let body: SendSmsRequest;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const message = String(body.message ?? "").trim();
    const senderId = String(body.senderId ?? defaultSenderId).trim();
    const contacts = normalizeContacts(body.contacts ?? []);
    const source = body.source === "result_published" ? "result_published" : "manual";

    if (!message) return jsonResponse({ error: "message is required" }, 400);
    if (!senderId) return jsonResponse({ error: "senderId is required" }, 400);
    if (!contacts.length) return jsonResponse({ error: "No valid contacts supplied" }, 400);
    if (contacts.length > 500) return jsonResponse({ error: "Maximum 500 recipients per request" }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let claimedResultMessageId: string | null = null;
    if (source === "result_published") {
      const { data: allowed, error: permissionError } = await authClient.rpc(
        "has_permission",
        { p_permission_key: "results", p_access: "write" },
      );
      if (permissionError || allowed !== true) {
        return jsonResponse({ error: "Result write permission is required" }, 403);
      }
      if (contacts.length !== 1 || !body.studentId || !body.resultExamId || !body.resultShareLinkId) {
        return jsonResponse({ error: "Result notification metadata is incomplete" }, 400);
      }

      const { data: shareLink, error: shareLinkError } = await admin
        .from("result_share_links")
        .select("id,exam_id,student_id,expires_at,revoked_at")
        .eq("id", body.resultShareLinkId)
        .eq("exam_id", body.resultExamId)
        .eq("student_id", body.studentId)
        .maybeSingle();
      if (shareLinkError) throw shareLinkError;
      if (
        !shareLink || shareLink.revoked_at ||
        (shareLink.expires_at && new Date(shareLink.expires_at).getTime() <= Date.now())
      ) {
        return jsonResponse({ error: "Result share link is invalid or expired" }, 400);
      }

      const [{ data: exam, error: examError }, { data: student, error: studentError }] = await Promise.all([
        admin.from("result_exams").select("status").eq("id", body.resultExamId).maybeSingle(),
        admin.from("students").select("guardian_phone").eq("id", body.studentId).maybeSingle(),
      ]);
      if (examError) throw examError;
      if (studentError) throw studentError;
      if (exam?.status !== "published") {
        return jsonResponse({ error: "Result must be published before notifying guardians" }, 400);
      }
      if (!student?.guardian_phone || !numbersMatch(student.guardian_phone, contacts[0])) {
        return jsonResponse({ error: "Recipient does not match the student's guardian phone" }, 400);
      }

      const { data: existing, error: existingError } = await admin
        .from("sms_messages")
        .select("id,status")
        .eq("source", "result_published")
        .eq("result_exam_id", body.resultExamId)
        .eq("student_id", body.studentId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing && existing.status !== "failed") {
        return jsonResponse({ success: true, total: 1, submitted: 0, failed: 0, skipped: 1 });
      }

      if (existing) {
        const { data: reclaimed, error: reclaimError } = await admin
          .from("sms_messages")
          .update({
            recipient: contacts[0], sender_id: senderId, message,
            status: "processing", provider_message_id: null,
            provider_status_code: null, provider_status_text: "Retrying result notification",
            submitted_at: null, delivered_at: null, failed_at: null,
            result_share_link_id: body.resultShareLinkId,
          })
          .eq("id", existing.id).eq("status", "failed")
          .select("id").maybeSingle();
        if (reclaimError) throw reclaimError;
        if (!reclaimed) return jsonResponse({ success: true, total: 1, submitted: 0, failed: 0, skipped: 1 });
        claimedResultMessageId = reclaimed.id;
      } else {
        const { data: claimed, error: claimError } = await admin
          .from("sms_messages")
          .insert({
            user_id: user.id, recipient: contacts[0], sender_id: senderId,
            message, message_type: "text", scheduled_at: null,
            status: "processing", provider_status_text: "Waiting to send",
            source: "result_published", student_id: body.studentId,
            result_exam_id: body.resultExamId,
            result_share_link_id: body.resultShareLinkId,
          })
          .select("id").single();
        if (claimError) {
          if (claimError.code === "23505") {
            return jsonResponse({ success: true, total: 1, submitted: 0, failed: 0, skipped: 1 });
          }
          throw claimError;
        }
        claimedResultMessageId = claimed.id;
      }
    }

    let providerResult;
    try {
      providerResult = await sendToAutomas({
        apiKey,
        senderId,
        contacts,
        message,
        scheduledDateTime: body.scheduledDateTime,
      });
    } catch (error) {
      const now = new Date().toISOString();
      if (claimedResultMessageId) {
        await admin.from("sms_messages").update({
          status: "failed", failed_at: now,
          provider_status_text: "Unable to connect to SMS provider",
          send_response: { error: error instanceof Error ? error.message : String(error) },
        }).eq("id", claimedResultMessageId);
        return jsonResponse({ success: false, total: 1, submitted: 0, failed: 1 }, 502);
      }
      const rows = contacts.map((recipient) => ({
        user_id: user.id,
        recipient,
        sender_id: senderId,
        message,
        message_type: "text",
        scheduled_at: body.scheduledDateTime || null,
        status: "failed",
        provider_status_text: "Unable to connect to SMS provider",
        failed_at: now,
        send_response: { error: error instanceof Error ? error.message : String(error) },
        source,
      }));
      await admin.from("sms_messages").insert(rows);
      return jsonResponse({ success: false, total: contacts.length, submitted: 0, failed: contacts.length }, 502);
    }

    const now = new Date().toISOString();
    const rows = providerResult.recipients.map((result) => ({
      user_id: user.id,
      recipient: result.recipient,
      sender_id: senderId,
      message,
      message_type: "text",
      scheduled_at: body.scheduledDateTime || null,
      provider_message_id: result.providerMessageId,
      status: result.accepted ? "submitted" : "failed",
      provider_status_code: result.providerStatusCode,
      provider_status_text: result.providerStatusText,
      submitted_at: result.accepted ? now : null,
      delivered_at: null,
      failed_at: result.accepted ? null : now,
      send_response: {
        http_status: providerResult.httpStatus,
        provider_response: providerResult.responseBody,
        recipient_response: result.providerItem,
      },
      source,
    }));

    if (claimedResultMessageId) {
      const row = rows[0];
      const { data: savedMessage, error: updateError } = await admin
        .from("sms_messages")
        .update({
          provider_message_id: row.provider_message_id,
          status: row.status,
          provider_status_code: row.provider_status_code,
          provider_status_text: row.provider_status_text,
          submitted_at: row.submitted_at,
          delivered_at: row.delivered_at,
          failed_at: row.failed_at,
          send_response: row.send_response,
        })
        .eq("id", claimedResultMessageId)
        .select().single();
      if (updateError) throw updateError;
      const submitted = row.status === "submitted" ? 1 : 0;
      return jsonResponse({
        success: submitted === 1, total: 1, submitted,
        failed: 1 - submitted, skipped: 0, messages: [savedMessage],
      });
    }

    const { data: savedMessages, error: insertError } = await admin
      .from("sms_messages")
      .insert(rows)
      .select();

    if (insertError) throw insertError;

    const submitted = rows.filter((row) => row.status === "submitted").length;
    return jsonResponse({
      success: submitted > 0,
      total: rows.length,
      submitted,
      failed: rows.length - submitted,
      messages: savedMessages,
      providerResponse: providerResult.responseBody,
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
