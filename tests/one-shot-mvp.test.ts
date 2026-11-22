import assert from "node:assert/strict";
import test from "node:test";
import { buildCharacters } from "../src/game/characters.ts";
import { advanceOneShot, chooseRecipe, oneShotChoices, oneShotPlanSchema, startOneShot } from "../src/game/oneShot.ts";

const action = (label: string) => ({ label, result: "Something changes for the character." });
const check = (label: string, skill: string) => ({ ...action(label), skill, failure: "The failed action leaves a trace." });
const scene = "Two paths lead across the defended gates.";
const plan = oneShotPlanSchema.parse({
  title: "A Saltwater Alibi", goal: "Get a witness out", clue: "The north gate opens at dawn",
  opening: scene, stakes: "The gate will close at noon.",
  approach: { safe: action("Read the schedule"), personal: check("Bluff the clerk", "deception") },
  vendor: { name: "Courier", scene, tip: action("Buy a watch schedule"), potion: action("Buy a potion") },
  obstacle: {
    name: "Gate guard", scene, bypass: action("Take the alley"), risky: check("Scale the wall", "athletics"),
    challenge: "Fight the guard", victory: "The gate guard backs away.",
  },
  rival: {
    name: "Warden", scene, motive: "She protects the depot.", warning: "The guard pointed you out.",
    bypass: action("Go around her"), parley: check("Ask her to stand down", "persuasion"),
    challenge: "Fight the warden", victory: "The warden drops the key.",
    loot: "Charged gate key", advantage: "The warden opens the northern gate.",
  },
  finale: {
    scene, direct: check("Cross the open ground", "acrobatics"), prepared: check("Follow the blind spot", "stealth"),
    fight: { name: "Marshal", label: "Fight the marshal", victory: "The marshal withdraws." },
    retreat: action("Leave the grounds"),
  },
  endings: {
    success: "The witness makes it out.", partial: "The witness is still inside.",
    retreat: "You leave the grounds empty-handed.", defeat: "They drag you from the grounds.",
  },
});
const heroes = buildCharacters(key => key);
const high = (sides: number) => sides;
const low = () => 1;

test("each playable class can finish through the free route after a failed social check", () => {
  for (const hero of heroes) {
    const start = startOneShot(hero);
    const failed = advanceOneShot(start, "personal", plan, hero, low)!;
    assert.deepEqual(failed.events[0], {
      kind: "check", skill: "deception", die: 1, modifier: hero.stats.cha,
      total: 1 + hero.stats.cha, dc: 11, success: false,
    });
    assert.equal(failed.state.witnessed, true);
    assert.equal(failed.state.gold, hero.startGold);
    assert.equal(advanceOneShot(failed.state, "personal", plan, hero, low), null);
    let state = failed.state;
    for (const id of ["safe", "bypass", "bypass"]) {
      state = advanceOneShot(state, id, plan, hero, low)!.state;
    }
    assert.equal(state.clue, true);
    assert.equal(oneShotChoices(state, plan, hero).find(choice => choice.id === "direct")?.dc, 14);
    assert.equal(advanceOneShot(state, "direct", plan, hero, high)?.state.ending, "success");
    assert.equal(advanceOneShot(state, "direct", plan, hero, low)?.state.ending, "partial");
  }
});

test("a vendor purchase is explicit and exclusive, and opens a prepared route or supplies a potion", () => {
  for (const hero of heroes) {
    const start = startOneShot(hero);
    assert.equal(oneShotChoices(start, plan, hero).filter(choice => choice.cost === hero.startGold).length, 2);
    const boughtTip = advanceOneShot(start, "tip", plan, hero)!.state;
    assert.equal(boughtTip.gold, 0);
    assert.equal(advanceOneShot(boughtTip, "buyPotion", plan, hero), null);
    const boughtPotion = advanceOneShot(start, "buyPotion", plan, hero)!.state;
    assert.equal(boughtPotion.potions, start.potions + 1);
    assert.equal(boughtPotion.tip, false);
    let state = boughtTip;
    for (const id of ["safe", "bypass", "bypass"]) state = advanceOneShot(state, id, plan, hero)!.state;
    assert.equal(oneShotChoices(state, plan, hero).some(choice => choice.id === "prepared"), true);
  }
});

