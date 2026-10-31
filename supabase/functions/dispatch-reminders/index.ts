// Reminder dispatcher.
//
// Generation and claiming happen in SQL, under an advisory lock, so this
// function is only responsible for the side effect it is uniquely able to
// perform: handing the message to a push service. Email and SMS are not
// supported; push is the only outbound channel. Every outcome is written back
// to the delivery row.
//
// Deploy with JWT verification on. The public config action accepts any valid
// project key; dispatch requires the service role key exactly.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.58.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface DeliveryJob {
  deliveryId: string;
  channel: "in_app" | "push" | "email" | "sms";
  attempts: number;
  title: string;
  body: string;
  href: string;
  priority: string;
  email: string;
  phone: string;
  push: PushSubscription[];
}

interface Outcome {
  status: "sent" | "failed" | "skipped" | "deferred";
  error?: string;
  provider?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function serviceClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function webPush() {
  const module = await import("npm:web-push@3.6.7");
  return module.default ?? module;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

async function ensureVapid(client: SupabaseClient): Promise<VapidKeys> {
  const existing = await client.rpc("read_vapid_keys");
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.status === "ok") {
    return { publicKey: existing.data.publicKey, privateKey: existing.data.privateKey };
  }

  const push = await webPush();
  const generated = push.generateVAPIDKeys() as VapidKeys;
  const saved = await client.rpc("save_vapid_keys", {
    p_public: generated.publicKey,
    p_private: generated.privateKey,
  });
  if (saved.error) throw new Error(saved.error.message);

  const again = await client.rpc("read_vapid_keys");
  if (again.error || again.data?.status !== "ok") {
    throw new Error(again.error?.message ?? "VAPID keys could not be stored.");
  }
  return { publicKey: again.data.publicKey, privateKey: again.data.privateKey };
}

function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    const claims = JSON.parse(atob(normalized)) as { role?: unknown };
    return typeof claims.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

async function config(client: SupabaseClient, request: Request): Promise<Response> {
  const key = await client.rpc("vapid_public_key");
  const publicKey = typeof key.data === "string" ? key.data : "";
  return json({
    status: "ok",
    push: { configured: publicKey.length > 0, publicKey },
    // Push is the only outbound channel. Email and SMS were removed on purpose;
    // the keys stay in the payload, always false, so a client that still reads
    // them disables its own controls instead of offering something that cannot
    // happen.
    channels: { email: false, sms: false },
    auth: {
      hasAuthorization: Boolean(request.headers.get("authorization")),
      role: jwtRole((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")),
      hasApiKey: Boolean(request.headers.get("apikey")),
    },
  });
}

async function sendPush(client: SupabaseClient, job: DeliveryJob): Promise<Outcome> {
  if (job.push.length === 0) {
    return { status: "skipped", error: "no_push_subscription" };
  }

  const keys = await ensureVapid(client);
  const push = await webPush();
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:reminders@civicflow.app";
  push.setVapidDetails(subject, keys.publicKey, keys.privateKey);

  const payload = JSON.stringify({
    title: job.title,
    body: job.body,
    href: job.href,
    tag: job.deliveryId,
    priority: job.priority,
  });

  let delivered = 0;
  const errors: string[] = [];

  for (const subscription of job.push) {
    try {
      await push.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
        { TTL: 3600, urgency: job.priority === "high" ? "high" : "normal" },
      );
      delivered += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      errors.push(`${status ?? "error"}: ${(error as Error).message ?? String(error)}`);

      // A gone endpoint is retired once, not retried forever.
      if (status === 404 || status === 410) {
        await client
          .from("push_subscriptions")
          .update({ revoked_at: new Date().toISOString() })
          .eq("endpoint", subscription.endpoint);
      }
    }
  }

  if (delivered > 0) return { status: "sent", provider: "web-push" };
  return { status: "failed", error: errors.join("; ").slice(0, 500), provider: "web-push" };
}

async function deliver(client: SupabaseClient, job: DeliveryJob): Promise<Outcome> {
  if (job.channel === "push") return sendPush(client, job);
  // A row queued for email or SMS before those channels were retired is closed
  // as skipped, not failed: no volunteer was promised something that broke.
  return { status: "skipped", error: "channel_retired" };
}

async function dispatch(client: SupabaseClient, limit: number): Promise<Response> {
  const claimed = await client.rpc("dispatch_reminders", { p_limit: limit });
  if (claimed.error) {
    return json({ status: "error", message: claimed.error.message }, 500);
  }
  if (claimed.data?.status !== "ok") {
    return json(
      { status: claimed.data?.status ?? "error", message: "The dispatcher is busy." },
      409,
    );
  }

  const counts = { sent: 0, failed: 0, skipped: 0, deferred: 0 };
  const failures: string[] = [];

  for (const job of claimed.data.jobs as DeliveryJob[]) {
    let outcome: Outcome;
    try {
      outcome = await deliver(client, job);
    } catch (error) {
      outcome = { status: "failed", error: String((error as Error).message ?? error) };
    }

    counts[outcome.status] += 1;
    if (outcome.status === "failed") {
      failures.push(`${job.channel} ${job.deliveryId}: ${outcome.error ?? "unknown"}`);
    }

    const completed = await client.rpc("complete_delivery", {
      p_id: job.deliveryId,
      p_status: outcome.status,
      p_error: outcome.error ?? null,
      p_provider: outcome.provider ?? "",
    });
    if (completed.error) {
      failures.push(`record ${job.deliveryId}: ${completed.error.message}`);
    }
  }

  const detail = JSON.stringify({
    generated: claimed.data.generated,
    claimed: claimed.data.claimed,
    ...counts,
    failures: failures.slice(0, 10),
  });

  await client.rpc("record_server_job", {
    p_job: "reminders",
    p_status:
      failures.length > 0 && counts.sent === 0 && counts.skipped === 0 ? "failed" : "succeeded",
    p_detail: detail,
  });

  return json({
    status: "ok",
    generated: claimed.data.generated,
    claimed: claimed.data.claimed,
    ...counts,
    failures,
  });
}

async function requestedAction(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get("action");
  if (fromQuery) return fromQuery;
  if (request.method !== "POST") return null;
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return null;
  try {
    const body = (await request.clone().json()) as { action?: unknown } | null;
    return typeof body?.action === "string" ? body.action : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return json(
      { status: "error", message: "The function is missing its project credentials." },
      500,
    );
  }
  const client = serviceClient(url, serviceKey);

  if ((await requestedAction(request)) === "config") {
    return config(client, request);
  }

  // Supabase clients send the key in both `apikey` and `Authorization`.
  // Accept either so a scheduler that only sets one still authenticates, but
  // never accept a signed-in volunteer's user token.
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const apiKey = request.headers.get("apikey") ?? "";
  // The gateway verifies the JWT signature before this code runs, so the role
  // claim is trustworthy here. A signed-in volunteer's token says
  // "authenticated" and is still refused.
  if (bearer !== serviceKey && apiKey !== serviceKey && jwtRole(bearer) !== "service_role") {
    return json({ status: "forbidden", message: "This endpoint is for the scheduler." }, 401);
  }

  const limit = Math.min(
    Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50, 1),
    200,
  );

  try {
    return await dispatch(client, limit);
  } catch (error) {
    return json({ status: "error", message: String((error as Error).message ?? error) }, 500);
  }
});
