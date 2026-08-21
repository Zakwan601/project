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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;

    return {
      message: value.message ?? "Unknown object error",
      code: value.code ?? null,
      details: value.details ?? null,
      hint: value.hint ?? null,
      status: value.status ?? null,
      original: value,
    };
  }

  return {
    message: String(error),
  };
}

function normalizePhoneNumber(value: string): string {
  let number = String(value ?? "")
    .trim()
    .replace(/\D/g, "");

  if (number.startsWith("00880")) {
    number = number.slice(2);
  }

  if (number.startsWith("01") && number.length === 11) {
    number = `88${number}`;
  }

  return number;
}

function normalizeContacts(input: string | string[]): string[] {
  const values = Array.isArray(input) ? input : [input];

  return [
    ...new Set(
      values
        .flatMap((value) =>
          String(value ?? "")
            .split(/[,+\s]+/)
        )
        .map(normalizePhoneNumber)
        .filter((number) => /^8801\d{9}$/.test(number)),
    ),
  ];
}

function numbersMatch(first: string, second: string): boolean {
  const a = normalizePhoneNumber(first);
  const b = normalizePhoneNumber(second);

  return Boolean(
    a &&
      b &&
      (
        a === b ||
        a.endsWith(b) ||
        b.endsWith(a)
      )
  );
}

function parseAutomasResponse(responseText: string): unknown {
  try {
    const safeResponseText = responseText.replace(
      /"id"\s*:\s*(\d{16,})/g,
      '"id":"$1"',
    );

    return JSON.parse(safeResponseText);
  } catch {
    return {
      raw_response: responseText,
    };
  }
}

function extractProviderItems(
  body: unknown,
): AutomasResponseItem[] {
  if (Array.isArray(body)) {
    return body as AutomasResponseItem[];
  }

  if (!body || typeof body !== "object") {
    return [];
  }

  const object = body as Record<string, unknown>;

  if (Array.isArray(object.response)) {
    return object.response as AutomasResponseItem[];
  }

  if (Array.isArray(object.messages)) {
    return object.messages as AutomasResponseItem[];
  }

  if (Array.isArray(object.data)) {
    return object.data as AutomasResponseItem[];
  }

  return [];
}

function isAcceptedStatus(status: unknown): boolean {
  if (Number(status) === 0) {
    return true;
  }

  const text = String(status ?? "")
    .toLowerCase()
    .trim();

  return [
    "submitted",
    "accepted",
    "success",
    "sent",
    "queued",
  ].includes(text);
}

async function sendToAutomas(
  input: SendToAutomasInput,
): Promise<AutomasSendResult> {
  const contacts = normalizeContacts(input.contacts);

  if (contacts.length === 0) {
    throw new Error(
      "No valid Bangladesh mobile number supplied",
    );
  }

  const payload = {
    api_key: input.apiKey,
    senderid: input.senderId,
    type: "text",
    scheduledDateTime: input.scheduledDateTime ?? "",
    msg: input.message,
    contacts: contacts.join("+"),
  };

  console.log(
    "Sending SMS to Automas:",
    JSON.stringify(
      {
        ...payload,
        api_key: "***hidden***",
      },
      null,
      2,
    ),
  );

  const response = await fetch(
    "https://api.automas.com.bd/smsapiv4",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const responseText = await response.text();
  const responseBody = parseAutomasResponse(responseText);
  const items = extractProviderItems(responseBody);

  console.log("Automas HTTP status:", response.status);
  console.log(
    "Automas response:",
    JSON.stringify(responseBody, null, 2),
  );

  const recipients = contacts.map((recipient) => {
    const matchingItem =
      items.find((candidate) => {
        const providerNumber =
          candidate.msisdn ??
          candidate.recipient;

        return providerNumber
          ? numbersMatch(
            String(providerNumber),
            recipient,
          )
          : false;
      }) ??
        (
          contacts.length === 1 &&
            items.length === 1
            ? items[0]
            : null
        );

    const accepted =
      response.ok &&
      Boolean(matchingItem) &&
      isAcceptedStatus(matchingItem?.status);

    const rawStatus = matchingItem?.status;

    const numericStatus =
      rawStatus !== undefined &&
        !Number.isNaN(Number(rawStatus))
        ? Number(rawStatus)
        : null;

    return {
      recipient,
      accepted,
      providerMessageId:
        matchingItem?.id !== undefined
          ? String(matchingItem.id)
          : null,
      providerStatusCode: numericStatus,
      providerStatusText: accepted
        ? "Accepted by Automas"
        : !response.ok
        ? `Automas HTTP ${response.status}`
        : matchingItem
        ? `Automas status: ${
          String(rawStatus ?? "unknown")
        }`
        : "No recipient result returned by Automas",
      providerItem: matchingItem,
    };
  });

  return {
    httpStatus: response.status,
    responseBody,
    recipients,
  };
}

function getDhakaDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getDhakaHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Dhaka",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function formatDisplayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

function getDhakaDayUtcRange(value: string): { start: string; end: string } {
  const start = new Date(`${value}T00:00:00+06:00`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) =>
      text.replaceAll(`{{${key}}}`, value),
    template,
  );
}

