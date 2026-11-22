// ─────────────────────────────────────────────────────────────────
// DICE HELPERS
// ─────────────────────────────────────────────────────────────────

import type { RollRequest, RollResult } from "./types";

/** Standard D&D proficiency bonus at low levels. */
export const PROFICIENCY_BONUS = 2;

/** Roll a single die with the given number of sides. */
export function rollDice(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export function rollAbilityCheck(request: RollRequest, roll = rollDice): RollResult {
  const dc = request.dc ?? 15;
  const hitRoll = roll(20);
  const total = hitRoll + request.mod;
  return {
    hitRoll, mod: request.mod, prof: 0, total, ac: dc, dc,
    success: total >= dc, crit: false, autoMiss: false, damage: 0,
  };
}

/**
 * Extract the number of sides from a dice notation like "d6", "d20", "1d8".
 * Falls back to 20 when the input does not match.
 */
export function parseDiceSides(s: string): number {
  const m = s.match(/d(\d+)/i);
  return m ? parseInt(m[1]) : 20;
}
