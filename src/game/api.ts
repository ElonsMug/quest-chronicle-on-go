// ─────────────────────────────────────────────────────────────────
// DM API CLIENT
// ─────────────────────────────────────────────────────────────────
// Thin wrapper around POST /api/dm. Builds the system prompt, sends the
// chat history + user message, returns the DM's plain text reply.
// ─────────────────────────────────────────────────────────────────

import type { Character, ChatMessage } from "./types";
import type { Arc } from "./arcs";
import { buildSystemPrompt } from "./prompt";

export type DMRequestArgs = {
  character: Character;
  hp: number;
  inventory: string[];
  effects: string[];
  history: ChatMessage[];
  userMessage: string;
  spellSlots: { current: number; max: number } | null;
  language: "en" | "ru";
  /** Current narrative arc — fed into the system prompt so the DM
   *  knows the goal, the phase, and what kind of scene to write. */
  arc: Arc | null;
  /** Fallback text when the API returns an empty body. */
  silentFallback: string;
};

export async function callDM(args: DMRequestArgs): Promise<string> {
  const {
    character, hp, inventory, effects, history, userMessage,
    spellSlots, language, arc, silentFallback,
  } = args;

  const slotsForPrompt = character.id === "mage"
    ? (spellSlots ?? { current: 0, max: 0 })
    : null;

  const res = await fetch("/api/dm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: buildSystemPrompt(character, hp, inventory, effects, slotsForPrompt, language, arc),
      messages: [...history, { role: "user", content: userMessage }]
        .map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = (await res.json()) as { text?: string };
  return data.text || silentFallback;
}
