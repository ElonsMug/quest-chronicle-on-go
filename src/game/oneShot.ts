import { z } from "zod";
import { skillAbilities, type Skill } from "./abilityChecks.ts";
import { parseDiceSides, PROFICIENCY_BONUS, rollAbilityCheck, rollDice } from "./dice.ts";
import type { Character } from "./types.ts";

const line = z.string().trim().min(3).max(160);
const prose = z.string().trim().min(12).max(550);
const modifier = z.enum(Object.keys(skillAbilities) as [Skill, ...Skill[]]);
const action = z.object({ label: line, result: prose });
const check = action.extend({ skill: modifier, failure: prose });
const foe = z.object({ name: line, victory: prose });
const rival = foe.extend({
  scene: prose,
  motive: prose,
  warning: prose,
  bypass: action,
  parley: check,
  challenge: line,
  loot: line,
  advantage: prose,
});
const vendor = z.object({
  name: line,
  scene: prose,
  tip: action,
  potion: action,
});

export const oneShotPlanSchema = z.object({
  title: line,
  goal: line,
  opening: prose,
  stakes: prose,
  clue: line,
  approach: z.object({ safe: action, personal: check }),
  vendor: vendor.nullable(),
  obstacle: foe.extend({ scene: prose, bypass: action, risky: check, challenge: line }),
  rival: rival.nullable(),
  finale: z.object({
    scene: prose,
    direct: check,
    prepared: check,
    fight: foe.extend({ label: line }).nullable(),
    retreat: action,
  }),
  endings: z.object({ success: prose, partial: prose, retreat: prose, defeat: prose }),
}).superRefine((plan, ctx) => {
  const distinct = (path: string[], labels: string[]) => {
    const normalized = labels.map(label => label.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: "Provide distinct options" });
    }
  };
  distinct(["approach"], [
    plan.approach.safe.label, plan.approach.personal.label,
    ...(plan.vendor ? [plan.vendor.tip.label, plan.vendor.potion.label] : []),
  ]);
  distinct(["obstacle"], [plan.obstacle.bypass.label, plan.obstacle.risky.label, plan.obstacle.challenge]);
  if (plan.rival) distinct(["rival"], [plan.rival.bypass.label, plan.rival.parley.label, plan.rival.challenge]);
  distinct(["finale"], [
    plan.finale.direct.label, plan.finale.prepared.label, plan.finale.retreat.label,
    ...(plan.finale.fight ? [plan.finale.fight.label] : []),
  ]);
});

export type OneShotPlan = z.infer<typeof oneShotPlanSchema>;
const missions = [
  ["heist", "recover an object from a guarded location; extract it in the finale"],
  ["rescue", "get a person to safety; the finale is an escape or pursuit"],
  ["expose", "prove a deception; the finale is about convincing a witness or a public decision"],
  ["prevent", "stop an imminent event; the finale is about interrupting, repairing or redirecting something"],
  ["broker", "get two sides to accept a concrete settlement before their dispute escalates"],
] as const;
const settings = ["isolated coastal settlement", "traveling fair", "remote mountain outpost", "canal district", "borderlands sanctuary", "river crossing"];
const pressures = ["weather is closing the route", "a handover is imminent", "an approaching rival has its own agenda", "workers are about to seal the site", "witnesses are preparing to leave"];
export type Recipe = {
  id: string;
  mission: typeof missions[number][0];
  structure: string;
  setting: string;
  pressure: string;
};

export function chooseRecipe(recent: readonly string[], random = Math.random): Recipe {
  const available = missions.filter(([id]) => !recent.includes(id));
  const pool = available.length ? available : missions;
  const [mission, structure] = pool[Math.floor(random() * pool.length)];
  return {
    id: globalThis.crypto.randomUUID(),
    mission, structure,
    setting: settings[Math.floor(random() * settings.length)],
    pressure: pressures[Math.floor(random() * pressures.length)],
  };
}

