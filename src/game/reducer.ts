// ─────────────────────────────────────────────────────────────────
// GAME REDUCER
// ─────────────────────────────────────────────────────────────────
// Pure reducer for the game-state slice (see state.ts).
// No React imports, no side effects — safe to unit-test.
// ─────────────────────────────────────────────────────────────────

import type { GameState, GameAction } from "./state";
import { initialGameState } from "./state";

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "START_GAME":
      return {
        ...initialGameState,
        character: action.character,
        hp: action.character.hp,
        inventory: action.startInventory,
        spellSlots: action.character.spellSlots
          ? { ...action.character.spellSlots }
          : null,
        arc: action.arc,
      };

    case "RESET_TO_MENU":
      // Wipe transient combat/session state, keep nothing — UI flips screen separately.
      return { ...initialGameState };

    case "SET_HP":
      return { ...state, hp: action.hp };

    case "SET_INVENTORY":
      return { ...state, inventory: action.inventory };

    case "SET_EFFECTS":
      return { ...state, effects: action.effects };

    case "SET_ENEMIES":
      return { ...state, enemies: action.enemies };

    case "SET_ALLIES":
      return { ...state, allies: action.allies };

    case "SET_MESSAGES":
      return { ...state, messages: action.messages };

    case "SET_SPELL_SLOTS":
      return { ...state, spellSlots: action.slots };

    case "SET_IN_COMBAT":
      return { ...state, inCombat: action.value };

    case "UPDATE_INVENTORY":
      return { ...state, inventory: action.updater(state.inventory) };

    case "UPDATE_EFFECTS":
      return { ...state, effects: action.updater(state.effects) };

    case "UPDATE_ALLIES":
      return { ...state, allies: action.updater(state.allies) };

    case "UPDATE_MESSAGES":
      return { ...state, messages: action.updater(state.messages) };

    case "SET_BERSERK_CHARGES":
      return { ...state, berserkChargesLeft: Math.max(0, action.value) };

    case "DECREMENT_BERSERK_CHARGE":
      return {
        ...state,
        berserkChargesLeft: Math.max(0, state.berserkChargesLeft - 1),
      };

    case "ACTIVATE_BERSERK":
      return {
        ...state,
        berserkChargesLeft: 2,
        berserkUsedThisCombat: true,
        defensiveStance: false,
        didDodgeLastTurn: false,
      };

    case "SET_BERSERK_USED":
      return { ...state, berserkUsedThisCombat: action.value };

    case "SET_DID_DODGE":
      return { ...state, didDodgeLastTurn: action.value };

    case "SET_DEFENSIVE_STANCE":
      return { ...state, defensiveStance: action.value };

    case "RESET_COMBAT_FLAGS":
      return {
        ...state,
        berserkChargesLeft: 0,
        berserkUsedThisCombat: false,
        didDodgeLastTurn: false,
        defensiveStance: false,
      };

    case "RESTORE_SNAPSHOT":
      return {
        ...state,
        hp: action.hp,
        enemies: action.enemies,
        allies: action.allies,
        inCombat: true,
        berserkChargesLeft: 0,
        berserkUsedThisCombat: false,
        didDodgeLastTurn: false,
        defensiveStance: false,
      };

    case "LONG_REST":
      return {
        ...state,
        hp: action.hp,
        spellSlots: action.spellSlots,
        berserkChargesLeft: 0,
        berserkUsedThisCombat: false,
      };

    default:
      // Exhaustiveness check: action is `never` here if all cases are handled.
      return state;
  }
}
