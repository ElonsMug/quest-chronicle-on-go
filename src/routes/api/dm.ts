import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/dm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!import.meta.env.DEV) return new Response(null, { status: 404 });

        const { jsonResponse, verifyRequestOrigin } =
          await import("../../../supabase/functions/_shared/dm-security");
        const { ok, origin } = verifyRequestOrigin(request);
        if (!ok || !origin || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) {
          return jsonResponse({ error: "Forbidden" }, 403, origin);
        }

        const { handleDmRequest } = await import("../../../supabase/functions/_shared/dm-handler");
        return handleDmRequest(request, origin, process.env);
      },
    },
  },
});
