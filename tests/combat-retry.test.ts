import assert from "node:assert/strict";
import test from "node:test";
import { captureCombatCheckpoint, readCombatCheckpoint } from "../src/game/combatCheckpoint.ts";
import { gameReducer } from "../src/game/reducer.ts";
import { initialGameState } from "../src/game/state.ts";
import type { GameState } from "../src/game/state.ts";
import type { Character, ChatMessage } from "../src/game/types.ts";

const encounter: ChatMessage = {
  role: "assistant",
  content: "A guard blocks the drain.\n[ENEMY: Guard, HP:8]\n[INITIATIVE]",
};
const start: GameState = {
  ...initialGameState,
  character: { id: "rogue" } as Character,
  inCombat: true,
  hp: 10,
  inventory: ["Healing potion"],
  effects: ["Blessed"],
  spellSlots: { current: 2, max: 3 },
  gold: 15,
  enemies: [{ name: "Guard", hp: 8, maxHp: 10, ac: 16, damage: "d6+1", attackBonus: 3, wisBonus: 0 }],
  allies: [{ name: "Guide", hp: 3, maxHp: 5 }],
  messages: [encounter],
};
const note: ChatMessage = { role: "assistant", source: "client", content: "The fight restarts." };

test("retry restores the original encounter and removes the defeated attempt from history", () => {
  const checkpoint = captureCombatCheckpoint(start, true, null);
  const defeated: GameState = {
    ...start,
    hp: 0,
    inCombat: false,
    gold: 1,
    inventory: [],
    effects: [],
    spellSlots: { current: 0, max: 3 },
    enemies: [],
    allies: [],
    didDodgeLastTurn: true,
    berserkUsedThisCombat: true,
    messages: [...start.messages, { role: "assistant", content: "You wake elsewhere.\n[PLAYER_HP: 6]\n[END_COMBAT: narrative]" }],
  };
  const restored = gameReducer(defeated, { type: "RESTORE_COMBAT_CHECKPOINT", checkpoint, restartNote: note });
  assert.deepEqual(restored, { ...start, messages: [encounter, note] });
  assert.equal(checkpoint.pendingInitiative, true);
  assert.equal(checkpoint.pendingRoll, null);
  assert.notEqual(checkpoint.resources.enemies[0], start.enemies[0]);
  assert.deepEqual(
    gameReducer(restored, { type: "RESTORE_COMBAT_CHECKPOINT", checkpoint, restartNote: note }),
    restored,
  );
});

test("a new save can restore the checkpoint while older and mismatched saves cannot", () => {
  const checkpoint = captureCombatCheckpoint(start, true, null);
  assert.deepEqual(readCombatCheckpoint(JSON.parse(JSON.stringify(checkpoint)), "rogue", 1), checkpoint);
  assert.equal(readCombatCheckpoint(undefined, "rogue", 1), null);
  assert.equal(readCombatCheckpoint(checkpoint, "mage", 1), null);
  assert.equal(readCombatCheckpoint({ ...checkpoint, messageCount: -1 }, "rogue", 1), null);
  assert.equal(readCombatCheckpoint({ ...checkpoint, messageCount: 2 }, "rogue", 1), null);
});
