// ─────────────────────────────────────────────────────────────────
// GAME STATE & ACTIONS
// ─────────────────────────────────────────────────────────────────
// Single source of truth for the *gameplay* state — the slice that
// is read by async DM callbacks and mutated from many places.
//
// UI-only flags (panels, dialogs, free-input toggle, defeat overlay,
// pending-roll prompt, target picker, etc.) intentionally stay as
// local `useState` in SoloDnD.tsx. They are independent, transient
// and do not need to participate in reducer transitions.
// ─────────────────────────────────────────────────────────────────

import type { Character, Enemy, Ally, ChatMessage } from "./types";
import type { Arc, ArcPhase } from "./arcs";

export type SpellSlots = { current: number; max: number };

export type GameState = {
  character: Character | null;
  hp: number;
  inventory: string[];
  effects: string[];
  enemies: Enemy[];
  allies: Ally[];
  inCombat: boolean;
  spellSlots: SpellSlots | null;
  berserkChargesLeft: number;
  berserkUsedThisCombat: boolean;
  didDodgeLastTurn: boolean;
  defensiveStance: boolean;
  messages: ChatMessage[];
  // Narrative arc — the current adventure's structure and progress.
  // Null until START_GAME provides one (so old menu screens stay safe).
  arc: Arc | null;
};

export const initialGameState: GameState = {
  character: null,
  hp: 0,
  inventory: [],
  effects: [],
  enemies: [],
  allies: [],
  inCombat: false,
  spellSlots: null,
  berserkChargesLeft: 0,
  berserkUsedThisCombat: false,
  didDodgeLastTurn: false,
  defensiveStance: false,
  messages: [],
  arc: null,
};

// ─────────────────────────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────────────────────────
// Action names describe *what happened* (events), not *how to mutate*
// (setters). Helpers that need a custom transformation use UPDATE_*
// with a callback for cases the reducer cannot express declaratively.
// ─────────────────────────────────────────────────────────────────

export type GameAction =
  // Lifecycle
  | {
      type: "START_GAME";
      character: Character;
      startInventory: string[];
      arc: Arc;
    }
  | { type: "RESET_TO_MENU" }

  // Direct setters (used when an external function already computed the value)
  | { type: "SET_HP"; hp: number }
  | { type: "SET_INVENTORY"; inventory: string[] }
  | { type: "SET_EFFECTS"; effects: string[] }
  | { type: "SET_ENEMIES"; enemies: Enemy[] }
  | { type: "SET_ALLIES"; allies: Ally[] }
  | { type: "SET_MESSAGES"; messages: ChatMessage[] }
  | { type: "SET_SPELL_SLOTS"; slots: SpellSlots | null }
  | { type: "SET_IN_COMBAT"; value: boolean }

  // Updaters that take the previous value (cover the prev => next patterns)
  | { type: "UPDATE_INVENTORY"; updater: (prev: string[]) => string[] }
  | { type: "UPDATE_EFFECTS"; updater: (prev: string[]) => string[] }
  | { type: "UPDATE_ALLIES"; updater: (prev: Ally[]) => Ally[] }
  | { type: "UPDATE_MESSAGES"; updater: (prev: ChatMessage[]) => ChatMessage[] }

  // Combat-specific
  | { type: "SET_BERSERK_CHARGES"; value: number }
  | { type: "DECREMENT_BERSERK_CHARGE" }
  | { type: "ACTIVATE_BERSERK" } // sets charges=2, used=true, defensive=false, didDodge=false
  | { type: "SET_BERSERK_USED"; value: boolean }
  | { type: "SET_DID_DODGE"; value: boolean }
  | { type: "SET_DEFENSIVE_STANCE"; value: boolean }

  // Composite resets
  | { type: "RESET_COMBAT_FLAGS" } // berserk*, didDodge, defensive — used at combat end
  | { type: "RESTORE_SNAPSHOT"; hp: number; enemies: Enemy[]; allies: Ally[] }
  | { type: "LONG_REST"; hp: number; spellSlots: SpellSlots | null }

  // ── Arc progression ───────────────────────────────────────────
  // Replaces the entire arc snapshot. The reducer is dumb on purpose:
  // the next-arc value is computed by computeNextArc() in arcs.ts and
  // passed in. Phase-flag mutations (midBossDefeated, bossDefeated) go
  // through MARK_MIDBOSS_DEFEATED / MARK_BOSS_DEFEATED so callers don't
  // have to clone the arc by hand.
  | { type: "SET_ARC"; arc: Arc }
  | { type: "MARK_MIDBOSS_DEFEATED" }
  | { type: "MARK_BOSS_DEFEATED" };

// Re-export ArcPhase for convenience of consumers importing from state.
export type { ArcPhase };
