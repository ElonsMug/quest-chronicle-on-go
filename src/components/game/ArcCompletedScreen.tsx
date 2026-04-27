// ─────────────────────────────────────────────────────────────────
// ArcCompletedScreen — full-screen overlay shown when the final boss
// of an arc is defeated. Offers the player to start a fresh arc with
// the same hero, or return to the menu. Mirrors the styling of
// DefeatedScreen for visual consistency.
// ─────────────────────────────────────────────────────────────────

import { useTranslation } from "react-i18next";
import type { Arc } from "@/game/arcs";

type Props = {
  arc: Arc;
  onStartNewArc: () => void;
  onMenu: () => void;
};

export function ArcCompletedScreen({ arc, onStartNewArc, onMenu }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.92)" }}
    >
      <div className="max-w-sm w-full text-center">
        <div className="text-6xl mb-4">🏆</div>
        <div
          className="text-2xl font-bold text-amber-300 mb-2"
          style={{ fontFamily: "serif" }}
        >
          {t("arcCompleted.title")}
        </div>
        <div className="text-stone-400 text-sm mb-2 leading-relaxed">
          {t("arcCompleted.subtitle", { antagonist: arc.antagonist })}
        </div>
        <div className="text-stone-500 text-xs italic mb-6">
          "{arc.goal}"
        </div>
        <div className="space-y-3">
          <button
            onClick={onStartNewArc}
            className="w-full py-3 rounded-xl font-bold text-stone-900 active:scale-95 transition-transform"
            style={{
              background: "linear-gradient(135deg,#d97706,#92400e)",
              fontFamily: "serif",
            }}
          >
            ✨ {t("arcCompleted.newArc")}
          </button>
          <button
            onClick={onMenu}
            className="w-full py-3 rounded-xl border border-stone-800 bg-stone-950 text-stone-500 text-sm"
            style={{ fontFamily: "serif" }}
          >
            ← {t("arcCompleted.returnToMenu")}
          </button>
        </div>
      </div>
    </div>
  );
}
