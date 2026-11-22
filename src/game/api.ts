// ─────────────────────────────────────────────────────────────────
// DM API CLIENT
// ─────────────────────────────────────────────────────────────────
// Builds the system prompt, sends the
// chat history + user message, returns the DM's plain text reply.
// ─────────────────────────────────────────────────────────────────

import { supabase } from "@/integrations/supabase/client";
import type { DmUsage } from "../../supabase/functions/_shared/dm-provider";
import type { DMRequest } from "../../supabase/functions/_shared/dm-security";
import type { Ally, Character, ChatMessage, Enemy } from "./types";
import type { Arc } from "./arcs";
import { buildSystemPrompt } from "./prompt";
import { stripEnemyAttackRolls } from "./combatTurn";

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
  combatants?: { enemies: readonly Enemy[]; allies: readonly Ally[] };
  /** Bonus damage vs final boss from arc artifact. */
  artifactBonus: number;
  /** Fallback text when the API returns an empty body. */
  silentFallback: string;
};

export async function callDM(args: DMRequestArgs): Promise<string> {
  const {
    character, hp, inventory, effects, history, userMessage,
    spellSlots, language, arc, gold, ac, artifactBonus, combatants, silentFallback,
  } = args;

  const slotsForPrompt = character.id === "mage"
    ? (spellSlots ?? { current: 0, max: 0 })
    : null;

  const text = await requestDm({
    purpose: "turn",
    system: buildSystemPrompt(character, hp, inventory, effects, slotsForPrompt, language, arc, gold, ac, artifactBonus, combatants),
    messages: [
      ...history.map(({ role, content, source }) => ({
        role,
        content: role === "assistant" && source !== "client"
          ? stripEnemyAttackRolls(content).replace(/\[(?:VENDOR|CLUE_FALLBACK|EPILOGUE):[^\]]*\]/gi, "").trim()
          : content,
      })),
      { role: "user", content: userMessage },
    ],
  });
  return text || silentFallback;
}

type DmResponse = { text?: string; model?: string; usage?: DmUsage };

export async function requestDm(request: DMRequest): Promise<string> {
  return (await requestDmResult(request)).text ?? "";
}

export function isDmUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === "API error 503"
    || ("context" in error && error.context instanceof Response && error.context.status === 503);
}

export async function requestDmResult(request: DMRequest): Promise<DmResponse> {
  if (import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    const response = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    return await response.json() as DmResponse;
  }

  const { data, error } = await supabase.functions.invoke<DmResponse>("dungeon-master", {
    body: request,
  });
  if (error) throw error;
  return data ?? {};
}
