const KV_WRITE_INTERVAL_MS = 2 * 60 * 1000;
const OFFLINE_THRESHOLD_MS = 3 * 60 * 1000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Browser preflight requests must be answered before normal route handling.
    if (request.method === "OPTIONS") {
      return corsResponse(null, { status: 204 });
    }

    console.log("========== ZKTECO REQUEST ==========");
    console.log("Method:", request.method);
    console.log("Path:", path);
    console.log("Query:", url.search);

    if (path === "/") {
      return textResponse("ZKTeco Worker OK");
    }

    if (path === "/kv-test") {
      return handleKvTest(env);
    }

    if (path === "/iclock/ping" || path === "/iclock/getrequest") {
      return handleDeviceActivity(url, env, path);
    }

    if (path === "/iclock/cdata") {
      return handleAttendanceData(request, url, path);
    }

    if (path === "/iclock/devicecmd") {
      console.log("DEVICECMD -> handled by Cloudflare");
      return textResponse("OK");
    }

    if (path === "/status") {
      return handleDeviceStatus(url, env);
    }

    console.log("Unknown ZKTeco path:", path);
    return textResponse("Not Found", 404);
  },
};

async function handleKvTest(env) {
  try {
    const testData = {
      message: "KV is working",
      timestamp: new Date().toISOString(),
    };

    await env.ZK_STATUS.put("test", JSON.stringify(testData));
    const value = await env.ZK_STATUS.get("test");

    return corsResponse(value || "KV READ FAILED", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("KV TEST ERROR:", String(error));
    return jsonResponse({ error: String(error) }, 500);
  }
}

async function handleDeviceActivity(url, env, path) {
  const sn = url.searchParams.get("SN");

  console.log(
    path === "/iclock/ping"
      ? "PING -> Cloudflare"
      : "GETREQUEST -> Cloudflare",
  );
  console.log("Device SN:", sn);

  if (!sn) {
    console.log("Device activity received without SN");
    return textResponse("OK");
  }

  const key = `device:${sn}`;
  const nowMs = Date.now();

  try {
    const existingRaw = await env.ZK_STATUS.get(key);
    let existing = null;

    if (existingRaw) {
      try {
        existing = JSON.parse(existingRaw);
      } catch {
        console.log("Could not parse existing KV data");
      }
    }

    const lastKvWriteMs = existing?.last_kv_write
      ? Date.parse(existing.last_kv_write)
      : 0;
    const timeSinceLastWrite = nowMs - lastKvWriteMs;

    // Limit KV writes to once every two minutes per device.
    if (!existing || !lastKvWriteMs || timeSinceLastWrite >= KV_WRITE_INTERVAL_MS) {
      const now = new Date().toISOString();
      const deviceStatus = {
        serial_number: sn,
        status: "online",
        last_seen: now,
        last_kv_write: now,
      };

      await env.ZK_STATUS.put(key, JSON.stringify(deviceStatus));
      console.log("KV WRITE ->", key, deviceStatus);
    } else {
      console.log("KV WRITE SKIPPED -> less than 2 minutes");
    }
  } catch (error) {
    // Keep device polling operational even if KV has a temporary problem.
    console.error("KV DEVICE STATUS ERROR:", String(error));
  }

  return textResponse("OK");
}

async function handleAttendanceData(request, url, path) {
  if (request.method === "GET") {
    console.log("GET /iclock/cdata received - no attendance data");
    return textResponse("OK");
  }

  if (request.method !== "POST") {
    return textResponse("OK");
  }

  const body = await request.text();
  console.log("CDATA POST -> forwarding to Supabase");
  console.log("Body:", body);

  const supabaseUrl =
    "https://cswkotivlmtaegaiyxdm.supabase.co" +
    "/functions/v1/zkteco-connect-test" +
    path +
    url.search;

  try {
    const response = await fetch(supabaseUrl, {
      method: "POST",
      headers: request.headers,
      body,
    });

    console.log("Supabase response:", response.status, response.statusText);

    // Preserve Supabase's response headers and add the Worker CORS headers.
    return corsResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    console.error("SUPABASE FORWARD ERROR:", String(error));
    return textResponse("ERROR", 500);
  }
}

async function handleDeviceStatus(url, env) {
  const sn = url.searchParams.get("SN");

  if (!sn) {
    return jsonResponse({ error: "Missing SN" }, 400);
  }

  try {
    const data = await env.ZK_STATUS.get(`device:${sn}`);

    if (!data) {
      return jsonResponse({
        serial_number: sn,
        status: "unknown",
        message: "No device activity has been recorded yet.",
        last_seen: null,
        last_seen_age_seconds: null,
        offline_after_seconds: OFFLINE_THRESHOLD_MS / 1000,
      });
    }

    const device = JSON.parse(data);
    const lastSeenMs = device.last_seen ? Date.parse(device.last_seen) : 0;
    const ageMs = lastSeenMs > 0 ? Math.max(0, Date.now() - lastSeenMs) : null;
    const ageSeconds = ageMs === null ? null : Math.floor(ageMs / 1000);
    const isOnline = ageMs !== null && ageMs <= OFFLINE_THRESHOLD_MS;

    return jsonResponse({
      serial_number: device.serial_number || sn,
      status: isOnline ? "online" : "offline",
      last_seen: device.last_seen || null,
      last_seen_age_seconds: ageSeconds,
      offline_after_seconds: OFFLINE_THRESHOLD_MS / 1000,
      last_kv_write: device.last_kv_write || null,
    });
  } catch (error) {
    console.error("STATUS ERROR:", String(error));
    return jsonResponse({ error: String(error) }, 500);
  }
}

function jsonResponse(body, status = 200) {
  return corsResponse(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function textResponse(body, status = 200) {
  return corsResponse(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

function corsResponse(body, init = {}) {
  const headers = new Headers(init.headers);

  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(body, {
    ...init,
    headers,
  });
}
