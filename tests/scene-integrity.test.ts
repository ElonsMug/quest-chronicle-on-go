import assert from "node:assert/strict";
import test from "node:test";
import { parseDMResponse } from "../src/game/parser.ts";
import { canSettleGold, currentSceneMessageIndex, getSocialFailure, stagePaidOffer, storyChoices } from "../src/game/sceneMessages.ts";
import { rollAbilityCheck } from "../src/game/dice.ts";
import type { ChatMessage } from "../src/game/types.ts";

function reply(content: string): ChatMessage {
  return { role: "assistant", content, parsed: parseDMResponse(content) };
}

test("an ambush can declare a living enemy with a motive and initiative", () => {
  const parsed = parseDMResponse(
    "Страж преграждает путь.\n[ENEMY: Проклятый страж, AC:13, HP:8, DMG:d6+1, MOTIVE:duty, ATK:+3, UNDEAD]\n[INITIATIVE]",
  );
  assert.equal(parsed.initiativeTrigger, true);
  assert.equal(parsed.newEnemies.length, 1);
  assert.equal(parsed.newEnemies[0].name, "Проклятый страж");
  assert.equal(parsed.newEnemies[0].hp, 8);
  assert.equal(parsed.newEnemies[0].ac, 13);
  assert.equal(parsed.newEnemies[0].isUndead, true);
  const boss = parseDMResponse("[ENEMY: Final Boss, HP:28, AC:15, DMG:d8+2, MOTIVE:boss, BOSS]");
  assert.equal(boss.newEnemies[0].isBoss, true);
  assert.equal(parseDMResponse("[ENEMY: Unknown, MOTIVE:duty]\n[INITIATIVE]").newEnemies.length, 0);
});

test("combat narration never resurrects a choice from before the ambush", () => {
  const messages: ChatMessage[] = [
    reply("The door is open.\n1. Inspect the wall."),
    { role: "user", content: "Inspect the wall." },
    reply("A guard blocks your way.\n[INITIATIVE]"),
    { ...reply("You act first."), source: "client" },
  ];
  const currentScene = currentSceneMessageIndex(messages);
  assert.equal(currentScene, 2);
  assert.deepEqual(messages[currentScene].parsed?.choices, []);
});

test("local notes preserve unplayed choices but stop at a submitted action", () => {
  const scene = reply("At the tavern.\n1. Look around.");
  assert.equal(currentSceneMessageIndex([scene, { ...reply("You heal."), source: "client" }]), 0);
  assert.equal(currentSceneMessageIndex([scene, reply("✦ Short rest. Restored 2 HP.")]), 0);
  assert.equal(currentSceneMessageIndex([scene, { role: "user", content: "Look around." }]), -1);
});

test("unsolicited gold in the reported scene creates neither an offer nor an item", () => {
  const parsed = parseDMResponse("Трактирщик рассказывает о дороге.\n[ITEM: 5 gold]\n[GOLD: +5]");
  assert.equal(parsed.goldChange, 5);
  assert.equal(parsed.goldOffer, null);
  assert.deepEqual(parsed.newItems, []);
});

test("only one well-formed offer may be confirmed and it must fit the wallet", () => {
  const parsed = parseDMResponse("Трактирщик предлагает карту.\n[GOLD_OFFER: -5, Карта к цитадели]");
  assert.deepEqual(parsed.goldOffer, { amount: -5, reason: "Карта к цитадели" });
  assert.equal(parsed.narrative, "Трактирщик предлагает карту.");
  assert.equal(canSettleGold(10, -5), true);
  assert.equal(canSettleGold(4, -5), false);
  assert.equal(canSettleGold(10, 5), true);
  assert.equal(canSettleGold(10, 0), false);
  assert.equal(parseDMResponse("[GOLD_OFFER: +5, Gift]\n[GOLD_OFFER: -5, Map]").goldOffer, null);
  assert.deepEqual(parseDMResponse("[ITEM: 5 золотых монет]\n[ITEM: Gold Ring]").newItems, ["Gold Ring"]);
});


test("a failed social check retains a prepared clue without showing it in the scene", () => {
  const action: ChatMessage = { role: "user", content: "Ask the innkeeper about the patrol." };
  const scene = reply(
    "The innkeeper watches you.\n[ROLL: Charisma, DC=12, SOCIAL]\n"
    + "[CLUE_FALLBACK: Inspect the delivery ledger | The patrol changes at dusk.]",
  );
  const check = scene.parsed?.rollRequest;
  assert.ok(check?.social);
  assert.equal(scene.parsed?.narrative, "The innkeeper watches you.");
  const request = { ...check, mod: 0 };
  assert.deepEqual(getSocialFailure(request, false, false, [action, scene]), {
    action: action.content,
    clueFallback: { lead: "Inspect the delivery ledger", fact: "The patrol changes at dusk." },
  });
  assert.equal(getSocialFailure(request, true, false, [action, scene]), undefined);
  assert.equal(getSocialFailure(request, false, true, [action, scene]), undefined);
});

test("marked intimidation and older charisma rolls work without a prepared clue", () => {
  const intimidation = parseDMResponse("[ROLL: Strength, DC=14, SOCIAL]").rollRequest;
  assert.ok(intimidation?.social);
  assert.deepEqual(getSocialFailure({ ...intimidation, mod: 3 }, false, false, []), {
    action: undefined, clueFallback: undefined,
  });
  assert.ok(getSocialFailure({ stat: "cha", mod: 0 }, false, false, []));
  assert.equal(getSocialFailure({ stat: "dex", mod: 0 }, false, false, []), undefined);
});

