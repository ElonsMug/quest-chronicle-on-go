import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceLighthouse,
  lighthouseActions,
  lighthouseEnemies,
  startLighthouse,
  type LighthouseAction,
} from "../src/game/lighthouseAdventure.ts";
import { handleDmRequest } from "../supabase/functions/_shared/dm-handler.ts";

const hero = {
  maxHp: 14,
  ac: 13,
  stats: { str: 3, dex: 1, con: 2, int: -1, wis: 0, cha: 0 },
  weapon: { name: "Sword", dice: "d8", stat: "str" as const },
};

function play(actions: LighthouseAction[], roll: (sides: number) => number) {
  let state = startLighthouse(hero);
  let requests = 1;
  for (const action of actions) {
    const turn = advanceLighthouse(state, action, hero, roll);
    assert.ok(turn, `${action} is available in ${state.scene}`);
    state = turn.state;
    requests++;
  }
  return { state, requests };
}

test("two prepared clues unlock a complete five-request peaceful route", () => {
  const { state, requests } = play(["keeper", "orders", "showOrders", "negotiate"], () => {
    assert.fail("The evidence route does not require dice");
  });
  assert.deepEqual(state.clues, ["keeper", "orders"]);
  assert.equal(state.outcome, "lit");
  assert.equal(requests, 5);
  assert.deepEqual(lighthouseActions(state), []);
});

test("fights use prepared opponents and end even when all attacks miss", () => {
  const miss = () => 1;
  const gate = play(["keeper", "orders"], miss).state;
  const guard = advanceLighthouse(gate, "rushGuard", hero, miss);
  assert.equal(guard?.state.enemyHp, lighthouseEnemies.guard.hp);
  const { state, requests } = play([
    "keeper", "orders", "rushGuard", "strike", "strike", "strike",
    "confrontCaptain", "strike", "strike", "strike",
  ], miss);
  assert.equal(state.outcome, "lost");
  assert.equal(requests, 11);
});

test("a failed repair opens combat and the emergency flare still ends the story", () => {
  const { state } = play(["keeper", "passage", "takePassage", "repair", "flare"], () => 1);
  assert.equal(state.outcome, "warned");
  const withoutEvidence = play(["keeper", "passage", "takePassage"], () => 1).state;
  assert.equal(advanceLighthouse(withoutEvidence, "negotiate", hero), null);
});

test("the adventure response reports provider usage, including hidden thinking output", async (t) => {
  t.mock.method(console, "info", () => {});
  const call = t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 70, thoughtsTokenCount: 9 },
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "The light returns." }] } }],
    }),
  );
  const response = await handleDmRequest(new Request("http://localhost/api/dm", {
    method: "POST",
    body: JSON.stringify({ purpose: "lighthouse", messages: [{ role: "user", content: "Start" }] }),
  }), "http://localhost", { DM_PROVIDER: "deepseek", GEMINI_API_KEY: "mock" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    text: "The light returns.",
    usage: { input: 300, output: 79, thinking: 9 },
    model: "gemini-3.5-flash-lite",
  });
  assert.match(String(call.mock.calls[0].arguments[0]), /generativelanguage.googleapis.com/);
});
