import { DmProviderError, generateDmReply, getDmConfig } from "./dm-provider.ts";
import { checkTotalSize, dmRequestSchema, jsonResponse } from "./dm-security.ts";

export async function handleDmRequest(
  request: Request,
  origin: string | null,
  env: Record<string, string | undefined>,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  const parsed = dmRequestSchema.safeParse(raw);
  if (!parsed.success) return jsonResponse({ error: "Invalid request" }, 400, origin);
  if (checkTotalSize(parsed.data)) {
    return jsonResponse({ error: "Request too large" }, 413, origin);
  }

  const config = getDmConfig(env);
  if (!config) {
    console.error("[dm] Missing or invalid provider configuration");
    return jsonResponse({ error: "Service unavailable" }, 503, origin);
  }

  try {
    const text = await generateDmReply(config, parsed.data);
    return jsonResponse({ text }, 200, origin);
  } catch (error) {
    const status = error instanceof DmProviderError ? error.status : undefined;
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.error("[dm] proxy failed", { provider: config.provider, status, timedOut });
    return jsonResponse({ error: "Connection to Master failed" }, 502, origin);
  }
}
