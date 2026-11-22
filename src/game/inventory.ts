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

// Direct requests use the same inventory action as the potion button.
export function isDrinkPotionAction(action: string): boolean {
  return /^(?:(?:я|быстро|немедленно|сразу)\s+)*(?:выпить|выпиваю|выпью|пью|drink|i drink|quickly drink)\s+[^.!?]*?(?:potion|зель[ея])/iu
    .test(action.trim());
}
