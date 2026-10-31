// One-time push setup.
//
// The dispatcher can create VAPID keys on its first push job, but a volunteer
// can only subscribe after the public half exists. This function closes that
// ordering gap. It is service-role only and idempotent: calling it again
// returns the existing public key.

import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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

  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const apiKey = request.headers.get("apikey") ?? "";
  if (bearer !== serviceKey && apiKey !== serviceKey && jwtRole(bearer) !== "service_role") {
    return json({ status: "forbidden", message: "This endpoint is for the operator." }, 401);
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const existing = await client.rpc("read_vapid_keys");
  if (existing.error) {
    return json({ status: "error", message: existing.error.message }, 500);
  }
  if (existing.data?.status === "ok") {
    return json({ status: "ok", created: false, publicKey: existing.data.publicKey });
  }

  const module = await import("npm:web-push@3.6.7");
  const push = module.default ?? module;
  const generated = push.generateVAPIDKeys() as { publicKey: string; privateKey: string };

  const saved = await client.rpc("save_vapid_keys", {
    p_public: generated.publicKey,
    p_private: generated.privateKey,
  });
  if (saved.error) return json({ status: "error", message: saved.error.message }, 500);

  const again = await client.rpc("read_vapid_keys");
  if (again.error || again.data?.status !== "ok") {
    return json({ status: "error", message: "The keys could not be read back." }, 500);
  }

  return json({ status: "ok", created: true, publicKey: again.data.publicKey });
});
