import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { handleDmRequest } from "../_shared/dm-handler.ts";
import { corsHeaders, isAllowedOrigin, jsonResponse } from "../_shared/dm-security.ts";

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Forbidden" }, 403, origin);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return jsonResponse({ error: "Sign-in required" }, 401, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) {
    console.error("[dm] Missing Supabase configuration");
    return jsonResponse({ error: "Service unavailable" }, 503, origin);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) {
    return jsonResponse({ error: "Sign-in required" }, 401, origin);
  }

  return handleDmRequest(request, origin, {
    DM_PROVIDER: Deno.env.get("DM_PROVIDER"),
    GEMINI_API_KEY: Deno.env.get("GEMINI_API_KEY"),
    DEEPSEEK_API_KEY: Deno.env.get("DEEPSEEK_API_KEY"),
  });
});
