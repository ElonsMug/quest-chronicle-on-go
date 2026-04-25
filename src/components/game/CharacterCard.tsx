// ─────────────────────────────────────────────────────────────────
// CharacterCard — clickable card on the class-select screen.
// ─────────────────────────────────────────────────────────────────

import { useTranslation } from "react-i18next";
import type { Character } from "@/game/types";

type Props = {
  char: Character;
  selected: boolean;
  onSelect: (c: Character) => void;
};

export function CharacterCard({ char, selected, onSelect }: Props) {
  const { t } = useTranslation();
  return (
    <button
      onClick={() => onSelect(char)}
      className={`relative w-full text-left rounded-2xl p-5 border transition-all duration-300 overflow-hidden ${
        selected
          ? "border-amber-400 shadow-lg shadow-amber-900/40 scale-[1.02]"
          : "border-stone-700 hover:border-stone-500"
      }`}
      style={{ background: "linear-gradient(135deg,#1c1917 0%,#0c0a09 100%)" }}
    >
      {selected && (
        <div
          className="absolute inset-0 opacity-10"
          style={{ background: `radial-gradient(ellipse at center,${char.color} 0%,transparent 70%)` }}
        />
      )}
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">{char.emoji}</span>
          <div>
            <div className="font-bold text-amber-100 text-lg leading-tight" style={{ fontFamily: "serif" }}>
              {char.name}
            </div>
            <div className="text-stone-400 text-xs">{char.subtitle}</div>
          </div>
          {selected && <div className="ml-auto text-amber-400 text-lg">✦</div>}
        </div>
        <p className="text-stone-400 text-xs leading-relaxed mb-3">{char.backstory}</p>
        <div className="flex gap-3 text-xs mb-2">
          {(
            [
              [t("stats.str"), char.stats.str],
              [t("stats.dex"), char.stats.dex],
              [t("stats.int"), char.stats.int],
            ] as const
          ).map(([l, v]) => (
            <span key={l} className="text-stone-500">
              {l} <span className="text-amber-300">{v >= 0 ? "+" : ""}{v}</span>
            </span>
          ))}
          <span className="text-stone-500">
            {t("stats.hp")} <span className="text-red-400">{char.hp}</span>
          </span>
        </div>
        <div className="text-xs" style={{ color: char.color }}>
          ✦ {char.ability}: <span className="text-stone-400">{char.abilityDesc}</span>
        </div>
        <div className="text-xs text-stone-600 mt-1">
          🗡 {char.weapon.name} ({char.weapon.dice})
        </div>
      </div>
    </button>
  );
}
