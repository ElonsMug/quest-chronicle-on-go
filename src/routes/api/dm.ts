import { createFileRoute } from "@tanstack/react-router";
import {
  checkTotalSize,
  corsHeaders,
  dmRequestSchema,
  jsonResponse,
  verifyRequestOrigin,
} from "@/server/security.server";

// Proxy to the Anthropic Messages API.
// Validates input, enforces an Origin allowlist, returns sanitized errors.
// TanStack Start exposes server route handlers via the `server` block, but
// the typings for createFileRoute don't surface it yet. Cast keeps the
// route file-based, dev-tooling-aware, and the runtime ignores the cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute("/api/dm") as any)({
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

        // 2) API key configured?
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          console.error("[dm] ANTHROPIC_API_KEY missing");
          return jsonResponse(
            { error: "Service unavailable" },
            503,
            origin,
          );
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

        // 4) Call Anthropic
        try {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 1200,
              system: parsed.data.system,
              messages: parsed.data.messages,
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            console.error("[dm] anthropic error:", res.status, errText);
            return jsonResponse(
              { error: "The Master is silent for a moment..." },
              502,
              origin,
            );
          }

          const data = (await res.json()) as {
            content?: Array<{ text?: string }>;
          };
          const text = data.content?.[0]?.text ?? "The Master is silent...";

          return jsonResponse({ text }, 200, origin);
        } catch (err) {
          console.error("[dm] proxy failed:", err);
          return jsonResponse(
            { error: "Connection to Master failed" },
            502,
            origin,
          );
        }
      },
    },
  },
});
