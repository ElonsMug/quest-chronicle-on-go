import type { ChatMessage, Parsed, RollRequest, SocialFailure } from "./types";
import type { StoryChoice } from "./abilityChecks";

export function storyChoices(choices: StoryChoice[], failure?: SocialFailure): StoryChoice[] {
  if (!failure) return choices;
  const lead = failure.clueFallback?.lead;
  const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const key = lead ? normalize(lead) : "";
  const index = choices.findIndex(choice => choice.clueRoute || (key && normalize(choice.text).includes(key)));
  if (index >= 0) return choices.map((choice, i) => i === index ? { ...choice, check: null, clueRoute: true } : choice);
  if (!lead) return choices;
  const neutral = Math.max(0, choices.findIndex(choice => !choice.check));
  const route: StoryChoice = { num: "1", text: lead, check: null, clueRoute: true };
  const next = choices.length < 3 ? [...choices, route] : choices.map((choice, i) => i === neutral ? route : choice);
  return next.map((choice, i) => ({ ...choice, num: String(i + 1) }));
}

// Older saves did not distinguish these client-side notes from the DM's replies.
const legacyNotes = /^(?:✦ (?:Короткий отдых\.|Длинный отдых\.|Short rest\.|Long rest\.)|Зелье выпито\.|Potion drunk\.)/;

export function currentSceneMessageIndex(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") return -1;
    if (message.source !== "client" && !legacyNotes.test(message.content)) return i;
  }
  return -1;
}

export function canSettleGold(balance: number, amount: number): boolean {
  return Number.isSafeInteger(amount) && amount !== 0
    && Number.isSafeInteger(balance + amount) && balance + amount >= 0;
}

export function stagePaidOffer(parsed: Parsed, quote: Parsed): Parsed {
  if (!parsed.goldOffer || parsed.goldOffer.amount >= 0) return parsed;
  return { ...quote, goldOffer: parsed.goldOffer };
}

export function getSocialFailure(
  request: RollRequest, success: boolean, inCombat: boolean, messages: readonly ChatMessage[],
): SocialFailure | undefined {
  // Older DM replies only supplied a stat. Charisma checks were used for social actions.
  if (success || inCombat || (!request.social && request.stat !== "cha")) return undefined;
  const index = currentSceneMessageIndex(messages);
  const action = messages[index - 1];
  return {
    action: action?.role === "user" ? action.content : undefined,
    clueFallback: messages[index]?.parsed?.clueFallback,
  };
}
