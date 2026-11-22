import type { Arc } from "./arcs";
import type { Enemy } from "./types";

type Item = "salvagedPotion" | "vanguardSeal";
type Reward = { gold: number; item?: Item };
export type CombatLoot = {
  ordinary: Reward[];
  ordinaryClaimed: number;
  midBoss: Reward;
  midBossClaimed: boolean;
  finalBoss: Reward;
  finalBossClaimed: boolean;
};
export type CombatReward = Reward & { kind: "ordinary" | "midBoss" | "finalBoss"; index: number };
export const midBossArtifactBonus = 3;

const itemNames = {
  salvagedPotion: { en: "Salvaged Healing Potion", ru: "Трофейное зелье лечения" },
  vanguardSeal: { en: "Vanguard Seal", ru: "Печать авангарда" },
};

export function combatLootItemName(item: Item, language: "en" | "ru"): string {
  return itemNames[item][language];
}

export function isCombatLootItem(item: string): boolean {
  const name = item.trim().toLowerCase();
  return Object.values(itemNames).some(names => Object.values(names).some(label => name.startsWith(label.toLowerCase())));
}

export function createCombatLoot(arc: Arc | null): CombatLoot {
  const ordinary: Reward[] = [{ gold: 3 }, { gold: 2, item: "salvagedPotion" }, { gold: 4 }];
  const offset = [...(arc?.templateId ?? "")].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % ordinary.length;
  return {
    ordinary: [...ordinary.slice(offset), ...ordinary.slice(0, offset)],
    ordinaryClaimed: 0,
    midBoss: { gold: 5, item: "vanguardSeal" },
    midBossClaimed: arc?.midBossDefeated === true,
    finalBoss: { gold: 8 },
    finalBossClaimed: arc?.bossDefeated === true,
  };
}

export function readCombatLoot(value: unknown, arc: Arc | null): CombatLoot {
  const fallback = createCombatLoot(arc);
  if (!value || typeof value !== "object") return fallback;
  const saved = value as Partial<CombatLoot>;
  const validReward = (reward: Reward | undefined): reward is Reward =>
    !!reward && Number.isSafeInteger(reward.gold) && reward.gold >= 0
    && (reward.item === undefined || Object.hasOwn(itemNames, reward.item));
  if (!Array.isArray(saved.ordinary) || saved.ordinary.length === 0 || !saved.ordinary.every(validReward)
    || !validReward(saved.midBoss) || !validReward(saved.finalBoss)
    || typeof saved.ordinaryClaimed !== "number" || !Number.isSafeInteger(saved.ordinaryClaimed) || saved.ordinaryClaimed < 0
    || typeof saved.midBossClaimed !== "boolean" || typeof saved.finalBossClaimed !== "boolean") return fallback;
  return saved as CombatLoot;
}

export function plannedCombatReward(loot: CombatLoot, arc: Arc | null, enemies: Enemy[]): CombatReward | null {
  if (!enemies.length) return null;
  if (arc?.phase === 5 && enemies.some(enemy => enemy.isBoss)) {
    return loot.finalBossClaimed ? null : { ...loot.finalBoss, kind: "finalBoss", index: 0 };
  }
  if (arc?.phase === 3 && enemies.some(enemy => enemy.isMidBoss)) {
    return loot.midBossClaimed ? null : { ...loot.midBoss, kind: "midBoss", index: 0 };
  }
  const index = loot.ordinaryClaimed;
  return { ...loot.ordinary[index % loot.ordinary.length], kind: "ordinary", index };
}

export function earnedCombatReward(
  loot: CombatLoot, arc: Arc | null, before: Enemy[], after: Enemy[], playerHp: number,
): CombatReward | null {
  if (playerHp <= 0 || !before.some(enemy => enemy.hp > 0)
    || after.length < before.length || after.some(enemy => enemy.hp > 0)) return null;
  return plannedCombatReward(loot, arc, before);
}

export function claimCombatReward(loot: CombatLoot, reward: CombatReward): CombatLoot {
  if (reward.kind === "midBoss") return loot.midBossClaimed ? loot : { ...loot, midBossClaimed: true };
  if (reward.kind === "finalBoss") return loot.finalBossClaimed ? loot : { ...loot, finalBossClaimed: true };
  return loot.ordinaryClaimed !== reward.index ? loot : { ...loot, ordinaryClaimed: loot.ordinaryClaimed + 1 };
}
