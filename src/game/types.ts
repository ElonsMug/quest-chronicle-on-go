// ─────────────────────────────────────────────────────────────────
// GAME TYPES
// ─────────────────────────────────────────────────────────────────
// Pure data types shared across the game engine, parser and UI.
// No React, no i18n, no side-effects. Safe to import anywhere.
// ─────────────────────────────────────────────────────────────────

import type { parseDMResponse } from "./parser";

export type Stat = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type SpellType = "attack" | "defense" | "control";
export type SpellId = "fireBolt" | "shield" | "sleep";
export type CharacterId = "warrior" | "rogue" | "mage";

export type Spell = {
  id: SpellId;
  name: string;
  cost: number;
  type: SpellType;
  dice?: string;
  stat?: Stat;
  description: string;
};

export type ClassAbility = { name: string; type: "berserk" | "sneak" };

export type Character = {
  id: CharacterId;
  name: string;
  emoji: string;
  subtitle: string;
  hp: number;
  maxHp: number;
  stats: Record<Stat, number>;
  ability: string;
  abilityDesc: string;
  weapon: { name: string; dice: string; stat: Stat };
  color: string;
  backstory: string;
  startItems: string[];
  spellSlots?: { current: number; max: number };
  spellSaveDC?: number;
  spells?: Spell[];
  classAbility?: ClassAbility;
  ac: number;
  armorName: string;
  startGold: number;
};

// Result of parsing one DM response. The shape is inferred from the parser
// implementation so the contract stays in sync automatically.
export type Parsed = ReturnType<typeof parseDMResponse>;

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  parsed?: Parsed;
};

export type Enemy = {
  name: string;
  hp: number;
  maxHp: number;
  ac: number;
  damage: string;
  attackBonus: number;
  wisBonus: number;
  isUndead?: boolean;
  isMidBoss?: boolean;
  // EPIC chapter boss. Bosses are exempt from the anti-oneshot cap so their
  // signature attacks can land for full damage and feel genuinely dangerous.
  isBoss?: boolean;
};

export type EnemyArchetype = {
  name: string;
  hp: number;
  ac: number;
  attackBonus: number;
  damage: string;
  wisBonus: number;
  isUndead?: boolean;
  motive: string;
};

export type Ally = { name: string; hp: number; maxHp: number };

export type RollRequest = {
  stat?: string;
  weapon?: string;
  dice?: string;
  mod: number;
  dc?: number;
  ac?: number;
};

export type PendingRoll = { type: "attack" | "roll"; request: RollRequest };

export type RollResult = {
  hitRoll: number;
  mod: number;
  prof: number;
  total: number;
  ac: number;
  dc: number;
  success: boolean;
  crit: boolean;
  autoMiss: boolean;
  damage: number;
};

export type DevScene = { id: string; label: string; prompt: string };
