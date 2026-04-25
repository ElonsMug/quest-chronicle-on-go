// ─────────────────────────────────────────────────────────────────
// DICE HELPERS
// ─────────────────────────────────────────────────────────────────

/** Standard D&D proficiency bonus at low levels. */
export const PROFICIENCY_BONUS = 2;

/** Roll a single die with the given number of sides. */
export function rollDice(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Extract the number of sides from a dice notation like "d6", "d20", "1d8".
 * Falls back to 20 when the input does not match.
 */
export function parseDiceSides(s: string): number {
  const m = s.match(/d(\d+)/i);
  return m ? parseInt(m[1]) : 20;
}
