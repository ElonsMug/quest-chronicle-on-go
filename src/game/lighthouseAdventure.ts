import { parseDiceSides, PROFICIENCY_BONUS, rollDice } from "./dice.ts";
import type { Character, Stat } from "./types";

type Clue = "keeper" | "orders" | "passage";
type Scene = "harbor" | "gate" | "guard" | "lantern" | "captain" | "ending";
type Outcome = "lit" | "warned" | "lost";

type Hero = Pick<Character, "maxHp" | "stats" | "ac" | "weapon">;

export type LighthouseState = {
  scene: Scene;
  clues: Clue[];
  hp: number;
  enemyHp: number;
  round: number;
  enemyFirst: boolean;
  outcome: Outcome | null;
};

export type LighthouseAction =
  | Clue | "showOrders" | "takePassage" | "rushGuard"
  | "confrontCaptain" | "negotiate" | "repair" | "strike" | "flare";

export type LighthouseEvent = {
  key: string;
  values?: Record<string, string | number>;
};

export const lighthouseEnemies = {
  guard: { name: "guard", hp: 4, ac: 11, dex: 1, attack: 2, damageDie: 4, bonus: 0 },
  captain: { name: "captain", hp: 9, ac: 12, dex: 2, attack: 3, damageDie: 4, bonus: 1 },
} as const;

export function lighthouseEnemy(scene: Scene) {
  return scene === "guard" || scene === "captain" ? lighthouseEnemies[scene] : null;
}

export function startLighthouse(hero: Hero): LighthouseState {
  return { scene: "harbor", clues: [], hp: hero.maxHp, enemyHp: 0, round: 0, enemyFirst: false, outcome: null };
}

export function lighthouseActions(state: LighthouseState): LighthouseAction[] {
  switch (state.scene) {
    case "harbor":
      return (["keeper", "orders", "passage"] as const).filter(clue => !state.clues.includes(clue));
    case "gate":
      return [
        ...(state.clues.includes("orders") ? ["showOrders"] as const : []),
        ...(state.clues.includes("passage") ? ["takePassage"] as const : []),
        "rushGuard",
      ];
    case "lantern":
      return [
        "confrontCaptain",
        ...(state.clues.includes("orders") && state.clues.includes("keeper") ? ["negotiate"] as const : []),
        ...(state.clues.includes("passage") ? ["repair"] as const : []),
        "flare",
      ];
    case "guard":
      return ["strike"];
    case "captain":
      return ["strike", "flare"];
    case "ending":
      return [];
  }
}

type Step = { state: LighthouseState; events: LighthouseEvent[] };
const maxRounds = 3;

export function advanceLighthouse(
  state: LighthouseState,
  action: LighthouseAction,
  hero: Hero,
  roll: (sides: number) => number = rollDice,
): Step | null {
  if (!lighthouseActions(state).includes(action)) return null;
  const events: LighthouseEvent[] = [];
  const next = { ...state };
  const log = (key: string, values?: LighthouseEvent["values"]) => events.push({ key, values });
  const finish = (outcome: Outcome) => {
    next.scene = "ending";
    next.outcome = outcome;
    log(outcome);
  };
  const beginFight = (scene: "guard" | "captain") => {
    const enemy = lighthouseEnemies[scene];
    const player = roll(20) + hero.stats.dex;
    const opponent = roll(20) + enemy.dex;
    next.scene = scene;
    next.hp = state.hp;
    next.enemyHp = enemy.hp;
    next.round = 1;
    next.enemyFirst = opponent > player;
    log(next.enemyFirst ? "enemyInitiative" : "heroInitiative", { player, opponent });
  };
  const check = (stat: Stat, dc: number) => {
    const total = roll(20) + hero.stats[stat];
    log(total >= dc ? "checkPassed" : "checkFailed", { total, dc });
    return total >= dc;
  };

  switch (action) {
    case "keeper":
    case "orders":
    case "passage":
      next.clues = [...state.clues, action];
      log(action);
      if (next.clues.length === 2) next.scene = "gate";
      break;
    case "showOrders":
    case "takePassage":
      next.scene = "lantern";
      log(action);
      break;
    case "rushGuard":
      beginFight("guard");
      break;
    case "confrontCaptain":
      beginFight("captain");
      break;
    case "negotiate":
      log("negotiate");
      finish("lit");
      break;
    case "repair":
      if (check("dex", 11)) finish("lit");
      else beginFight("captain");
      break;
    case "flare":
      finish("warned");
      break;
    case "strike": {
      const enemy = lighthouseEnemy(state.scene);
      if (!enemy) return null;
      const attack = (bonus: number, ac: number, sides: number, modifier: number) => {
        const die = roll(20);
        const hit = die === 20 || (die !== 1 && die + bonus >= ac);
        if (!hit) return { damage: 0, total: die + bonus };
        const damage = roll(sides) + (die === 20 ? roll(sides) : 0) + modifier;
        return { damage: Math.max(1, damage), total: die + bonus };
      };
      const heroAttack = () => {
        const weapon = hero.weapon;
        const modifier = hero.stats[weapon.stat];
        const sides = parseDiceSides(weapon.dice);
        const result = attack(modifier + PROFICIENCY_BONUS, enemy.ac, sides, modifier);
        next.enemyHp = Math.max(0, next.enemyHp - result.damage);
        log(result.damage ? "heroHit" : "heroMiss", result);
      };
      const enemyAttack = () => {
        const result = attack(enemy.attack, hero.ac, enemy.damageDie, enemy.bonus);
        next.hp = Math.max(0, next.hp - result.damage);
        log(result.damage ? "enemyHit" : "enemyMiss", result);
      };
      if (state.enemyFirst) {
        enemyAttack();
        if (next.hp > 0) heroAttack();
      } else {
        heroAttack();
        if (next.enemyHp > 0) enemyAttack();
      }
      if (next.hp === 0) finish("lost");
      else if (next.enemyHp === 0 && state.scene === "captain") finish("lit");
      else if (next.enemyHp === 0 || (state.round === maxRounds && state.scene === "guard")) {
        next.scene = "lantern";
        log(next.enemyHp === 0 ? "guardDefeated" : "guardDisengages");
      } else if (state.round === maxRounds) finish("lost");
      else next.round += 1;
      break;
    }
  }
  return { state: next, events };
}
