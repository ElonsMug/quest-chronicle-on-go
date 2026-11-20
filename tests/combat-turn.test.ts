import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPlayerAttackResult, readPendingCombatTurn, recordPlayerAttack, selectEnemyAttackers, stripEnemyAttackRolls,
} from "../src/game/combatTurn.ts";
import { parseDMResponse } from "../src/game/parser.ts";
import type { ChatMessage, Enemy } from "../src/game/types.ts";

const boss: Enemy = {
  name: "Архимаг Малазар", hp: 32, maxHp: 32, ac: 16,
  attackBonus: 5, damage: "d8+3", wisBonus: 3, isBoss: true,
};
const guard: Enemy = { ...boss, name: "Стражник", hp: 8, maxHp: 8, isBoss: false };

test("the engine includes the artifact in a hit and uses that total independently of damage tags", () => {
  const attack = recordPlayerAttack([boss, guard], "enemy-1", 10, 3);
  assert.deepEqual(attack, { target: "enemy-1", damage: 13 });
  assert.ok(attack);
  const expected = [{ name: "enemy-1", damage: 13 }];
  assert.deepEqual(applyPlayerAttackResult(parseDMResponse("Попадание."), attack, [boss, guard]).enemyDamages, expected);
  const incorrect = parseDMResponse("[ENEMY_DAMAGE: enemy-1, 10]\n[ENEMY_DAMAGE: enemy-1, 13]\n[END_COMBAT: victory]");
  const corrected = applyPlayerAttackResult(incorrect, attack, [boss, guard]);
  assert.deepEqual(corrected.enemyDamages, expected);
  assert.equal(corrected.combatEnd, false);

  const miss = recordPlayerAttack([boss], "enemy-1", 0, 3);
  assert.ok(miss);
  assert.deepEqual(applyPlayerAttackResult(incorrect, miss, [boss]).enemyDamages, []);
  assert.equal(recordPlayerAttack([boss, guard], "enemy-2", 5, 3)?.damage, 5);
});

test("a killing blow ends the fight and only living enemies may attack once", () => {
  const woundedBoss = { ...boss, hp: 10 };
  const reply = parseDMResponse("[ENEMY_ATTACK: enemy-1]");
  const attack = recordPlayerAttack([woundedBoss], "enemy-1", 7, 3);
  assert.ok(attack);
  assert.equal(applyPlayerAttackResult(reply, attack, [woundedBoss]).combatEndType, "victory");
  assert.deepEqual(selectEnemyAttackers(
    ["enemy-1", "enemy-2", "Стражник", "enemy-2", "Unknown"],
    [{ ...woundedBoss, hp: 0 }, guard],
  ), [guard]);
});

test("a saved failed turn retains the exact roll and request and cannot replay after a DM reply", () => {
  const messages: ChatMessage[] = [
    { role: "assistant", content: "Malazar attacks." },
    { role: "user", content: "[Attack: Fire Bolt — HIT]" },
    { role: "assistant", source: "client", content: "Connection lost." },
  ];
  const turn = { messageIndex: 1, requestText: "Send the original roll", attack: { target: "enemy-1", damage: 13 } };
  assert.deepEqual(readPendingCombatTurn(JSON.parse(JSON.stringify(turn)), messages, [boss]), turn);
  assert.equal(readPendingCombatTurn(undefined, messages, [boss]), null);
  assert.equal(readPendingCombatTurn(turn, [...messages, { role: "assistant", content: "Hit." }], [boss]), null);
  assert.equal(readPendingCombatTurn(turn, messages, [{ ...boss, hp: 0 }]), null);
});

test("copied English and Russian rolls are removed while prose and attack tags survive", () => {
  const dmReply = "Малазар вскидывает руку.\n\n[ENEMY_ATTACK: enemy-1]Архимаг Малазар атакует — d20(12)+5=17 vs КД11 → ПОПАЛ → 7 урона\n"
    + "Malazar attacks — d20(5)+5=10 vs AC11 → MISS\n"
    + "Пепел летит к алтарю.";
  const parsed = parseDMResponse(stripEnemyAttackRolls(dmReply));
  assert.deepEqual(parsed.enemyAttacks, ["enemy-1"]);
  assert.equal(parsed.narrative, "Малазар вскидывает руку.\nПепел летит к алтарю.");
});