type Stage = "approach" | "obstacle" | "rival" | "finale";
type FightStage = Exclude<Stage, "approach">;
type Ending = keyof OneShotPlan["endings"];
type Fight = { stage: FightStage; hp: number; round: number; dodged?: boolean; berserkRound?: number };
export type OneShotState = {
  stage: Stage;
  hp: number;
  gold: number;
  potions: number;
  spellSlots: number;
  clue: boolean;
  attempted: boolean;
  bought: boolean;
  tip: boolean;
  prepared: boolean;
  witnessed: boolean;
  aid: "deal" | "loot" | null;
  fight: Fight | null;
  ending: Ending | null;
};
type ActionId =
  | "safe" | "personal" | "tip" | "buyPotion"
  | "bypass" | "risky" | "challenge" | "parley"
  | "direct" | "prepared" | "retreat" | "strike" | "potion" | "withdraw"
  | "dodge" | "sneak" | "berserk" | "fireBolt" | "shield" | "sleep";
export type OneShotChoice = { id: ActionId; label: string; skill?: Skill; dc?: number; cost?: number };
export type OneShotEvent =
  | { kind: "story"; text: string }
  | { kind: "check"; skill: Skill; die: number; modifier: number; total: number; dc: number; success: boolean }
  | { kind: "attack"; enemy: boolean; die: number; total: number; ac: number; damage: number }
  | { kind: "healing"; amount: number }
  | { kind: "loot"; name: string }
  | { kind: "forcedExit" | "asleep" | "resistedSleep" };

export function startOneShot(hero: Character): OneShotState {
  return {
    stage: "approach", hp: hero.maxHp, gold: hero.startGold, potions: 1, spellSlots: hero.spellSlots?.current ?? 0,
    clue: false, attempted: false, bought: false, tip: false, prepared: false, witnessed: false,
    aid: null, fight: null, ending: null,
  };
}

const hasPreparation = (state: OneShotState) => state.prepared || state.tip || state.aid !== null;

export function oneShotChoices(state: OneShotState, plan: OneShotPlan, hero: Character): OneShotChoice[] {
  if (state.ending) return [];
  const potion: OneShotChoice[] = state.potions && state.hp < hero.maxHp ? [{ id: "potion", label: "" }] : [];
  if (state.fight) {
    const choices: OneShotChoice[] = [{ id: "strike", label: "" }];
    if (hero.classAbility?.type === "sneak") {
      choices.push({ id: "dodge", label: "" });
      if (state.fight.dodged) choices.push({ id: "sneak", label: hero.classAbility.name });
    }
    if (hero.classAbility?.type === "berserk" && !state.fight.berserkRound) {
      choices.push({ id: "berserk", label: hero.classAbility.name });
    }
    for (const spell of hero.spells ?? []) {
      if (state.spellSlots >= spell.cost) choices.push({ id: spell.id, label: spell.name });
    }
    return [...choices, ...potion, { id: "withdraw", label: "" }];
  }

  switch (state.stage) {
    case "approach": {
      const { safe, personal } = plan.approach;
      return [
        { id: "safe", label: safe.label },
        ...(!state.attempted ? [{ id: "personal" as const, label: personal.label, skill: personal.skill, dc: 11 }] : []),
        ...(plan.vendor && !state.bought && state.gold >= hero.startGold ? [
          { id: "tip" as const, label: plan.vendor.tip.label, cost: hero.startGold },
          { id: "buyPotion" as const, label: plan.vendor.potion.label, cost: hero.startGold },
        ] : []),
      ];
    }
    case "obstacle":
      return [
        { id: "bypass", label: plan.obstacle.bypass.label },
        { id: "risky", label: plan.obstacle.risky.label, skill: plan.obstacle.risky.skill, dc: state.witnessed ? 13 : 12 },
        { id: "challenge", label: plan.obstacle.challenge },
        ...potion,
      ];
    case "rival":
      if (!plan.rival) return [];
      return [
        { id: "bypass", label: plan.rival.bypass.label },
        { id: "parley", label: plan.rival.parley.label, skill: plan.rival.parley.skill, dc: 12 },
        { id: "challenge", label: plan.rival.challenge },
        ...potion,
      ];
    case "finale":
      return [
        { id: "direct", label: plan.finale.direct.label, skill: plan.finale.direct.skill, dc: state.witnessed ? 14 : 13 },
        ...(hasPreparation(state) ? [{ id: "prepared" as const, label: plan.finale.prepared.label, skill: plan.finale.prepared.skill, dc: state.witnessed ? 11 : 10 }] : []),
        ...(plan.finale.fight ? [{ id: "challenge" as const, label: plan.finale.fight.label }] : []),
        { id: "retreat", label: plan.finale.retreat.label },
        ...potion,
      ];
  }
}

