import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPlayerAttackResult, recordPlayerAttack, resolveDisengagement, selectEnemyAttackers, stripEnemyAttackRolls,
} from "../src/game/combatTurn.ts";
import { readPendingTurn } from "../src/game/pendingTurn.ts";
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
  const restored = readPendingTurn(JSON.parse(JSON.stringify(turn)), messages, [boss]);
  assert.equal(restored?.requestText, turn.requestText);
  assert.deepEqual(restored?.resolution.attack, turn.attack);
  assert.equal(readPendingTurn(undefined, messages, [boss]), null);
  assert.equal(readPendingTurn(turn, [...messages, { role: "assistant", content: "Hit." }], [boss]), null);
  assert.equal(readPendingTurn(turn, messages, [{ ...boss, hp: 0 }]), null);
});

test("copied English and Russian rolls are removed while prose and attack tags survive", () => {
  const dmReply = "Малазар вскидывает руку.\n\n[ENEMY_ATTACK: enemy-1]Архимаг Малазар атакует — d20(12)+5=17 vs КД11 → ПОПАЛ → 7 урона\n"
    + "Malazar attacks — d20(5)+5=10 vs AC11 → MISS\n"
    + "Пепел летит к алтарю.";
  const parsed = parseDMResponse(stripEnemyAttackRolls(dmReply));
  assert.deepEqual(parsed.enemyAttacks, ["enemy-1"]);
  assert.equal(parsed.narrative, "Малазар вскидывает руку.\nПепел летит к алтарю.");
});

test("knocking out the leader and losing a fleeing guard both resolve the encounter", () => {
  const guardWithName = { ...guard, name: "Тощий дозорный", hp: 4 };
  const leader = { ...guard, hp: 4 };
  const legacy = parseDMResponse("Тощий дозорный бросает тесак и убегает прочь.\n[END_COMBAT: victory]");
  const tagged = parseDMResponse("[ENEMY_WITHDRAWAL: enemy-2]\n[END_COMBAT: victory]");
  for (const reply of [legacy, tagged]) {
    const resolved = applyPlayerAttackResult(reply, { target: "enemy-1", damage: 12 }, [leader, guardWithName]);
    assert.deepEqual(resolved.enemyWithdrawals, ["enemy-2"]);
    assert.equal(resolved.combatEndType, "victory");
  }
});

test("initiative and copied dice logs are removed while real combat instructions remain", () => {
  const reply = "Органщик преграждает путь.\n[INITIATIVE]Инициатива: ты 16 / враг 5 → Ты первый\n"
    + "[ENEMY_ATTACK: enemy-1]Мортус делает выпад — d20(11)+4=15 vs КД12 → ПОПАЛ"
    + "Мортус атакует — d20(3)+3=6 vs КД12 → МИМО";
  const parsed = parseDMResponse(stripEnemyAttackRolls(reply));
  assert.equal(parsed.initiativeTrigger, true);
  assert.deepEqual(parsed.enemyAttacks, ["enemy-1"]);
  assert.equal(parsed.narrative, "Органщик преграждает путь.");
});

test("accepting surrender cannot restart combat, award loot, or attack when the reply is inconsistent", () => {
  const hostile = parseDMResponse("Мортус поднимает оружие.\n[ENEMY: Мортус, HP:9, AC:14, DMG:d6+2]\n"
    + "[INITIATIVE]\n[ENEMY_ATTACK: enemy-1]\n[DAMAGE: 4]\n[ITEM: Зелье лечения]\n[END_COMBAT: victory]");
  const resolved = resolveDisengagement(hostile, "surrender");
  assert.equal(resolved.combatEndType, "surrender");
  assert.equal(resolved.initiativeTrigger, false);
  assert.equal(resolved.damage, null);
  assert.deepEqual(resolved.newItems, []);
  assert.deepEqual(resolved.newEnemies, []);
  assert.deepEqual(resolved.enemyAttacks, []);
});
