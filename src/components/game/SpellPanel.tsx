// ─────────────────────────────────────────────────────────────────
// SpellPanel — bottom-sheet modal listing the mage's spells and slots.
// ─────────────────────────────────────────────────────────────────

import { useTranslation } from "react-i18next";
import type { Character, Spell } from "@/game/types";

type Props = {
  character: Character;
  spellSlots: { current: number; max: number };
  onSpell: (s: Spell) => void;
  onClose: () => void;
};

export function SpellPanel({ character, spellSlots, onSpell, onClose }: Props) {
  const { t } = useTranslation();
  const slots = Array.from({ length: spellSlots.max }, (_, i) => i < spellSlots.current);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-stone-900 border border-stone-700 rounded-t-3xl p-6 pb-10 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-amber-400 font-bold" style={{ fontFamily: "serif" }}>
            ✦ {t("spells.title")}
          </div>
          <button onClick={onClose} className="text-stone-500 text-xl leading-none">✕</button>
        </div>
        <div className="text-center text-2xl mb-4 tracking-widest" style={{ color: "#60a5fa" }}>
          {slots.map((on, i) => (
            <span key={i}>{on ? "✦" : "◇"}</span>
          ))}
          <span className="text-stone-500 text-sm ml-2 align-middle">
            {spellSlots.current}/{spellSlots.max}
          </span>
        </div>
        {character.spells && character.spells.length > 0 && (
          <div>
            <div className="text-stone-500 text-xs uppercase tracking-widest mb-2">
              {t("spells.subhead")}
            </div>
            <div className="space-y-2">
              {character.spells.map((s, i) => {
                const hasSlots = spellSlots.current > 0;
                return (
                  <div key={i} className="bg-stone-800 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-amber-100 text-sm font-bold" style={{ fontFamily: "serif" }}>
                        {s.name}
                      </span>
                      <button
                        onClick={() => hasSlots && onSpell(s)}
                        disabled={!hasSlots}
                        className="text-xs px-3 py-1 rounded-lg font-bold flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          background: hasSlots ? "linear-gradient(135deg,#3b82f6,#1e40af)" : "#292524",
                          color: hasSlots ? "#0c0a09" : "#57534e",
                        }}
                      >
                        {hasSlots ? t("spells.cast") : t("spells.noSlots")}
                      </button>
                    </div>
                    <div className="text-stone-400 text-xs">{s.description}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
