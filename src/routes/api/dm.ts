import { createFileRoute } from "@tanstack/react-router";
import {
  checkTotalSize,
  corsHeaders,
  jsonResponse,
} from "@/server/security";
import { z } from "zod";

const dmRequestSchema = z.object({
  system: z.string().max(80_000).default(""),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(30_000),
      }),
    )
    .min(1)
    .max(80),
});

function responseOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin) return origin;
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

// Proxy to the Anthropic Messages API.
// Validates input, enforces an Origin allowlist, returns sanitized errors.
export const Route = createFileRoute("/api/dm")({
  server: {
    handlers: {
      OPTIONS: async ({ request }: { request: Request }) => {
        const origin = request.headers.get("origin");
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      },

      POST: async ({ request }: { request: Request }) => {
        // 1) Response CORS origin only. Do not reject by Origin here:
        // editor preview hosts are dynamic, and Origin is not a reliable
        // budget-control boundary. Abuse protection is handled by validation,
        // payload limits, and the upcoming auth/quotas layer.
        const origin = responseOrigin(request);

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
              max_tokens: 1000,
              system: parsed.data.system,
              messages: parsed.data.messages,
            }),
          });

          if (!res.ok) {
            // Log the upstream details on our side, but don't return them
            // to the client (they may contain org IDs, model names, etc.)
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
