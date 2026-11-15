import { createFileRoute } from "@tanstack/react-router";
import {
  checkTotalSize,
  corsHeaders,
  dmRequestSchema,
  jsonResponse,
  verifyRequestOrigin,
} from "@/lib/security";

// Proxy to the configured Dungeon Master model.
// Validates input, enforces an Origin allowlist, returns sanitized errors.
export const Route = createFileRoute("/api/dm")({
  server: {
    handlers: {
      OPTIONS: async ({ request }: { request: Request }) => {
        const origin = request.headers.get("origin");
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      },

      POST: async ({ request }: { request: Request }) => {
        // 1) Enforce origin allowlist. Browser-based misuse from other
        // domains is rejected outright. Direct HTTP clients can still spoof
        // the Origin header, but this closes the easy abuse path until
        // proper auth + quotas are added.
        const { ok, origin } = verifyRequestOrigin(request);
        if (!ok) {
          console.warn("[dm] rejected origin:", origin);
          return jsonResponse({ error: "Forbidden" }, 403, origin);
        }

        // 3) Parse & validate body
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return jsonResponse({ error: "Invalid JSON" }, 400, origin);
        }

        const parsed = dmRequestSchema.safeParse(raw);
        if (!parsed.success) {
          // Don't leak schema details to the browser, log them for us.
          console.warn("[dm] schema rejected:", parsed.error.issues.slice(0, 3));
          return jsonResponse({ error: "Invalid request" }, 400, origin);
        }

        const sizeErr = checkTotalSize(parsed.data);
        if (sizeErr) {
          console.warn("[dm] payload too large:", sizeErr);
          return jsonResponse({ error: "Request too large" }, 413, origin);
        }

        const { DmProviderError, generateDmReply, getDmConfig } =
          await import("@/lib/dm-provider.server");
        const config = getDmConfig(process.env);
        if (!config) {
          console.error("[dm] Missing or invalid provider configuration");
          return jsonResponse({ error: "Service unavailable" }, 503, origin);
        }

        try {
          const text = await generateDmReply(config, parsed.data);
          return jsonResponse({ text }, 200, origin);
        } catch (err) {
          const status = err instanceof DmProviderError ? err.status : undefined;
          const timedOut = err instanceof Error && err.name === "TimeoutError";
          console.error("[dm] proxy failed", { provider: config.provider, status, timedOut });
          return jsonResponse({ error: "Connection to Master failed" }, 502, origin);
        }
      },
    },
  },
});
