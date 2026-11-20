import assert from "node:assert/strict";
import test from "node:test";
import { buildCharacters } from "../src/game/characters.ts";
import { parseDMResponse } from "../src/game/parser.ts";
import { hasScoutKitBonus, scoutKitBonus, scoutKitName, spendScoutKit, vendorPrice } from "../src/game/vendor.ts";

test("each starting wallet pays for either vendor option, but not both", () => {
  for (const character of buildCharacters(key => key)) {
    assert.ok(character.startGold >= vendorPrice, character.id);
    assert.ok(character.startGold < 2 * vendorPrice, character.id);
  }
});

test("a vendor's offer keeps the paid tip hidden and preserves the free route", () => {
  const parsed = parseDMResponse(
    "Трактирщик знает окрестности.\n[VENDOR: innkeeper | Тропа к берегу проходит за мельницей.]\n"
    + "1. Идти по большой дороге. [NO_CHECK]",
  );
  assert.deepEqual(parsed.vendor, { role: "innkeeper", tip: "Тропа к берегу проходит за мельницей." });
  assert.equal(parsed.narrative, "Трактирщик знает окрестности.");
  assert.equal(parsed.choices[0].text, "Идти по большой дороге.");
});

test("the reserved shop item cannot drop as loot or come from an upgrade", () => {
  for (const language of ["en", "ru"] as const) {
    const kit = scoutKitName(language);
    const parsed = parseDMResponse(`[ITEM: ${kit}]\n[ITEM: Ring of Cinders]\n[UPGRADE: Rope -> ${kit}]\n[ARTIFACT: 3]`);
    assert.deepEqual(parsed.newItems, ["Ring of Cinders"]);
    assert.deepEqual(parsed.upgrades, []);
    assert.equal(parsed.artifactBonus, 3);
  }
});

test("the kit works once on the intended exploration skills", () => {
  const inventory = [scoutKitName("ru"), "Верёвка"];
  for (const skill of ["perception", "investigation", "survival"]) assert.ok(hasScoutKitBonus(inventory, skill));
  assert.equal(hasScoutKitBonus(inventory, "persuasion"), false);
  assert.equal(scoutKitBonus, 2);
  const spent = spendScoutKit(inventory);
  assert.deepEqual(spent, ["Верёвка"]);
  assert.equal(hasScoutKitBonus(spent, "perception"), false);
});
