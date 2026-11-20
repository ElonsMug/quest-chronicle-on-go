import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionReport, downloadSessionReport } from "../src/game/sessionReport.ts";
import { initialGameState } from "../src/game/state.ts";
import { parseDMResponse } from "../src/game/parser.ts";

const oldReply = "The door is open.\n1. Inspect the wall.";
const newReply = "A guard jumps out.\n[INITIATIVE]";
const game = {
  ...initialGameState,
  hp: 14,
  messages: [
    { role: "assistant" as const, content: oldReply, parsed: parseDMResponse(oldReply) },
    { role: "user" as const, content: "Inspect the wall." },
    { role: "assistant" as const, content: newReply, parsed: parseDMResponse(newReply) },
  ],
};

const context = {
  language: "en" as const, activeTab: "story" as const, loading: false,
  pendingRoll: null, pendingInitiative: false, showCombatButtons: false,
  showNegotiation: false, selectingTarget: false, freeInputOpen: false,
  freeChoiceAvailable: true, defeatPending: false, choiceSourceMessageIndex: 0,
  displayedChoices: [{ num: "1", text: "Inspect the wall." }],
};

test("reports retain both old choices and the raw reply that superseded them", () => {
  const report = buildSessionReport(game, context, new Date("2026-11-20T12:00:00Z"));
  const saved = JSON.parse(JSON.stringify(report));
  assert.equal(saved.version, 1);
  assert.equal(saved.exportedAt, "2026-11-20T12:00:00.000Z");
  assert.equal(saved.game.messages[1].content, "Inspect the wall.");
  assert.equal(saved.game.messages[2].content, newReply);
  assert.equal(saved.game.messages[2].parsed.initiativeTrigger, true);
  assert.equal(saved.interface.choiceSourceMessageIndex, 0);
  assert.deepEqual(saved.interface.displayedChoices, context.displayedChoices);
});

test("the save action downloads a JSON file and releases the object URL", async t => {
  let clicked = false;
  let removed = false;
  let cleanup: (() => void) | undefined;
  const anchor = {
    href: "",
    download: "",
    click() { clicked = true; },
    remove() { removed = true; },
  };
  const documentMock = {
    body: { append: t.mock.fn() },
    createElement: t.mock.fn(() => anchor),
  };
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "document", { value: documentMock, configurable: true });
  Object.defineProperty(globalThis, "window", {
    value: { setTimeout(callback: () => void) { cleanup = callback; } },
    configurable: true,
  });
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const createUrl = t.mock.method(URL, "createObjectURL", () => "blob:test");
  const revokeUrl = t.mock.method(URL, "revokeObjectURL", () => {});
  downloadSessionReport(game, context);
  assert.equal(anchor.href, "blob:test");
  assert.match(anchor.download, /^solo-dnd-session-.+\.json$/);
  assert.ok(clicked && removed);
  const [blob] = createUrl.mock.calls[0].arguments;
  assert.equal(blob.type, "application/json");
  assert.equal(JSON.parse(await blob.text()).game.messages[2].content, newReply);
  cleanup?.();
  assert.deepEqual(revokeUrl.mock.calls[0].arguments, ["blob:test"]);
});
