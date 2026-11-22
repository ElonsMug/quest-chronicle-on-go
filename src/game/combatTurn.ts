import { combatReference, findCombatantIndex } from "./combatReferences.ts";
import type { Enemy, Parsed } from "./types";

export type PlayerCombatAttack = { target: string; damage: number };

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
  const remaining = enemies.map((enemy, index) => index === target ? { ...enemy, hp: Math.max(0, enemy.hp - attack.damage) } : enemy);
  const withdrawing = withdrawingEnemies(parsed, remaining);
  const hasSurvivors = remaining.some((enemy, index) => enemy.hp > 0 && !withdrawing.has(index))
    || parsed.newEnemies.some(enemy => enemy.hp > 0);
  return {
    ...parsed,
    enemyDamages: attack.damage > 0 ? [{ name: attack.target, damage: attack.damage }] : [],
    enemyWithdrawals: [...withdrawing].map(index => combatReference("enemy", index)),
    combatEnd: !hasSurvivors,
    combatEndType: hasSurvivors ? null : "victory",
  };
}

export function selectEnemyAttackers(references: string[], enemies: Enemy[]): Enemy[] {
  const livingIndexes = new Set(references.map(reference => findCombatantIndex(enemies, "enemy", reference)));
  livingIndexes.delete(-1);
  return Array.from(livingIndexes, index => enemies[index]);
}

// Older narration can explicitly name a fleeing minion without the tag.
export function withdrawingEnemies(parsed: Parsed, enemies: Enemy[]): Set<number> {
  const tags = new Set((parsed.enemyWithdrawals ?? []).map(ref => findCombatantIndex(enemies, "enemy", ref)));
  const sentences = parsed.narrative.split(/[.!?\n]+/);
  return new Set(enemies.flatMap((enemy, index) => {
    if (enemy.hp <= 0 || enemy.isBoss || enemy.isMidBoss) return [];
    const namedRetreat = parsed.combatEnd && sentences.some(sentence =>
      sentence.toLowerCase().includes(enemy.name.toLowerCase())
      && /убега|убежа|скрыл[ас]|скрыва|броса.{0,35}бегство|flees|fled|runs away|retreats/i.test(sentence));
    return tags.has(index) || namedRetreat ? [index] : [];
  }));
}

export function resolveDisengagement(parsed: Parsed, ending: "surrender" | "retreat"): Parsed {
  return {
    ...parsed,
    combatEnd: true, combatEndType: ending, newEnemies: [], newAllies: [], damage: null,
    enemyDamages: [], enemyWithdrawals: [], enemyAttacks: [], allyDamages: [], behaviorShift: null,
    initiativeTrigger: false, attackRequest: null, rollRequest: null, playerHpRestore: null,
    newItem: null, newItems: [], upgrades: [], newEffects: [], goldOffer: null, goldChange: null,
  };
}

// Client-authored rolls are displayed separately. Keep their tags in DM replies, strip copied rolls.
export function stripEnemyAttackRolls(reply: string): string {
  return reply
    .replace(/(?:^|(?<=\]))[ \t]*[^\r\n[\]]{0,145}?[—–:-][ \t]*d20\s*\(\d+\)[^\r\n[\]]*/gimu, "")
    .replace(/(?:^|(?<=\]))[ \t]*(?:инициатива|initiative)\s*:[^\r\n[\]]*/gimu, "");
}