test("rival combat is optional and grants its loot once on victory, never on withdrawal", () => {
  for (const hero of heroes) {
    let state = startOneShot(hero);
    for (const id of ["safe", "bypass"]) state = advanceOneShot(state, id, plan, hero)!.state;
    assert.equal(state.fight, null);
    assert.equal(advanceOneShot(state, "parley", plan, hero, high)?.state.aid, "deal");
    const entered = advanceOneShot(state, "challenge", plan, hero)!.state;
    const escaped = advanceOneShot(entered, "withdraw", plan, hero)!;
    assert.equal(escaped.state.stage, "finale");
    assert.equal(escaped.state.aid, null);
    const won = advanceOneShot(entered, "strike", plan, hero, high)!;
    assert.equal(won.state.aid, "loot");
    assert.deepEqual(won.events.filter(event => event.kind === "loot"), [{ kind: "loot", name: plan.rival?.loot }]);
    assert.equal(advanceOneShot(won.state, "strike", plan, hero), null);
  }
});

test("ordinary combat cannot lock progress or one-shot a fresh mage", () => {
  const mage = heroes[2];
  let state = advanceOneShot(startOneShot(mage), "safe", plan, mage)!.state;
  state = advanceOneShot(state, "challenge", plan, mage)!.state;
  const rolls = [1, 20, 2, 1, 20, 2, 1, 20, 2];
  const badRoll = () => rolls.shift()!;
  for (let round = 0; round < 3; round++) state = advanceOneShot(state, "strike", plan, mage, badRoll)!.state;
  assert.equal(state.hp, 2);
  assert.equal(state.fight, null);
  assert.equal(state.stage, "rival");
});

test("a plan without a vendor, rival, or final combat still resolves for all heroes", () => {
  const peaceful = oneShotPlanSchema.parse({ ...plan, vendor: null, rival: null, finale: { ...plan.finale, fight: null } });
  for (const hero of heroes) {
    let state = startOneShot(hero);
    for (const id of ["safe", "bypass", "direct"]) state = advanceOneShot(state, id, peaceful, hero, high)!.state;
    assert.equal(state.ending, "success");
    assert.deepEqual(oneShotChoices(state, peaceful, hero), []);
  }
});

test("recipes vary the mission across consecutive starts and reject structurally invalid options", () => {
  const recent: string[] = [];
  for (let run = 0; run < 4; run++) recent.push(chooseRecipe(recent, () => 0).mission);
  assert.equal(new Set(recent).size, 4);
  const duplicate = { ...plan, approach: { ...plan.approach, personal: { ...plan.approach.personal, label: plan.approach.safe.label } } };
  assert.equal(oneShotPlanSchema.safeParse(duplicate).success, false);
});

test("the one-shot offers each hero's combat tools and tracks their cost", () => {
  const enterFight = (hero: (typeof heroes)[number]) => {
    const prepared = advanceOneShot(startOneShot(hero), "safe", plan, hero)!.state;
    return advanceOneShot(prepared, "challenge", plan, hero)!.state;
  };
  const [warrior, rogue, mage] = heroes;
  const enraged = advanceOneShot(enterFight(warrior), "berserk", plan, warrior, low)!.state;
  assert.equal(enraged.fight?.berserkRound, 1);
  assert.equal(advanceOneShot(enraged, "berserk", plan, warrior), null);

  const dodged = advanceOneShot(enterFight(rogue), "dodge", plan, rogue, low)!.state;
  assert.equal(dodged.fight?.dodged, true);
  assert.equal(oneShotChoices(dodged, plan, rogue).some(choice => choice.id === "sneak"), true);

  const asleep = advanceOneShot(enterFight(mage), "sleep", plan, mage, high)!;
  assert.equal(asleep.state.spellSlots, 2);
  assert.equal(asleep.state.stage, "rival");
  assert.equal(asleep.state.fight, null);
  assert.deepEqual(asleep.events, [{ kind: "asleep" }]);
});
