// ─────────────────────────────────────────────────────────────────
// SECURITY HELPERS for /api/dm and other server routes
// ─────────────────────────────────────────────────────────────────
// Centralized config for input limits, allowed origins and CORS.
// Keep this file dependency-free so it loads quickly in the Worker.
// ─────────────────────────────────────────────────────────────────

import { z } from "zod";

// ── Input limits ─────────────────────────────────────────────────
// Conservative caps to keep Anthropic billing predictable.
export const LIMITS = {
  systemMaxChars: 40_000,
  messagesMax: 80,
  messageContentMax: 20_000,
  totalContentMax: 50_000,
} as const;

// ── Zod schema for /api/dm payload ───────────────────────────────
export const dmRequestSchema = z.object({
  system: z.string().max(LIMITS.systemMaxChars).default(""),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(LIMITS.messageContentMax),
      }),
    )
    .min(1)
    .max(LIMITS.messagesMax),
});

export type DMRequest = z.infer<typeof dmRequestSchema>;

/** Returns null if total content within limit, otherwise an error message. */
export function checkTotalSize(payload: DMRequest): string | null {
  const total =
    payload.system.length +
    payload.messages.reduce((sum, m) => sum + m.content.length, 0);
  if (total > LIMITS.totalContentMax) {
    return `Total payload exceeds ${LIMITS.totalContentMax} characters`;
  }
  return null;
}

// ── Origin allowlist ─────────────────────────────────────────────
// Strict list of domains allowed to call the AI proxy.
// Add custom domains here when they go live.
const PROJECT_ID = "4ffc9a2d-14fa-4181-a41a-6ff83f90fe63";

const ALLOWED_HOSTS = new Set([
  // Production
  "quest-chronicle-on-go.lovable.app",
  // Preview / stable project domains for THIS project
  "id-preview--4ffc9a2d-14fa-4181-a41a-6ff83f90fe63.lovable.app",
  "preview--4ffc9a2d-14fa-4181-a41a-6ff83f90fe63.lovable.app",
  "project--4ffc9a2d-14fa-4181-a41a-6ff83f90fe63.lovable.app",
  "project--4ffc9a2d-14fa-4181-a41a-6ff83f90fe63-dev.lovable.app",
  // Sandbox preview — used inside the editor preview iframe
  "4ffc9a2d-14fa-4181-a41a-6ff83f90fe63.lovableproject.com",
  "id-preview--4ffc9a2d-14fa-4181-a41a-6ff83f90fe63.lovableproject.com",
  "preview--4ffc9a2d-14fa-4181-a41a-6ff83f90fe63.lovableproject.com",
]);

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin.trim());
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) {
      return true;
    }
    if (url.protocol !== "https:") return false;

    const host = url.hostname.toLowerCase();
    return (
      ALLOWED_HOSTS.has(host) ||
      (host.endsWith(".lovable.app") && host.includes(PROJECT_ID)) ||
      (host.endsWith(".lovableproject.com") && host.includes(PROJECT_ID))
    );
  } catch {
    return false;
  }
}

/**
 * Verify request comes from an allowed origin.
 * Falls back to Referer when Origin is missing (some browsers omit it on
 * same-origin GET, but POST should always carry one).
 */
export function verifyRequestOrigin(request: Request): {
  ok: boolean;
  origin: string | null;
} {
  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(origin)) return { ok: true, origin };

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (isAllowedOrigin(refOrigin)) return { ok: true, origin: refOrigin };
    } catch {
      // malformed referer
    }
  }

  return { ok: false, origin };
}

// ── CORS ─────────────────────────────────────────────────────────
export function corsHeaders(origin: string | null): Record<string, string> {
  // Only echo the origin back if it is in the allowlist.
  // Otherwise omit the header entirely (browser will block).
  const allowed = origin && isAllowedOrigin(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// ── JSON helpers ─────────────────────────────────────────────────
export function jsonResponse(
  data: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}
