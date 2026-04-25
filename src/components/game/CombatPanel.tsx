// ─────────────────────────────────────────────────────────────────
// CombatPanel — fixed grid of class-specific combat buttons:
// Attack | (Berserk/Sneak/Spells) | Defend/Dodge | Free action.
// Mage variant also reveals an inline spell mini-list.
// ─────────────────────────────────────────────────────────────────

import { useTranslation } from "react-i18next";
import type { Character, Spell } from "@/game/types";

type Props = {
  character: Character;
  berserkUsedThisCombat: boolean;
  didDodgeLastTurn: boolean;
  spellSlots: { current: number; max: number } | null;
  showSpellMini: boolean;
  spells: Spell[] | undefined;
  onAttackClick: () => void;
  onSpecial: () => void;
  onDefend: () => void;
  onToggleSpells: () => void;
  onCastSpell: (s: Spell) => void;
  onFreeInput: () => void;
};

export function CombatPanel({
  character, berserkUsedThisCombat, didDodgeLastTurn, spellSlots,
  showSpellMini, spells, onAttackClick, onSpecial, onDefend, onToggleSpells, onCastSpell, onFreeInput,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={onAttackClick}
          className="flex flex-col items-center py-3 rounded-xl text-stone-900 font-bold active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}
        >
          <span className="text-xl">⚔️</span>
          <span className="text-xs mt-0.5">{t("combat.attack")}</span>
        </button>

        {character.id === "warrior" && (
          <button
            onClick={berserkUsedThisCombat ? undefined : onSpecial}
            disabled={berserkUsedThisCombat}
            className="flex flex-col items-center py-3 rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-40"
            style={{
              background: berserkUsedThisCombat ? "#292524" : "linear-gradient(135deg,#dc2626,#7f1d1d)",
              color: berserkUsedThisCombat ? "#57534e" : "#0c0a09",
              fontFamily: "serif",
            }}
          >
            <span className="text-xl">🔥</span>
            <span className="text-xs mt-0.5">{t("combat.berserk")}</span>
          </button>
        )}
        {character.id === "rogue" && (
          <button
            onClick={didDodgeLastTurn ? onSpecial : undefined}
            disabled={!didDodgeLastTurn}
            className="flex flex-col items-center py-3 rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-40"
            style={{
              background: didDodgeLastTurn ? "linear-gradient(135deg,#dc2626,#7f1d1d)" : "#292524",
              color: didDodgeLastTurn ? "#0c0a09" : "#57534e",
              fontFamily: "serif",
            }}
          >
            <span className="text-xl">🎯</span>
            <span className="text-xs mt-0.5">{t("combat.sneak")}</span>
          </button>
        )}
        {character.id === "mage" && spellSlots && (
          <button
            onClick={spellSlots.current > 0 ? onToggleSpells : undefined}
            disabled={spellSlots.current === 0}
            className="flex flex-col items-center py-3 rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-40"
            style={{
              background: spellSlots.current > 0 ? "linear-gradient(135deg,#3b82f6,#1e40af)" : "#292524",
              color: spellSlots.current > 0 ? "#0c0a09" : "#57534e",
              fontFamily: "serif",
            }}
          >
            <span className="text-xl">✦</span>
            <span className="text-xs mt-0.5">{spellSlots.current}/{spellSlots.max}</span>
          </button>
        )}

        <button
          onClick={onDefend}
          className="flex flex-col items-center py-3 rounded-xl border border-stone-700 bg-stone-900 font-bold active:scale-95 transition-transform"
          style={{ color: "#fde68a", fontFamily: "serif" }}
        >
          <span className="text-xl">{character.id === "warrior" ? "🛡" : "💨"}</span>
          <span className="text-xs mt-0.5">
            {character.id === "warrior" ? t("combat.defend") : t("combat.dodge")}
          </span>
        </button>

        <button
          onClick={onFreeInput}
          className="flex flex-col items-center py-3 rounded-xl border border-stone-600 bg-stone-950 font-bold active:scale-95 transition-transform"
          style={{ color: "#78716c", fontFamily: "serif" }}
        >
          <span className="text-xl">✍</span>
          <span className="text-xs mt-0.5">{t("combat.freeAction")}</span>
        </button>
      </div>

      {showSpellMini && spells && spells.map((s, i) => (
        <button
          key={i}
          onClick={() => onCastSpell(s)}
          className="w-full text-left px-3 py-2 rounded-lg bg-stone-900 border border-blue-900/60 hover:border-blue-700 transition-colors"
          style={{ fontFamily: "serif" }}
        >
          <div className="text-amber-100 text-sm font-bold">{s.name}</div>
          <div className="text-stone-500 text-xs">{s.description}</div>
        </button>
      ))}
    </div>
  );
}