async function sendDiscordReport(
  webhookUrl: string,
  content: string,
): Promise<void> {
  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 1900) {
    let cutPosition =
      remaining.lastIndexOf("\n", 1900);

    if (cutPosition < 500) {
      cutPosition = 1900;
    }

    chunks.push(
      remaining.slice(0, cutPosition),
    );

    remaining = remaining
      .slice(cutPosition)
      .trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  for (const chunk of chunks) {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: chunk,
      }),
    });

    if (!response.ok) {
      const responseText =
        await response.text();

      throw new Error(
        `Discord webhook failed: ${responseText}`,
      );
    }
  }
}

Deno.serve(
  async (
    request: Request,
  ): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders,
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        {
          success: false,
          error: "Only POST requests are allowed",
        },
        405,
      );
    }

    try {
      const supabaseUrl =
        Deno.env.get("SUPABASE_URL");

      const serviceRoleKey =
        Deno.env.get(
          "SUPABASE_SERVICE_ROLE_KEY",
        );

      const apiKey =
        Deno.env.get("AUTOMAS_API_KEY");

      const senderId =
        Deno.env.get("AUTOMAS_SENDER_ID");

      const cronSecret =
        Deno.env.get(
          "ABSENT_SMS_CRON_SECRET",
        );

      const discordWebhook =
        Deno.env.get(
          "DISCORD_ABSENT_WEBHOOK_URL",
        ) ?? "";

      const schoolName =
        Deno.env.get("SCHOOL_NAME") ??
        "School";

      const smsTemplate =
        Deno.env.get(
          "ABSENT_SMS_TEMPLATE",
        ) ??
        "Dear Guardian, {{student_name}} (Admission: {{admission_number}}, Class: {{class_name}}) was marked absent on {{date}}. - {{school_name}}";

      const missingVariables: string[] = [];

      if (!supabaseUrl) {
        missingVariables.push(
          "SUPABASE_URL",
        );
      }

      if (!serviceRoleKey) {
        missingVariables.push(
          "SUPABASE_SERVICE_ROLE_KEY",
        );
      }

      if (!apiKey) {
        missingVariables.push(
          "AUTOMAS_API_KEY",
        );
      }

      if (!senderId) {
        missingVariables.push(
          "AUTOMAS_SENDER_ID",
        );
      }

      if (!cronSecret) {
        missingVariables.push(
          "ABSENT_SMS_CRON_SECRET",
        );
      }

      if (missingVariables.length > 0) {
        return jsonResponse(
          {
            success: false,
            error:
              "Missing required environment variables",
            missing_variables:
              missingVariables,
          },
          500,
        );
      }

      const supabase = createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        },
      );

      const providedSecret = request.headers.get("x-cron-secret");
      const isCronRequest = providedSecret === cronSecret;

      if (!isCronRequest) {
        const authorization = request.headers.get("authorization") ?? "";
        const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];

        if (!accessToken) {
          return jsonResponse(
            { success: false, error: "Authentication is required" },
            401,
          );
        }

        const { data: userData, error: userError } =
          await supabase.auth.getUser(accessToken);

        if (userError || !userData.user) {
          return jsonResponse(
            { success: false, error: "Your session is invalid or has expired" },
            401,
          );
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role, is_active")
          .eq("id", userData.user.id)
          .maybeSingle();

        if (
          profileError ||
          profile?.role !== "admin" ||
          profile.is_active !== true
        ) {
          return jsonResponse(
            { success: false, error: "An active administrator account is required" },
            403,
          );
        }
      }

      const dhakaToday = getDhakaDate();
      let attendanceDate = dhakaToday;
      let action = "send";

      if (!isCronRequest) {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const requestedDate = body.date;
        action = body.action === "status" ? "status" : "send";

        if (requestedDate !== undefined) {
          if (typeof requestedDate !== "string" || !isValidDate(requestedDate)) {
            return jsonResponse(
              { success: false, error: "date must use YYYY-MM-DD format" },
              400,
            );
          }
          attendanceDate = requestedDate;
        }

        if (attendanceDate > dhakaToday) {
          return jsonResponse(
            { success: false, error: "Absence notifications cannot be sent for a future date" },
            400,
          );
        }

        if (action === "send" && attendanceDate === dhakaToday && getDhakaHour() < 18) {
          return jsonResponse(
            { success: false, error: "Today's absence notifications are available after 6:00 PM" },
            400,
          );
        }
      }

      console.log(
        "Processing absent students for:",
        attendanceDate,
      );
      const displayDate = formatDisplayDate(attendanceDate);

      if (action === "status") {
        const { data: status, error: statusError } = await supabase.rpc(
          "get_absence_notification_status",
          { p_date: attendanceDate },
        );

        if (statusError) {
          throw statusError;
        }

        const notificationStatus = status as {
          has_sent_message?: boolean;
          has_message_in_progress?: boolean;
        } | null;

        return jsonResponse({
          success: true,
          date: displayDate,
          attendance_date: attendanceDate,
          has_sent_message: notificationStatus?.has_sent_message === true,
          has_message_in_progress:
            notificationStatus?.has_message_in_progress === true,
        });
      }

      const {
        data: sessions,
        error: sessionError,
      } = await supabase
        .from("attendance_sessions")
        .select("id")
        .eq("date", attendanceDate);

      if (sessionError) {
        throw sessionError;
      }

      if (!sessions || sessions.length === 0) {
        return jsonResponse({
          success: true,
          date: displayDate,
          message:
            "No attendance sessions found for the selected date",
          absent_count: 0,
          submitted: 0,
          failed: 0,
          skipped: 0,
        });
      }

      const sessionIds =
        sessions.map((session) => session.id);

      const {
        data: absentRows,
        error: absentError,
      } = await supabase
        .from("attendance_records")
        .select(`
          id,
          session_id,
          remarks,
          student:students(
            id,
            admission_number,
            first_name,
            last_name,
            guardian_phone,
            classes(
              name
            )
          )
        `)
        .in("session_id", sessionIds)
        .eq("status", "absent");

      if (absentError) {
        throw absentError;
      }

      let existingActiveMessages: Array<{ id: string; status: string }> = [];
      if ((absentRows?.length ?? 0) > 0) {
        const attendanceRecordIds = (absentRows ?? []).map((record) => record.id);
        const { data: linkedMessages, error: linkedMessagesError } = await supabase
          .from("sms_messages")
          .select("id, status")
          .eq("source", "attendance_absent")
          .in("attendance_record_id", attendanceRecordIds)
          .in("status", ["queued", "processing", "submitted", "delivered"]);

        if (linkedMessagesError) {
          throw linkedMessagesError;
        }
        existingActiveMessages = linkedMessages ?? [];

        /* Legacy attendance resyncs may have replaced record IDs. The daily
           job sent on the same Dhaka school day, so its timestamp is the
           reliable fallback for those historical messages. */
        if (existingActiveMessages.length === 0) {
          const range = getDhakaDayUtcRange(attendanceDate);
          const { data: legacyMessages, error: legacyMessagesError } = await supabase
            .from("sms_messages")
            .select("id, status")
            .eq("source", "attendance_absent")
            .gte("created_at", range.start)
            .lt("created_at", range.end)
            .in("status", ["queued", "processing", "submitted", "delivered"]);

          if (legacyMessagesError) {
            throw legacyMessagesError;
          }
          existingActiveMessages = legacyMessages ?? [];
        }
      }

      const hasSentMessage = existingActiveMessages.some(
        (message) => message.status === "submitted" || message.status === "delivered",
      );
      const hasMessageInProgress = existingActiveMessages.some(
        (message) => message.status === "queued" || message.status === "processing",
      );


      if (!isCronRequest && (hasSentMessage || hasMessageInProgress)) {
        return jsonResponse(
          {
            success: false,
            error: hasSentMessage
              ? "Absence SMS messages have already been sent for this date"
              : "Absence SMS messages are already being processed for this date",
          },
          409,
        );
      }

      const results: Array<
        Record<string, unknown>
      > = [];

      for (
        const record of absentRows ?? []
      ) {
        const student = Array.isArray(
            record.student,
          )
          ? record.student[0]
          : record.student;

        const phone =
          normalizeContacts(
            student?.guardian_phone ?? "",
          )[0];

        const studentName =
          `${
            student?.first_name ?? ""
          } ${
            student?.last_name ?? ""
          }`
            .trim();

        const studentClass =
          student?.classes;

        const className =
          Array.isArray(studentClass)
            ? studentClass[0]?.name ?? "N/A"
            : studentClass?.name ?? "N/A";

        const admissionNumber =
          String(
            student?.admission_number ??
              "N/A",
          );

        const message = renderTemplate(
          smsTemplate,
          {
            student_name:
              studentName || "Student",
            admission_number:
              admissionNumber,
            class_name: className,
            date: displayDate,
            school_name: schoolName,
            remarks:
              String(record.remarks ?? ""),
          },
        );

        if (!phone) {
          results.push({
            attendance_record_id:
              record.id,
            student_id:
              student?.id ?? null,
            student:
              studentName || "Unknown",
            status: "skipped",
            reason:
              "Missing or invalid guardian phone number",
          });

          continue;
        }

        /*
         * Claim each attendance record before sending. Previously submitted,
         * delivered, or in-flight messages remain protected from duplicates;
         * failed messages can be atomically reclaimed by the recovery action.
         */
        let claimedMessage: { id: string } | null = null;
        const { data: existingMessage, error: existingMessageError } =
          await supabase
            .from("sms_messages")
            .select("id, status")
            .eq("attendance_record_id", record.id)
            .maybeSingle();

        if (existingMessageError) {
          results.push({
            attendance_record_id: record.id,
            student_id: student?.id ?? null,
            student: studentName || "Unknown",
            recipient: phone,
            status: "failed",
            stage: "sms_messages_lookup",
            error: getErrorDetails(existingMessageError),
          });
          continue;
        }

        if (existingMessage) {
          if (existingMessage.status !== "failed") {
            results.push({
              attendance_record_id: record.id,
              student_id: student?.id ?? null,
              student: studentName || "Unknown",
              recipient: phone,
              status: "skipped",
              reason: `Already processed with status ${existingMessage.status}`,
            });
            continue;
          }

          const { data: reclaimedMessage, error: reclaimError } = await supabase
            .from("sms_messages")
            .update({
              recipient: phone,
              sender_id: senderId,
              message,
              status: "processing",
              provider_message_id: null,
              provider_status_code: null,
              provider_status_text: "Retrying failed absence notification",
              submitted_at: null,
              delivered_at: null,
              failed_at: null,
              send_response: { retried_at: new Date().toISOString() },
            })
            .eq("id", existingMessage.id)
            .eq("status", "failed")
            .select("id")
            .maybeSingle();

          if (reclaimError || !reclaimedMessage) {
            results.push({
              attendance_record_id: record.id,
              student_id: student?.id ?? null,
              student: studentName || "Unknown",
              recipient: phone,
              status: "skipped",
              reason: reclaimError
                ? "Could not reclaim the failed SMS"
                : "The failed SMS was already claimed by another request",
              ...(reclaimError ? { error: getErrorDetails(reclaimError) } : {}),
            });
            continue;
          }

          claimedMessage = reclaimedMessage;
        } else {
          const { data: insertedMessage, error: claimError } = await supabase
            .from("sms_messages")
            .insert({
              user_id: null,
              recipient: phone,
              sender_id: senderId,
              message,
              message_type: "text",
              status: "processing",
              source: "attendance_absent",
              attendance_record_id: record.id,
              student_id: student?.id ?? null,
              provider_message_id: null,
              provider_status_code: null,
              provider_status_text: "Waiting to send",
              submitted_at: null,
              delivered_at: null,
              failed_at: null,
              send_response: { claimed_at: new Date().toISOString() },
            })
            .select("id")
            .single();

          if (claimError || !insertedMessage) {
            const duplicate = claimError?.code === "23505";
            results.push({
              attendance_record_id: record.id,
              student_id: student?.id ?? null,
              student: studentName || "Unknown",
              recipient: phone,
              status: duplicate ? "skipped" : "failed",
              stage: "sms_messages_insert",
              reason: duplicate
                ? "This attendance record was claimed by another request"
                : "Could not create the SMS record",
              ...(claimError ? { error: getErrorDetails(claimError) } : {}),
            });
            continue;
          }

          claimedMessage = insertedMessage;
        }

        try {
          const provider =
            await sendToAutomas({
              apiKey,
              senderId,
              contacts: [phone],
              message,
            });

          const recipientResult =
            provider.recipients[0];

          const now =
            new Date().toISOString();

          const {
            error: updateError,
          } = await supabase
            .from("sms_messages")
            .update({
              provider_message_id:
                recipientResult
                  .providerMessageId,
              status:
                recipientResult.accepted
                  ? "submitted"
                  : "failed",
              provider_status_code:
                recipientResult
                  .providerStatusCode,
              provider_status_text:
                recipientResult
                  .providerStatusText,
              submitted_at:
                recipientResult.accepted
                  ? now
                  : null,
              delivered_at: null,
              failed_at:
                recipientResult.accepted
                  ? null
                  : now,
              send_response: {
                http_status:
                  provider.httpStatus,
                provider_response:
                  provider.responseBody,
                recipient_response:
                  recipientResult
                    .providerItem,
              },
            })
            .eq(
              "id",
              claimedMessage.id,
            );

          if (updateError) {
            throw updateError;
          }

          results.push({
            sms_message_id:
              claimedMessage.id,
            attendance_record_id:
              record.id,
            student_id:
              student?.id ?? null,
            student:
              studentName || "Unknown",
            recipient: phone,
            status:
              recipientResult.accepted
                ? "submitted"
                : "failed",
            provider_message_id:
              recipientResult
                .providerMessageId,
            provider_status_code:
              recipientResult
                .providerStatusCode,
            provider_status_text:
              recipientResult
                .providerStatusText,
          });
        } catch (smsError) {
          const smsErrorDetails =
            getErrorDetails(smsError);

          console.error(
            `SMS failed for attendance record ${record.id}:`,
            JSON.stringify(
              smsErrorDetails,
              null,
              2,
            ),
          );

          const {
            error: failureUpdateError,
          } = await supabase
            .from("sms_messages")
            .update({
              status: "failed",
              failed_at:
                new Date().toISOString(),
              provider_status_text:
                String(
                  smsErrorDetails
                    .message ??
                    "SMS request failed",
                ),
              send_response: {
                error: smsErrorDetails,
              },
            })
            .eq(
              "id",
              claimedMessage.id,
            );

          if (failureUpdateError) {
            console.error(
              "Could not update failed SMS row:",
              JSON.stringify(
                getErrorDetails(
                  failureUpdateError,
                ),
                null,
                2,
              ),
            );
          }

          results.push({
            sms_message_id:
              claimedMessage.id,
            attendance_record_id:
              record.id,
            student_id:
              student?.id ?? null,
            student:
              studentName || "Unknown",
            recipient: phone,
            status: "failed",
            stage: "sms_send",
            error: smsErrorDetails,
          });
        }
      }

      const submitted =
        results.filter(
          (item) =>
            item.status === "submitted",
        ).length;

      const failed =
        results.filter(
          (item) =>
            item.status === "failed",
        ).length;

      const skipped =
        results.filter(
          (item) =>
            item.status === "skipped",
        ).length;

      let discordSent = false;
      let discordError:
        Record<string, unknown> | null =
        null;

      if (discordWebhook) {
        let report =
          `## Daily Attendance Report (${displayDate})\n\n`;

        report +=
          `**Absent records:** ${
            absentRows?.length ?? 0
          }\n`;

        report +=
          `**SMS submitted:** ${submitted}\n`;

        report +=
          `**Failed:** ${failed}\n`;

        report +=
          `**Skipped:** ${skipped}\n\n`;

        for (
          const [index, record] of
            (absentRows ?? []).entries()
        ) {
          const student =
            Array.isArray(record.student)
              ? record.student[0]
              : record.student;

          const studentClass =
            student?.classes;

          const className =
            Array.isArray(studentClass)
              ? studentClass[0]?.name ??
                "N/A"
              : studentClass?.name ??
                "N/A";

          report +=
            `**${index + 1}. ${
              student?.first_name ?? ""
            } ${
              student?.last_name ?? ""
            }**\n`;

          report +=
            `• Admission: ${
              student?.admission_number ??
                "N/A"
            }\n`;

          report +=
            `• Class: ${className}\n`;

          report +=
            `• Guardian: ${
              student?.guardian_phone ??
                "N/A"
            }\n`;

          report +=
            `• Remarks: ${
              record.remarks ?? "-"
            }\n\n`;
        }

        try {
          await sendDiscordReport(
            discordWebhook,
            report,
          );

          discordSent = true;
        } catch (
          discordRequestError
        ) {
          discordError =
            getErrorDetails(
              discordRequestError,
            );

          console.error(
            "Discord report failed:",
            JSON.stringify(
              discordError,
              null,
              2,
            ),
          );
        }
      }

      return jsonResponse({
        success: failed === 0,
        date: displayDate,
        attendance_date: attendanceDate,
        session_count:
          sessions.length,
        absent_count:
          absentRows?.length ?? 0,
        submitted,
        failed,
        skipped,
        discord_sent: discordSent,
        discord_error: discordError,
        results,
      });
    } catch (error) {
      const errorDetails =
        getErrorDetails(error);

      console.error(
        "Absent students function failed:",
        JSON.stringify(
          errorDetails,
          null,
          2,
        ),
      );

      return jsonResponse(
        {
          success: false,
          error: errorDetails,
        },
        500,
      );
    }
  },
);
