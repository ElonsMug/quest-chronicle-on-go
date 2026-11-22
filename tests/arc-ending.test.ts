import assert from "node:assert/strict";
import test from "node:test";
import { ARC_TEMPLATES, computeNextArc, createArcFromTemplate, finalEncounterOutcome, parseArcVariation } from "../src/game/arcs.ts";
import { claimCombatReward, createCombatLoot, earnedCombatReward, plannedCombatReward } from "../src/game/combatLoot.ts";
import { advanceFinale, beginFinale, completionGold, fallbackFinalePlan } from "../src/game/arcFinale.ts";
import { gameReducer } from "../src/game/reducer.ts";
import { initialGameState } from "../src/game/state.ts";
import { parseDMResponse } from "../src/game/parser.ts";
import type { Enemy } from "../src/game/types.ts";

const arc = { ...createArcFromTemplate(ARC_TEMPLATES[0], "ru"), phase: 5 as const };
const boss: Enemy = {
  name: "Гарек Кровавый Топор", hp: 11, maxHp: 28, ac: 15,
  attackBonus: 3, damage: "d8+2", wisBonus: 0, isBoss: true,
};
const guard: Enemy = { ...boss, name: "Стражник", isBoss: false };
const killedBoss = { ...boss, hp: 0 };

test("accepting the final boss's surrender completes the arc without requiring battle loot", () => {
  const outcome = finalEncounterOutcome(arc, [boss], [boss], 6, false, "surrender", true);
  assert.equal(outcome, "surrender");
  const loot = createCombatLoot(arc);
  assert.equal(earnedCombatReward(loot, arc, [boss], [boss], 6), null);
  const reward = plannedCombatReward(loot, arc, [boss]);
  assert.equal(reward?.kind, "finalBoss");
  assert.equal(reward?.gold, 8);
  assert.ok(reward);
  assert.equal(plannedCombatReward(claimCombatReward(loot, reward), arc, [boss]), null);
  const resolved = computeNextArc({
    ...arc, ending: { kind: "surrender", epilogue: "The road is safe." },
  }, null, false);
  assert.equal(resolved.completed, true);
  assert.equal(resolved.bossDefeated, false);
  assert.strictEqual(computeNextArc(resolved, null, false), resolved);
});

test("lethal victory depends on actual combat state rather than claiming the reward", () => {
  assert.equal(finalEncounterOutcome(arc, [boss], [killedBoss], 6, false, "victory", false), "victory");
  assert.equal(finalEncounterOutcome(arc, [boss, guard], [killedBoss, guard], 6, true, "victory", false), null);
  assert.equal(finalEncounterOutcome(arc, [boss], [killedBoss], 0, false, "victory", false), null);
  assert.equal(earnedCombatReward({ ...createCombatLoot(arc), finalBossClaimed: true }, arc, [boss], [killedBoss], 6), null);
});

test("fleeing, unaccepted surrender and ordinary victories do not complete the objective", () => {
  assert.equal(finalEncounterOutcome(arc, [boss], [], 6, false, "retreat", false), null);
  assert.equal(finalEncounterOutcome(arc, [boss], [], 6, false, "surrender", false), null);
  assert.equal(finalEncounterOutcome(arc, [guard], [{ ...guard, hp: 0 }], 6, false, "victory", false), null);
});

test("the prepared and final epilogues are distinct from battle narration", () => {
  const prepared = parseArcVariation('{"goal":"Освободить тракт","successEpilogue":"Купцы вновь выходят на тракт."}', "ru");
  assert.equal(prepared?.successEpilogue, "Купцы вновь выходят на тракт.");
  const reply = parseDMResponse("Гарек опускает топор.\n[END_COMBAT: surrender]\n[EPILOGUE: Купцы вновь выходят на тракт.]");
  assert.equal(reply.narrative, "Гарек опускает топор.");
  assert.equal(reply.epilogue, "Купцы вновь выходят на тракт.");
});

test("currency described as a bag or a merchant's gold cannot enter inventory", () => {
  const reply = parseDMResponse("[ITEM: Золото купца]\n[ITEM: Мешок золота]\n[ITEM: Топор Гарека]\n[GOLD_OFFER: +4, найденные монеты]");
  assert.deepEqual(reply.newItems, ["Топор Гарека"]);
  assert.equal(reply.goldOffer?.amount, 4);
});

test("the altar remains an explicit player action and the reward waits for the finale", () => {
  const initial = { ...arc, templateId: "mage-demon-pact" };
  const plan = fallbackFinalePlan(initial, key => key);
  assert.ok(plan.objective);
  assert.match(plan.objective.action, /altar/);
  const pending = computeNextArc(beginFinale(initial, plan, "victory", "The valley is safe."), null, false);
  assert.equal(pending.finale?.stage, "objective");
  assert.equal(pending.completed, false);
  assert.equal(pending.ending, undefined);
  assert.equal(advanceFinale(pending, "finish"), null);
  assert.equal(advanceFinale(pending, "report"), null);

  const afterAltar = advanceFinale(pending, "objective");
  assert.ok(afterAltar);
  assert.equal(afterAltar.narration, plan.objective.result);
  assert.equal(afterAltar.arc.finale?.stage, "recognition");
  const reporting = advanceFinale(afterAltar.arc, "report");
  const skipping = advanceFinale(afterAltar.arc, "finish");
  assert.ok(reporting?.arc.ending);
  assert.ok(skipping?.arc.ending);
  assert.equal(reporting.arc.ending.rewardGold, completionGold);
  assert.equal(skipping.arc.ending.rewardGold, completionGold);
  assert.ok(reporting.arc.ending.epilogue.startsWith(plan.recognition!.response));
  assert.equal(skipping.arc.ending.epilogue, "The valley is safe.");
  assert.equal(advanceFinale(reporting.arc, "report"), null);
});

test("the payout adds one special artifact and records everything collected before the end", () => {
  const plan = fallbackFinalePlan(arc, key => key);
  assert.equal(plan.objective, null);
  const recognized = beginFinale(arc, plan, "surrender", "The bandit threat has ended.");
  const state = {
    ...initialGameState, arc: recognized, hp: 6, gold: 7, inventory: ["Sword"],
  };
  const found = gameReducer(state, { type: "SET_INVENTORY", inventory: ["Sword", "Potion", "Potion"] });
  const consumed = gameReducer(found, { type: "SET_INVENTORY", inventory: ["Sword"] });
  assert.deepEqual(consumed.adventureFinds, ["Potion", "Potion"]);
  const finish = advanceFinale(recognized, "finish");
  assert.ok(finish);
  const action = { type: "COMPLETE_FINALE" as const, arc: finish.arc, messages: [] };
  const settled = gameReducer(consumed, action);
  assert.equal(settled.gold, 7 + completionGold);
  assert.equal(settled.arc?.ending?.artifact?.perk, plan.artifact.perk);
  assert.deepEqual(settled.inventory, ["Sword", plan.artifact.name]);
  assert.deepEqual(settled.adventureFinds, ["Potion", "Potion", plan.artifact.name]);
  assert.strictEqual(gameReducer(settled, action), settled);
});

test("an immediate objective with no beneficiary can finish as soon as the boss gives in", () => {
  const plan = { ...fallbackFinalePlan(arc, key => key), recognition: null };
  const pending = beginFinale(arc, plan, "surrender", "The main road is clear.");
  assert.equal(pending.finale?.stage, "recognition");
  assert.equal(advanceFinale(pending, "report"), null);
  assert.equal(advanceFinale(pending, "finish")?.arc.completed, true);
});
