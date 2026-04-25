// ─────────────────────────────────────────────────────────────────
// DefeatedScreen — full-screen overlay when the player drops to 0 HP.
// Offers: drink potion (if any), retry the fight, return to menu, close.
// ─────────────────────────────────────────────────────────────────

import { useTranslation } from "react-i18next";

type Props = {
  hasPotion: boolean;
  onUsePotion: () => void;
  onRetry: () => void;
  onMenu: () => void;
  onClose: () => void;
};

export function DefeatedScreen({ hasPotion, onUsePotion, onRetry, onMenu, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.9)" }}
    >
      <div className="relative max-w-sm w-full mx-4 text-center">
        <button
          onClick={onClose}
          aria-label={t("defeated.closeAria")}
          title={t("defeated.closeTitle")}
          className="absolute -top-2 -right-2 w-9 h-9 rounded-full border border-stone-700 bg-stone-900 text-stone-400 hover:text-amber-200 hover:border-amber-700 transition-colors flex items-center justify-center text-lg"
          style={{ fontFamily: "serif" }}
        >
          ✕
        </button>
        <div className="text-6xl mb-4">💀</div>
        <div className="text-2xl font-bold text-red-400 mb-2" style={{ fontFamily: "serif" }}>
          {t("defeated.title")}
        </div>
        <div className="text-stone-400 text-sm mb-6">{t("defeated.subtitle")}</div>
        <div className="space-y-3">
          {hasPotion && (
            <button
              onClick={onUsePotion}
              className="w-full py-3 rounded-xl font-bold text-stone-900"
              style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}
            >
              🧪 {t("defeated.drinkPotion")}
            </button>
          )}
          <button
            onClick={onRetry}
            className="w-full py-3 rounded-xl border border-stone-600 bg-stone-800 text-amber-100 font-bold"
            style={{ fontFamily: "serif" }}
          >
            ⚔️ {t("defeated.retry")}
          </button>
          <button
            onClick={onMenu}
            className="w-full py-3 rounded-xl border border-stone-700 bg-stone-900 text-stone-400 text-sm"
            style={{ fontFamily: "serif" }}
          >
            ← {t("defeated.returnToMenu")}
          </button>
        </div>
      </div>
    </div>
  );
}
