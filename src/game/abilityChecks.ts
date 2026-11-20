import type { ClueFallback, Stat } from "./types";

export const skillAbilities = {
  acrobatics: "dex", "animal handling": "wis", arcana: "int", athletics: "str",
  deception: "cha", history: "int", insight: "wis", intimidation: "cha",
  investigation: "int", medicine: "wis", nature: "int", perception: "wis",
  performance: "cha", persuasion: "cha", religion: "int", "sleight of hand": "dex",
  stealth: "dex", survival: "wis",
} as const satisfies Record<string, Stat>;

export type Skill = keyof typeof skillAbilities;
export type AbilityCheck = { stat: Stat; dc: number; skill?: Skill; social?: true };
export type StoryChoice = { num: string; text: string; check?: AbilityCheck | null; clueFallback?: ClueFallback; clueRoute?: true };

const abilityNames: Record<string, Stat> = {
  str: "str", strength: "str", сила: "str",
  dex: "dex", dexterity: "dex", ловкость: "dex",
  con: "con", constitution: "con", телосложение: "con",
  int: "int", intelligence: "int", интеллект: "int",
  wis: "wis", wisdom: "wis", мудрость: "wis", мдр: "wis",
  cha: "cha", charisma: "cha", харизма: "cha",
};

const socialSkills = new Set<Skill>(["deception", "intimidation", "performance", "persuasion"]);

export function parseAbilityCheck(kind: string, dc: number, option?: string): AbilityCheck | null {
  if (!Number.isInteger(dc) || dc < 1 || dc > 30) return null;
  const name = kind.trim().toLowerCase();
  const skill = Object.hasOwn(skillAbilities, name) ? name as Skill : undefined;
  const stat = skill ? skillAbilities[skill] : Object.hasOwn(abilityNames, name) ? abilityNames[name] : undefined;
  if (!stat) return null;
  const modifier = option?.trim().toLowerCase();
  const physicalIntimidation = skill === "intimidation" && modifier === "strength";
  const social = skill ? socialSkills.has(skill) : modifier === "social";
  return { stat: physicalIntimidation ? "str" : stat, dc, ...(skill ? { skill } : {}), ...(social ? { social: true } : {}) };
}

export function limitStoryChoices(choices: StoryChoice[]): StoryChoice[] {
  if (!choices.some(choice => choice.check !== undefined)) return choices;
  const freeLimit = choices.some(choice => choice.check) ? 2 : 3;
  const route = choices.find(choice => choice.clueRoute && !choice.check);
  let checkCount = 0;
  let freeCount = route ? 1 : 0;
  return choices.filter(choice => choice === route
    || (choice.check ? checkCount++ === 0 : freeCount++ < freeLimit));
}
