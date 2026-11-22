import assert from "node:assert/strict";
import test from "node:test";
import { ARC_TEMPLATES, createArcFromTemplate } from "../src/game/arcs.ts";
import { buildCharacters } from "../src/game/characters.ts";
import { createCombatLoot, earnedCombatReward, readCombatLoot } from "../src/game/combatLoot.ts";
import { parseDMResponse } from "../src/game/parser.ts";
import { gameReducer } from "../src/game/reducer.ts";
import { initialGameState } from "../src/game/state.ts";

const hero = buildCharacters(key => key)[0];
const arc = { ...createArcFromTemplate(ARC_TEMPLATES[0], "ru"), phase: 3 as const };
const ordinary = parseDMResponse("[ENEMY: Страж, HP:8, AC:12, ATK:+3, DMG:d6, WIS:+0]").newEnemies[0];
const midBoss = { ...ordinary, name: "Промежуточный босс", isMidBoss: true };
const defeated = (enemy = ordinary) => ({ ...enemy, hp: 0 });

test("adventure creation prepares a stable plan and old saves do not re-award completed boss rewards", () => {
  const state = gameReducer(initialGameState, { type: "START_GAME", character: hero, startInventory: [], arc });
  assert.deepEqual(state.combatLoot, createCombatLoot(arc));
  assert.deepEqual(readCombatLoot(JSON.parse(JSON.stringify(state.combatLoot)), arc), state.combatLoot);
  assert.equal(readCombatLoot(undefined, { ...arc, midBossDefeated: true }).midBossClaimed, true);
});

test("only a complete victory by a surviving hero can issue the prepared loot", () => {
  const loot = createCombatLoot(arc);
  assert.equal(earnedCombatReward(loot, arc, [midBoss, ordinary], [defeated(midBoss), ordinary], 8), null);
  assert.equal(earnedCombatReward(loot, arc, [midBoss], [], 8), null);
  assert.equal(earnedCombatReward(loot, arc, [midBoss], [defeated(midBoss)], 0), null);
  assert.equal(earnedCombatReward(loot, arc, [defeated(midBoss)], [defeated(midBoss)], 8), null);
  assert.equal(earnedCombatReward(loot, arc, [ordinary], [defeated()], 8)?.kind, "ordinary");
  assert.equal(earnedCombatReward(loot, arc, [midBoss], [defeated(midBoss)], 8)?.kind, "midBoss");
});

test("claiming the same reward twice cannot duplicate it or unlock the artifact early", () => {
  const initial = gameReducer(initialGameState, { type: "START_GAME", character: hero, startInventory: [], arc });
  const ordinaryReward = earnedCombatReward(initial.combatLoot, arc, [ordinary], [defeated()], 8);
  assert.ok(ordinaryReward);
  const claim = { type: "CLAIM_COMBAT_REWARD", reward: ordinaryReward, language: "ru" } as const;
  const afterOrdinary = gameReducer(initial, claim);
  assert.equal(afterOrdinary.artifactBonus, 0);
  assert.equal(afterOrdinary.gold, hero.startGold + ordinaryReward.gold);
  assert.equal(gameReducer(afterOrdinary, claim), afterOrdinary);

  const bossReward = earnedCombatReward(afterOrdinary.combatLoot, arc, [midBoss], [defeated(midBoss)], 8);
  assert.ok(bossReward);
  const claimBoss = { ...claim, reward: bossReward };
  const afterBoss = gameReducer(afterOrdinary, claimBoss);
  assert.equal(afterBoss.artifactBonus, 3);
  assert.equal(afterBoss.inventory.filter(item => item === "Печать авангарда").length, 1);
  assert.equal(gameReducer(afterBoss, claimBoss), afterBoss);
  assert.equal(earnedCombatReward(afterBoss.combatLoot, arc, [midBoss], [defeated(midBoss)], 8), null);
  assert.deepEqual(parseDMResponse("[ITEM: Печать авангарда]").newItems, []);
});
