// ─────────────────────────────────────────────────────────────────
// DM API CLIENT
// ─────────────────────────────────────────────────────────────────
// Builds the system prompt, sends the
// chat history + user message, returns the DM's plain text reply.
// ─────────────────────────────────────────────────────────────────

import { supabase } from "@/integrations/supabase/client";
import type { DMRequest } from "../../supabase/functions/_shared/dm-security";
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
  /** Player's current gold — fed into the system prompt. */
  gold: number;
  /** Player's current AC. */
  ac: number;
  /** Bonus damage vs final boss from arc artifact. */
  artifactBonus: number;
  /** Fallback text when the API returns an empty body. */
  silentFallback: string;
};

export async function callDM(args: DMRequestArgs): Promise<string> {
  const {
    character, hp, inventory, effects, history, userMessage,
    spellSlots, language, arc, gold, ac, artifactBonus, silentFallback,
  } = args;

  const slotsForPrompt = character.id === "mage"
    ? (spellSlots ?? { current: 0, max: 0 })
    : null;

  const text = await requestDm({
    purpose: "turn",
    system: buildSystemPrompt(character, hp, inventory, effects, slotsForPrompt, language, arc, gold, ac, artifactBonus),
    messages: [
      ...history.map(({ role, content }) => ({ role, content })),
      { role: "user", content: userMessage },
    ],
  });
  return text || silentFallback;
}

export async function requestDm(request: DMRequest): Promise<string> {
  if (import.meta.env.DEV) {
    const response = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    const data = (await response.json()) as { text?: string };
    return data.text ?? "";
  }

  const { data, error } = await supabase.functions.invoke<{ text?: string }>("dungeon-master", {
    body: request,
  });
  if (error) throw error;
  return data?.text ?? "";
}
