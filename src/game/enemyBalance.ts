import { rollDice } from "./dice.ts";
import type { Enemy } from "./types";

function damageDice(damage: string) {
  const match = damage.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  return match ? { count: Number(match[1] || 1), sides: Number(match[2]), modifier: Number(match[3] || 0) }
    : { count: 1, sides: 4, modifier: 0 };
}

export function balanceEnemy(enemy: Enemy): Enemy {
  if (enemy.isBoss) return enemy;
  const elite = enemy.isMidBoss;
  const dice = damageDice(enemy.damage);
  const sides = Math.max(2, Math.min(dice.sides, elite ? 6 : 4));
  const modifier = Math.max(0, Math.min(dice.modifier, elite ? 2 : 1));
  const maxHp = Math.min(enemy.maxHp, elite ? 22 : 12);
  return {
    ...enemy,
    hp: Math.min(enemy.hp, maxHp),
    maxHp,
    ac: Math.min(enemy.ac, elite ? 14 : 13),
    attackBonus: Math.min(enemy.attackBonus, elite ? 4 : 3),
    damage: `d${sides}${modifier ? `+${modifier}` : ""}`,
  };
}

export function resolveEnemyAttack(
  enemy: Enemy, playerAc: number, maxHp: number, disadvantage = false, roll = rollDice,
) {
  const { attackBonus, damage } = balanceEnemy(enemy);
  const first = roll(20);
  const second = disadvantage ? roll(20) : null;
  const die = second === null ? first : Math.min(first, second);
  const total = die + attackBonus;
  const crit = die === 20;
  const hit = die !== 1 && (crit || total >= playerAc);
  let damageDealt = 0;
  if (hit) {
    const dice = damageDice(damage);
    const rolls = Math.max(1, Math.min(dice.count, 4)) * (crit ? 2 : 1);
    damageDealt = dice.modifier;
    for (let i = 0; i < rolls; i++) damageDealt += roll(Math.max(2, Math.min(dice.sides, 20)));
    const cap = enemy.isBoss ? Infinity : Math.max(1, Math.floor(maxHp * (enemy.isMidBoss ? 0.4 : 1 / 3)));
    damageDealt = Math.min(cap, Math.max(1, damageDealt));
  }
  return { first, second, die, total, attackBonus, crit, hit, damageDealt };
}
