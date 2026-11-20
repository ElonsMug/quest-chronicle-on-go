import { combatReference, findCombatantIndex } from "./combatReferences.ts";
import type { ChatMessage, Enemy, Parsed } from "./types";

export type PlayerCombatAttack = { target: string; damage: number };

export type PendingCombatTurn = {
  messageIndex: number;
  requestText: string;
  attack: PlayerCombatAttack;
};

export function readPendingCombatTurn(value: unknown, messages: ChatMessage[], enemies: Enemy[]): PendingCombatTurn | null {
  if (!value || typeof value !== "object") return null;
  const turn = value as Partial<PendingCombatTurn>;
  if (typeof turn.messageIndex !== "number" || !Number.isInteger(turn.messageIndex) || turn.messageIndex < 0
    || messages[turn.messageIndex]?.role !== "user"
    || messages.slice(turn.messageIndex + 1).some(message => message.source !== "client")
    || typeof turn.requestText !== "string" || !turn.requestText.trim()
    || typeof turn.attack?.target !== "string" || findCombatantIndex(enemies, "enemy", turn.attack.target) < 0
    || !Number.isSafeInteger(turn.attack.damage) || turn.attack.damage < 0) return null;
  return turn as PendingCombatTurn;
}

export function recordPlayerAttack(
  enemies: Enemy[], target: string | undefined, damage: number, artifactBonus: number,
): PlayerCombatAttack | undefined {
  const index = target === undefined
    ? enemies.findIndex(enemy => enemy.hp > 0)
    : findCombatantIndex(enemies, "enemy", target);
  if (index < 0) return undefined;
  const bonus = damage > 0 && enemies[index].isBoss ? Math.max(0, artifactBonus) : 0;
  return { target: combatReference("enemy", index), damage: damage + bonus };
}

export function applyPlayerAttackResult(parsed: Parsed, attack: PlayerCombatAttack, enemies: Enemy[]): Parsed {
  const target = findCombatantIndex(enemies, "enemy", attack.target);
  if (target < 0) return parsed;
  const hasSurvivors = enemies.some((enemy, index) => enemy.hp > (index === target ? attack.damage : 0))
    || parsed.newEnemies.some(enemy => enemy.hp > 0);
  return {
    ...parsed,
    enemyDamages: attack.damage > 0 ? [{ name: attack.target, damage: attack.damage }] : [],
    combatEnd: !hasSurvivors,
    combatEndType: hasSurvivors ? null : "victory",
  };
}

export function selectEnemyAttackers(references: string[], enemies: Enemy[]): Enemy[] {
  const livingIndexes = new Set(references.map(reference => findCombatantIndex(enemies, "enemy", reference)));
  livingIndexes.delete(-1);
  return Array.from(livingIndexes, index => enemies[index]);
}

// The DM sometimes copies a client log immediately after its tag or on a new line.
// Keep its tags and surrounding prose, and leave client-authored rolls intact.
export function stripEnemyAttackRolls(reply: string): string {
  return reply.replace(/(?:^|(?<=\]))[ \t]*(?:[-*•][ \t]+)?[^\r\n[\].!?]{1,100}?[ \t]+(?:attacks?|атакует)[ \t]*[—–:-][ \t]*d20\s*\(\d+\)[^\r\n[\]]*/gimu, "");
}
