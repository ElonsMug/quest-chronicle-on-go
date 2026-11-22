import assert from "node:assert/strict";
import test from "node:test";
import { readPendingTurn, turnMessages, type PendingTurn } from "../src/game/pendingTurn.ts";
import type { ChatMessage } from "../src/game/types.ts";

test("retry restores a story turn without duplicating the action or sending its error to Gemini", () => {
  const scene: ChatMessage = { role: "assistant", content: "Информатор вздрагивает." };
  const action: ChatMessage = { role: "user", content: "Спросить, о ком он говорит." };
  const error: ChatMessage = { role: "assistant", source: "client", content: "Мастер не ответил." };
  const pending: PendingTurn = {
    messageIndex: 1, requestText: action.content,
    resolution: {
      checkResult: "Persuasion failed",
      socialFailure: { action: "Успокоить информатора", clueFallback: { lead: "Найти письмо", fact: "Встреча у причала" } },
    },
  };
  const restored = readPendingTurn(JSON.parse(JSON.stringify(pending)), [scene, action, error], []);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), pending);
  assert.deepEqual(turnMessages([scene, action, error], pending.messageIndex), {
    history: [scene], includingTurn: [scene, action],
  });
  assert.equal(readPendingTurn(pending, [scene, action, { role: "assistant", content: "Ответ информатора." }], []), null);
});

test("a pending surrender keeps the settlement option after a reload", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "Accept surrender" }];
  const turn = { messageIndex: 0, requestText: "Resolve surrender", resolution: { disengagement: "surrender" } };
  assert.equal(readPendingTurn(JSON.parse(JSON.stringify(turn)), messages, [])?.resolution.disengagement, "surrender");
});
