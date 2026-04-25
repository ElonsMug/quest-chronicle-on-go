// ─────────────────────────────────────────────────────────────────
// INVENTORY HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Heuristic: true if an inventory entry looks like a healing potion in any
 * supported language. Used to decide whether to show the "Use" button.
 */
export function isPotion(item: string): boolean {
  const lc = item.toLowerCase();
  return lc.includes("potion") || lc.includes("зелье") || lc.includes("зелья");
}
