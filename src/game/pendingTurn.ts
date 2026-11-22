import { findCombatantIndex } from "./combatReferences.ts";
import type { PlayerCombatAttack } from "./combatTurn";
import type { ChatMessage, Enemy, SocialFailure } from "./types";

export type TurnResolution = {
  attack?: PlayerCombatAttack;
  dodge?: true;
  disengagement?: "surrender" | "retreat";
  extraAttack?: true;
  berserkAttack?: true;
  midBossBypass?: true;
  noCheck?: boolean;
  checkResult?: string;
  consumeScoutKit?: boolean;
  socialFailure?: SocialFailure;
  followClue?: SocialFailure;
};

export type PendingTurn = { messageIndex: number; requestText: string; resolution: TurnResolution };

export function turnMessages(messages: ChatMessage[], messageIndex: number) {
  const playerMessage = messages[messageIndex];
  if (playerMessage?.role !== "user"
    || messages.slice(messageIndex + 1).some(message => message.source !== "client")) return null;
  return { history: messages.slice(0, messageIndex), includingTurn: messages.slice(0, messageIndex + 1) };
}

export function readPendingTurn(value: unknown, messages: ChatMessage[], enemies: Enemy[]): PendingTurn | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Partial<PendingTurn> & { attack?: PlayerCombatAttack };
  if (typeof saved.messageIndex !== "number" || !Number.isSafeInteger(saved.messageIndex) || saved.messageIndex < 0
    || !turnMessages(messages, saved.messageIndex) || typeof saved.requestText !== "string" || !saved.requestText.trim()) return null;
  const resolution = saved.resolution ?? (saved.attack ? { attack: saved.attack } : null);
  if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)) return null;
  const { attack, dodge, disengagement, extraAttack, berserkAttack, midBossBypass, noCheck, checkResult, consumeScoutKit, socialFailure, followClue } = resolution;
  if (attack !== undefined && (typeof attack?.target !== "string"
    || findCombatantIndex(enemies, "enemy", attack.target) < 0
    || !Number.isSafeInteger(attack.damage) || attack.damage < 0)) return null;
  if (disengagement !== undefined && disengagement !== "surrender" && disengagement !== "retreat") return null;
  return {
    messageIndex: saved.messageIndex,
    requestText: saved.requestText,
    resolution: { attack, dodge, disengagement, extraAttack, berserkAttack, midBossBypass, noCheck, checkResult, consumeScoutKit, socialFailure, followClue },
  };
}