test("an improvised clue is parsed separately from narrative and optional actions", () => {
  const parsed = parseDMResponse(
    "You check the records.\n[CLUE_FOUND: The patrol changes at dusk.]\n1. Head for the gate.",
  );
  assert.equal(parsed.discoveredClue, "The patrol changes at dusk.");
  assert.equal(parsed.narrative, "You check the records.");
  assert.equal(parsed.choices[0].text, "Head for the gate.");
  assert.equal(parseDMResponse("[CLUE_FOUND:  ]").discoveredClue, "");
});

test("story checks are bound to a specific choice and the skill supplies the ability", () => {
  const scene = parseDMResponse(
    "1. Отправиться ко входу. [NO_CHECK]\n"
    + "2. Расспросить трактирщика о дороге. [NO_CHECK]\n"
    + "3. Обыскать посты в поисках тайника. [CHECK: Perception, DC=12]\n"
    + "4. Попытаться вывести ветерана на разговор. [CHECK: Persuasion, DC=14]",
  );
  assert.deepEqual(scene.choices.map(choice => choice.check), [
    null, null, { skill: "perception", stat: "wis", dc: 12 },
  ]);
  assert.equal(scene.choices[2].text, "Обыскать посты в поисках тайника.");
  assert.equal(scene.rollRequest, null);
  assert.equal(parseDMResponse("[ROLL: Athletics, DC=12]").rollRequest?.stat, "str");
  assert.equal(parseDMResponse("[ROLL: Investigation, DC=12]").rollRequest?.stat, "int");
  assert.equal(parseDMResponse("[ROLL: Insight, DC=12]").rollRequest?.stat, "wis");
  assert.deepEqual(parseDMResponse("[ROLL: Intimidation, DC=13, STRENGTH]").rollRequest, {
    skill: "intimidation", stat: "str", dc: 13, social: true,
  });
  assert.equal(parseDMResponse("[ROLL: imaginary skill, DC=10]").rollRequest, null);
});

test("a price quote withholds premature paid effects and leaves approval available", () => {
  const response = parseDMResponse(
    "Трактирщик сгребает монету и выдаёт тайный вход.\n"
    + "[GOLD_OFFER: -1, Покупка информации у трактирщика]\n"
    + "[ENEMY: Командор Грейвз, HP:22, AC:14, ATK:+4, DMG:d8+2, WIS:+2, MIDBOSS]\n"
    + "[INITIATIVE]\n[ITEM: Карта прохода]\n1. Войти через тайный вход.",
  );
  const quote = "Трактирщик просит 1 зм за сведения.";
  const staged = stagePaidOffer(response, parseDMResponse(quote));
  assert.equal(staged.narrative, quote);
  assert.deepEqual(staged.goldOffer, { amount: -1, reason: "Покупка информации у трактирщика" });
  assert.equal(staged.initiativeTrigger, false);
  assert.deepEqual(staged.newEnemies, []);
  assert.deepEqual(staged.newItems, []);
  assert.deepEqual(staged.choices, []);
});

test("the reported persuasion action keeps its d20 check when the clue tag follows it", () => {
  const parsed = parseDMResponse(
    "2. Убедить стражу, что вы ночной путник. [CHECK: Persuasion, DC=13] "
    + "[CLUE_FALLBACK: Расспросить портового нищего | В трактире есть вход в катакомбы.]",
  );
  const [choice] = parsed.choices;
  assert.equal(choice.text, "Убедить стражу, что вы ночной путник.");
  assert.deepEqual(choice.check, { stat: "cha", skill: "persuasion", dc: 13, social: true });
  assert.equal(choice.clueFallback?.lead, "Расспросить портового нищего");
  assert.equal(parsed.clueFallback, undefined);
  const result = rollAbilityCheck({ ...choice.check, mod: 2 }, sides => {
    assert.equal(sides, 20);
    return 10;
  });
  assert.equal(result.total, 12);
  assert.equal(result.success, false);
});

test("the alternate clue uses a normal existing option without replacing the other choices", () => {
  const parsed = parseDMResponse(
    "1. Отправиться к причалу и расспросить портового нищего. [NO_CHECK]\n"
    + "2. Обыскать заброшенный квартал. [NO_CHECK]\n3. Прорваться силой. [CHECK: Strength, DC=13]",
  );
  const choices = storyChoices(parsed.choices, {
    clueFallback: { lead: "Расспросить портового нищего", fact: "В трактире есть вход." },
  });
  assert.deepEqual(choices.map(choice => choice.text), parsed.choices.map(choice => choice.text));
  assert.deepEqual(choices.map(choice => choice.clueRoute), [true, undefined, undefined]);
  assert.equal(choices[0].check, null);
});

test("drink-potion choices use inventory without treating requests for a potion as consumption", async () => {
  const { isDrinkPotionAction } = await import("../src/game/inventory.ts");
  assert.equal(isDrinkPotionAction("Быстро выпить целебное зелье лечения из инвентаря"), true);
  assert.equal(isDrinkPotionAction("Я выпиваю зелье"), true);
  assert.equal(isDrinkPotionAction("Drink a healing potion"), true);
  assert.equal(isDrinkPotionAction("Я прошу еще 3 зелья у друга стражника"), false);
});
