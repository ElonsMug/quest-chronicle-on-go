type Side = "enemy" | "ally";
type Combatant = { name: string; hp: number };

// Encounter lists keep defeated combatants in place until combat ends.
// Slot-based references also work for restored encounters without a migration.
export function combatReference(side: Side, index: number): string {
  return `${side}-${index + 1}`;
}

export function findCombatantIndex(
  combatants: readonly Combatant[],
  side: Side,
  reference: string,
): number {
  const key = reference.trim().toLowerCase();
  const index = combatants.findIndex((_, index) => combatReference(side, index) === key);
  if (index !== -1) return combatants[index].hp > 0 ? index : -1;

  // New arrivals can be named in the same response that declares them.
  // This also accepts commands generated under the old name-based format.
  return combatants.findIndex(combatant =>
    combatant.hp > 0 && combatant.name.trim().toLowerCase() === key
  );
}

export function describeCombatants(combatants: readonly Combatant[], side: Side): string[] {
  return combatants.flatMap((combatant, index) =>
    combatant.hp > 0 ? [`${combatReference(side, index)} = ${combatant.name} (HP: ${combatant.hp})`] : [],
  );
}
