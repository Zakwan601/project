import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname;

    console.log("========== ZKTECO ADMS ==========");
    console.log("Method:", req.method);
    console.log("Path:", path);
    console.log("Query:", url.search);

    // --------------------------------------------------
    // PING
    // --------------------------------------------------
    if (path.endsWith("/iclock/ping")) {
      console.log("PING");

      return new Response("OK", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
        },
      });
    }

    // --------------------------------------------------
    // GETREQUEST
    // Device asks whether there are pending commands.
    // Nothing to send for now.
    // --------------------------------------------------
    if (path.endsWith("/iclock/getrequest")) {
      console.log("GETREQUEST");

      return new Response("OK", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
        },
      });
    }

    // --------------------------------------------------
    // CDATA
    // Actual attendance/device data
    // --------------------------------------------------
    if (path.endsWith("/iclock/cdata")) {
      const body = await req.text();

      const sn = url.searchParams.get("SN");
      const table = url.searchParams.get("table");
      const stamp = url.searchParams.get("Stamp");

      console.log("========== ATTLOG ==========");
      console.log("SN:", sn);
      console.log("Table:", table);
      console.log("Stamp:", stamp);
      console.log("Body:", body);
      console.log("============================");

      // We currently process ATTLOG only.
      if (table !== "ATTLOG") {
        console.log("Unsupported table:", table);

        return new Response("OK", {
          status: 200,
          headers: {
            "Content-Type": "text/plain",
          },
        });
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !serviceRoleKey) {
        console.error("Missing Supabase environment variables");

        return new Response("ERROR", {
          status: 500,
          headers: {
            "Content-Type": "text/plain",
          },
        });
      }

      const supabase = createClient(
        supabaseUrl,
        serviceRoleKey,
      );

      /*
       * ZKTeco can potentially send multiple ATTLOG
       * records in one request, normally separated by
       * new lines.
       */
      const lines = body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      let inserted = 0;
      let duplicates = 0;
      const affectedDates = new Set<string>();

      for (const line of lines) {
        /*
         * Example:
         *
         * 1 2026-08-16 22:01:27 255 1 0 0 0 0 0 0 47
         *
         * Field 0 = biometric ID
         * Field 1 = date
         * Field 2 = time
         * Remaining fields = ZKTeco ATTLOG data
         */

        const fields = line.split(/\s+/);

        if (fields.length < 3) {
          console.warn("Invalid ATTLOG line:", line);
          continue;
        }

        const studentBiometricId = fields[0];
        const date = fields[1];
        const time = fields[2];

        if (
          !studentBiometricId ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !/^\d{2}:\d{2}:\d{2}$/.test(time)
        ) {
          console.warn("Missing or malformed ATTLOG fields:", line);
          continue;
        }

        /*
         * Your device time is Bangladesh time (UTC+6).
         *
         * The ZKTeco payload does not include timezone
         * information, so explicitly interpret it as +06:00.
         */
        const punchedAt = `${date}T${time}+06:00`;

        const punchedAtDate = new Date(punchedAt);

        if (Number.isNaN(punchedAtDate.getTime())) {
          console.warn("Invalid timestamp:", punchedAt);
          continue;
        }

        // The date in the body is the authoritative Dhaka school date. Do not
        // derive it from the UTC serialization, which can be the previous day.
        affectedDates.add(date);

        /*
         * Keep the entire original ZKTeco transaction.
         * This makes debugging and future protocol parsing
         * much easier.
         */
        const rawData = {
          serial_number: sn,
          table,
          stamp,
          raw_line: line,
          fields,
          received_at: new Date().toISOString(),
        };

        // --------------------------------------------------
        // DUPLICATE CHECK
        // --------------------------------------------------

        const { data: existing, error: duplicateError } =
          await supabase
            .from("device_logs")
            .select("id")
            .eq("student_biometric_id", studentBiometricId)
            .eq("punched_at", punchedAtDate.toISOString())
            .limit(1)
            .maybeSingle();

        if (duplicateError) {
          console.error(
            "Duplicate check failed:",
            duplicateError,
          );

          throw duplicateError;
        }

        if (existing) {
          console.log(
            "Duplicate attendance ignored:",
            studentBiometricId,
            punchedAtDate.toISOString(),
          );

          duplicates++;
          continue;
        }

        // --------------------------------------------------
        // INSERT DEVICE LOG
        // --------------------------------------------------

        const { error: insertError } = await supabase
          .from("device_logs")
          .insert({
            device_id: null,
            student_biometric_id: studentBiometricId,
            punched_at: punchedAtDate.toISOString(),
            processed: false,
            attendance_record_id: null,
            raw_data: rawData,
          });

        if (insertError) {
          console.error(
            "device_logs insert failed:",
            insertError,
          );

          throw insertError;
        }

        inserted++;

        console.log(
          "Attendance inserted:",
          studentBiometricId,
          `${date} ${time} Asia/Dhaka`,
          `(stored as ${punchedAtDate.toISOString()})`,
        );
      }

      console.log(
        `ATTLOG complete: inserted=${inserted}, duplicates=${duplicates}`,
      );

      // Refresh Daily Attendance after all punches in this request are stored.
      // Include dates containing duplicate punches so a device retry can recover
      // from a previous request where the insert succeeded but this RPC failed.
      for (const attendanceDate of [...affectedDates].sort()) {
        const { data: syncResult, error: syncError } = await supabase.rpc(
          "sync_daily_attendance_as_service",
          { p_date: attendanceDate },
        );

        if (syncError) {
          console.error(
            `Daily Attendance sync failed for ${attendanceDate}:`,
            syncError,
          );
          throw syncError;
        }

        console.log(
          `Daily Attendance synced for ${attendanceDate}:`,
          syncResult,
        );
      }

      /*
       * ZKTeco expects a plain-text response.
       */
      return new Response("OK", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
        },
      });
    }

    // --------------------------------------------------
    // DEVICECMD
    // --------------------------------------------------
    if (path.endsWith("/iclock/devicecmd")) {
      console.log("DEVICECMD");

      return new Response("OK", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
        },
      });
    }

    // --------------------------------------------------
    // UNKNOWN PATH
    // --------------------------------------------------
    console.log("Unknown ZKTeco path:", path);

    return new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  } catch (error) {
    console.error("========== ZKTECO ERROR ==========");
    console.error(error);
    console.error("==================================");

    /*
     * Returning ERROR tells the device that the transaction
     * was not successfully processed.
     */
    return new Response("ERROR", {
      status: 500,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }
});
