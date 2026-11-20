import assert from "node:assert/strict";
import test from "node:test";
import { balanceEnemy, resolveEnemyAttack } from "../src/game/enemyBalance.ts";
import type { Enemy } from "../src/game/types.ts";

const enemy: Enemy = {
  name: "Стражник", hp: 32, maxHp: 32, attackBonus: 5, ac: 16, damage: "d8+2", wisBonus: 1,
};

test("ordinary enemies cannot take half a healthy hero's HP with a single critical hit", () => {
  const balanced = balanceEnemy(enemy);
  assert.deepEqual([balanced.hp, balanced.ac, balanced.attackBonus, balanced.damage], [12, 13, 3, "d4+1"]);
  for (const hp of [8, 10, 14]) {
    const attack = resolveEnemyAttack(enemy, 11, hp, false, sides => sides);
    assert.equal(attack.crit, true);
    assert.ok(attack.damageDealt * 2 < hp);
  }
});

test("Dodge rolls twice and uses the lower result without rolling damage on a miss", () => {
  const values = [12, 5];
  const attack = resolveEnemyAttack({ ...enemy, isMidBoss: true }, 12, 10, true, sides => {
    assert.equal(sides, 20);
    return values.shift()!;
  });
  assert.deepEqual([attack.first, attack.second, attack.die, attack.hit, attack.damageDealt], [12, 5, 5, false, 0]);
  assert.equal(values.length, 0);
});

test("the reported mid-boss has a 4 HP cap against a rogue but the final boss stays dangerous", () => {
  const roll = (sides: number) => sides === 20 ? 12 : sides;
  assert.equal(resolveEnemyAttack({ ...enemy, isMidBoss: true }, 12, 10, false, roll).damageDealt, 4);
  assert.equal(resolveEnemyAttack({ ...enemy, isBoss: true }, 12, 10, false, roll).damageDealt, 10);
});
