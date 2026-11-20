import type { GameState } from "./state";
import type { CharacterId, PendingRoll } from "./types";

export type CombatCheckpoint = {
  version: 1;
  resources: Omit<GameState, "messages" | "inCombat">;
  messageCount: number;
  pendingInitiative: boolean;
  pendingRoll: PendingRoll | null;
};

export function captureCombatCheckpoint(
  state: GameState, pendingInitiative: boolean, pendingRoll: PendingRoll | null,
): CombatCheckpoint {
  const { messages, inCombat: _, ...resources } = state;
  return structuredClone({
    version: 1,
    resources,
    messageCount: messages.length,
    pendingInitiative,
    pendingRoll,
  });
}

export function readCombatCheckpoint(
  value: unknown, characterId: CharacterId, messageCount: number,
): CombatCheckpoint | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<CombatCheckpoint>;
  const resources = snapshot.resources;
  if (snapshot.version !== 1
    || !Number.isInteger(snapshot.messageCount)
    || snapshot.messageCount === undefined || snapshot.messageCount <= 0 || snapshot.messageCount > messageCount
    || typeof snapshot.pendingInitiative !== "boolean"
    || resources?.character?.id !== characterId
    || !Number.isFinite(resources.hp) || resources.hp <= 0
    || !Array.isArray(resources.enemies) || !resources.enemies.some(enemy => enemy?.hp > 0)
    || !Array.isArray(resources.allies) || !Array.isArray(resources.inventory) || !Array.isArray(resources.effects)) {
    return null;
  }
  return snapshot as CombatCheckpoint;
}
