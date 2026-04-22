import { createFileRoute } from "@tanstack/react-router";

// Прокси к Anthropic Messages API.
// Принимает { system: string, messages: [{role, content}] }, возвращает { text: string }.
export const Route = createFileRoute("/api/dm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        let body: { system?: string; messages?: Array<{ role: string; content: string }> };
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const system = typeof body.system === "string" ? body.system : "";
        const messages = Array.isArray(body.messages) ? body.messages : [];

        if (!messages.length) {
          return new Response(
            JSON.stringify({ error: "messages must be a non-empty array" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        // Базовая валидация и нормализация
        const safeMessages = messages
          .filter(
            (m) =>
              m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.length > 0 &&
              m.content.length < 20000,
          )
          .map((m) => ({ role: m.role, content: m.content }));

        try {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1000,
              system,
              messages: safeMessages,
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            console.error("Anthropic error:", res.status, errText);
            return new Response(
              JSON.stringify({ error: "Upstream error", status: res.status, details: errText }),
              { status: 502, headers: { "Content-Type": "application/json" } },
            );
          }

          const data = (await res.json()) as {
            content?: Array<{ text?: string }>;
          };
          const text = data.content?.[0]?.text ?? "Мастер молчит...";

          return new Response(JSON.stringify({ text }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("DM proxy failed:", err);
          return new Response(
            JSON.stringify({ error: "Connection to Master failed" }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
