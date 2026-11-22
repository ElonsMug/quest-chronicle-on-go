import assert from "node:assert/strict";
import test from "node:test";
import { ARC_TEMPLATES, createArcFromTemplate, parseArcVariation } from "../src/game/arcs.ts";
import { describeCombatants, findCombatantIndex } from "../src/game/combatReferences.ts";
import { parseDMResponse } from "../src/game/parser.ts";

test("every arc has an English and a Russian fallback", () => {
  for (const template of ARC_TEMPLATES) {
    const en = createArcFromTemplate(template, "en");
    const ru = createArcFromTemplate(template, "ru");
    for (const key of ["goal", "antagonist", "setting", "midBossName"] as const) {
      assert.doesNotMatch(en[key], /\p{Script=Cyrillic}/u);
      assert.doesNotMatch(ru[key], /\p{Script=Latin}/u);
      assert.notEqual(en[key], ru[key]);
    }
    assert.equal(en.templateId, ru.templateId);
  }
});

test("mixed-language arc generation keeps the localized fallback for invalid fields", () => {
  const raw = JSON.stringify({
    goal: "Остановить культ",
    antagonist: "Veliar",
    setting: "Башня Grey Shore",
    midBossName: "Ноктис",
  });
  assert.deepEqual(parseArcVariation(raw, "ru"), {
    goal: "Остановить культ",
    antagonist: undefined,
    setting: undefined,
    midBossName: "Ноктис",
  });
  assert.equal(parseArcVariation(raw, "en")?.antagonist, "Veliar");
  assert.equal(parseArcVariation("{not JSON}", "ru"), null);
});

test("combat tags resolve independently of language and preserve slots after a defeat", () => {
  const enemies = [{ name: "Bandit", hp: 0 }, { name: "Bandit", hp: 9 }];
  const allies = [{ name: "Смотритель", hp: 6 }];
  assert.deepEqual(describeCombatants(enemies, "enemy"), ["enemy-2 = Bandit (HP: 9)"]);
  const reply = parseDMResponse(
    "Бандит отступает.\n[ENEMY_DAMAGE: enemy-2, 4]\n[ENEMY_ATTACK: enemy-2]\n[ALLY_DAMAGE: ally-1, 2]",
  );
  assert.equal(reply.narrative, "Бандит отступает.");
  assert.equal(findCombatantIndex(enemies, "enemy", reply.enemyDamages[0].name), 1);
  assert.equal(findCombatantIndex(enemies, "enemy", reply.enemyAttacks[0]), 1);
  assert.equal(findCombatantIndex(allies, "ally", reply.allyDamages[0].name), 0);
  assert.equal(findCombatantIndex(enemies, "enemy", "enemy-1"), -1);
  assert.equal(findCombatantIndex(enemies, "enemy", "enemy-3"), -1);
  assert.equal(findCombatantIndex(enemies, "enemy", "BANDIT"), 1);
});

test("Russian check names map to the same stats as English names", () => {
  for (const [ru, en, stat] of [
    ["Мудрость", "Wisdom", "wis"],
    ["Телосложение", "Constitution", "con"],
    ["Харизма", "Charisma", "cha"],
  ]) {
    const check = { stat, dc: 12 };
    assert.deepEqual(parseDMResponse(`[ROLL: ${ru}, DC=12]`).rollRequest, check);
    assert.deepEqual(parseDMResponse(`[ROLL: ${en}, DC=12]`).rollRequest, check);
  }
});
