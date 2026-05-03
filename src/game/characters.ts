// ─────────────────────────────────────────────────────────────────
// CHARACTER FACTORY
// ─────────────────────────────────────────────────────────────────
// Stable IDs are decoupled from display names. All player-visible strings
// (name/subtitle/ability/weapon/items/spells) are pulled from i18n at the
// moment a character is built, so language switches before "Begin as ..."
// pick the right localized labels.
// ─────────────────────────────────────────────────────────────────

import type { Character } from "./types";

export function buildCharacters(t: (k: string) => string): Character[] {
  return [
    {
      id: "warrior",
      name: t("characters.warrior.name"),
      emoji: "⚔️",
      subtitle: t("characters.warrior.subtitle"),
      hp: 14,
      maxHp: 14,
      stats: { str: 3, dex: 1, int: -1 },
      ability: t("characters.warrior.ability"),
      abilityDesc: t("characters.warrior.abilityDesc"),
      weapon: { name: t("characters.warrior.weapon"), dice: "d8", stat: "str" },
      color: "#C0392B",
      backstory: t("characters.warrior.backstory"),
      startItems: [
        t("characters.warrior.items.shortSword"),
        t("characters.warrior.items.leatherArmor"),
        t("characters.warrior.items.healingPotion"),
      ],
      classAbility: { name: t("characters.warrior.ability"), type: "berserk" },
      startGold: 10,
    },
    {
      id: "rogue",
      name: t("characters.rogue.name"),
      emoji: "🗡️",
      subtitle: t("characters.rogue.subtitle"),
      hp: 10,
      maxHp: 10,
      stats: { str: 0, dex: 3, int: 1 },
      ability: t("characters.rogue.ability"),
      abilityDesc: t("characters.rogue.abilityDesc"),
      weapon: { name: t("characters.rogue.weapon"), dice: "d6", stat: "dex" },
      color: "#8E44AD",
      backstory: t("characters.rogue.backstory"),
      startItems: [
        t("characters.rogue.items.dagger"),
        t("characters.rogue.items.lockpicks"),
        t("characters.rogue.items.healingPotion"),
      ],
      classAbility: { name: t("characters.rogue.ability"), type: "sneak" },
    },
    {
      id: "mage",
      name: t("characters.mage.name"),
      emoji: "🔮",
      subtitle: t("characters.mage.subtitle"),
      hp: 8,
      maxHp: 8,
      stats: { str: -1, dex: 0, int: 4 },
      ability: t("characters.mage.ability"),
      abilityDesc: t("characters.mage.abilityDesc"),
      weapon: { name: t("characters.mage.weapon"), dice: "d6", stat: "int" },
      color: "#2980B9",
      backstory: t("characters.mage.backstory"),
      startItems: [
        t("characters.mage.items.staff"),
        t("characters.mage.items.healingPotion"),
        t("characters.mage.items.fireBoltScroll"),
      ],
      spellSlots: { current: 3, max: 3 },
      spellSaveDC: 14,
      spells: [
        {
          id: "fireBolt",
          name: t("characters.mage.spells.fireBolt.name"),
          cost: 1,
          dice: "d10",
          stat: "int",
          type: "attack",
          description: t("characters.mage.spells.fireBolt.description"),
        },
        {
          id: "shield",
          name: t("characters.mage.spells.shield.name"),
          cost: 1,
          type: "defense",
          description: t("characters.mage.spells.shield.description"),
        },
        {
          id: "sleep",
          name: t("characters.mage.spells.sleep.name"),
          cost: 1,
          type: "control",
          description: t("characters.mage.spells.sleep.description"),
        },
      ],
    },
  ];
}