export function oneShotScene(state: OneShotState, plan: OneShotPlan): string {
  if (state.ending) return plan.endings[state.ending];
  if (state.stage === "approach") return [plan.opening, plan.vendor?.scene].filter(Boolean).join("\n\n");
  if (state.stage === "obstacle") return plan.obstacle.scene;
  if (state.stage === "rival" && plan.rival) {
    return state.witnessed ? `${plan.rival.scene} ${plan.rival.warning}` : plan.rival.scene;
  }
  return plan.finale.scene;
}

const combat = {
  obstacle: { hp: 5, ac: 11, attack: 2, damage: 2 },
  rival: { hp: 8, ac: 12, attack: 3, damage: 3 },
  finale: { hp: 10, ac: 12, attack: 3, damage: 3 },
};
export function oneShotFoe(state: OneShotState, plan: OneShotPlan): string | undefined {
  switch (state.fight?.stage) {
    case "obstacle": return plan.obstacle.name;
    case "rival": return plan.rival?.name;
    case "finale": return plan.finale.fight?.name;
  }
}

export function advanceOneShot(
  state: OneShotState, id: string, plan: OneShotPlan, hero: Character, roll = rollDice,
): { state: OneShotState; events: OneShotEvent[] } | null {
  const choice = oneShotChoices(state, plan, hero).find(item => item.id === id);
  if (!choice) return null;
  const next = { ...state };
  const events: OneShotEvent[] = [];
  const story = (text: string) => events.push({ kind: "story", text });
  const checkResult = (option: z.infer<typeof check>) => {
    const skill = choice.skill ?? option.skill;
    const modifier = hero.stats[skillAbilities[skill]];
    const { hitRoll: die, total, dc, success } = rollAbilityCheck({ mod: modifier, dc: choice.dc }, roll);
    events.push({ kind: "check", skill, die, modifier, total, dc, success });
    story(success ? option.result : option.failure);
    return success;
  };
  const proceed = (stage: Stage) => {
    next.stage = stage;
    next.fight = null;
  };
  const afterObstacle = () => proceed(plan.rival ? "rival" : "finale");
  const collectClue = () => {
    next.clue = true;
    proceed("obstacle");
  };
  const leaveFight = (stage: FightStage) => {
    if (stage === "finale") {
      next.fight = null;
      next.ending = "partial";
    } else if (stage === "rival") {
      story(plan.rival!.bypass.result);
      proceed("finale");
    } else {
      next.witnessed = true;
      story(plan.obstacle.bypass.result);
      afterObstacle();
    }
  };
  const heal = () => {
    const amount = Math.min(5, hero.maxHp - state.hp);
    next.hp += amount;
    next.potions -= 1;
    events.push({ kind: "healing", amount });
  };

  if (state.fight) {
    const { stage, round } = state.fight;
    const opponent = combat[stage];
    let enemyHp = state.fight.hp;
    if (id === "withdraw") {
      leaveFight(stage);
      return { state: next, events };
    }
    const spell = hero.spells?.find(spell => spell.id === id);
    if (spell) next.spellSlots -= spell.cost;
    const berserkRound = id === "berserk" ? round : state.fight.berserkRound;
    const berserk = berserkRound !== undefined && round - berserkRound < 2;
    if (id === "potion") heal();
    else if (id === "sleep") {
      const pool = roll(8) + roll(8) + roll(8) + roll(8) + roll(8);
      if (pool >= enemyHp) {
        events.push({ kind: "asleep" });
        if (stage === "finale") {
          next.fight = null;
          next.ending = "success";
        } else if (stage === "rival") proceed("finale");
        else afterObstacle();
        return { state: next, events };
      }
      events.push({ kind: "resistedSleep" });
    } else if (id !== "dodge" && id !== "shield") {
      const die = roll(20);
      const modifier = hero.stats[spell?.stat ?? hero.weapon.stat];
      const total = die + modifier + PROFICIENCY_BONUS;
      const hit = die === 20 || (die !== 1 && total >= opponent.ac);
      const sides = parseDiceSides(spell?.dice ?? hero.weapon.dice);
      const lootBonus = stage === "finale" && state.aid === "loot" ? 3 : 0;
      const damage = hit ? Math.max(1, roll(sides) + (die === 20 ? roll(sides) : 0)
        + (spell ? 0 : modifier) + (berserk ? 2 : 0) + (id === "sneak" ? roll(6) : 0) + lootBonus) : 0;
      events.push({ kind: "attack", enemy: false, die, total, ac: opponent.ac, damage });
      enemyHp -= damage;
    }
    if (enemyHp <= 0) {
      next.fight = null;
      if (stage === "obstacle") {
        story(plan.obstacle.victory);
        afterObstacle();
      } else if (stage === "rival") {
        const rival = plan.rival!;
        story(rival.victory);
        next.aid = "loot";
        events.push({ kind: "loot", name: rival.loot });
        proceed("finale");
      } else {
        story(plan.finale.fight!.victory);
        next.ending = "success";
      }
    } else {
      const incoming = roll(20);
      const die = id === "dodge" ? Math.min(incoming, roll(20)) : incoming;
      const ac = hero.ac - (berserk ? 2 : 0) + (id === "shield" ? 5 : 0);
      const total = die + opponent.attack;
      const hit = die === 20 || (die !== 1 && total >= ac);
      const damage = hit ? roll(opponent.damage) : 0;
      events.push({ kind: "attack", enemy: true, die, total, ac, damage });
      next.hp = Math.max(0, next.hp - damage);
      if (!next.hp) {
        next.fight = null;
        next.ending = "defeat";
      } else if (round >= 3) {
        events.push({ kind: "forcedExit" });
        leaveFight(stage);
      } else {
        next.fight = { stage, hp: enemyHp, round: round + 1, dodged: id === "dodge", berserkRound };
      }
    }
    return { state: next, events };
  }

  if (id === "potion") {
    heal();
    return { state: next, events };
  }

  switch (state.stage) {
    case "approach":
      if (id === "safe") {
        story(plan.approach.safe.result);
        collectClue();
      } else if (id === "personal") {
        next.attempted = true;
        if (checkResult(plan.approach.personal)) {
          next.prepared = true;
          collectClue();
        } else next.witnessed = true;
      } else {
        const vendor = plan.vendor!;
        next.gold -= hero.startGold;
        next.bought = true;
        if (id === "tip") {
          next.tip = true;
          story(vendor.tip.result);
        } else {
          next.potions += 1;
          story(vendor.potion.result);
        }
      }
      break;
    case "obstacle":
      if (id === "challenge") {
        next.fight = { stage: "obstacle", hp: combat.obstacle.hp, round: 1 };
      } else {
        if (id === "bypass") story(plan.obstacle.bypass.result);
        else if (checkResult(plan.obstacle.risky)) next.prepared = true;
        else next.witnessed = true;
        afterObstacle();
      }
      break;
    case "rival": {
      const rival = plan.rival!;
      if (id === "challenge") {
        next.fight = { stage: "rival", hp: combat.rival.hp, round: 1 };
      } else {
        if (id === "bypass") story(rival.bypass.result);
        else if (checkResult(rival.parley)) {
          next.aid = "deal";
          story(rival.advantage);
        }
        proceed("finale");
      }
      break;
    }
    case "finale":
      if (id === "challenge") {
        const edge = state.aid === "deal" || state.tip ? 3 : 0;
        next.fight = { stage: "finale", hp: combat.finale.hp - edge, round: 1 };
      } else if (id === "retreat") {
        story(plan.finale.retreat.result);
        next.ending = "retreat";
      } else {
        const option = id === "prepared" ? plan.finale.prepared : plan.finale.direct;
        next.ending = checkResult(option) ? "success" : "partial";
      }
      break;
  }

  return { state: next, events };
}
