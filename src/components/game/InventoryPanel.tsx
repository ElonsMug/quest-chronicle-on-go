// ─────────────────────────────────────────────────────────────────
// InventoryPanel — bottom-sheet modal with items, effects and rest options.
// ─────────────────────────────────────────────────────────────────

import { useTranslation } from "react-i18next";
import { isPotion } from "@/game/inventory";

type Props = {
  inventory: string[];
  effects: string[];
  onUseItem: (item: string, idx: number) => void;
  onShortRest: () => void;
  onLongRest: () => void;
  inCombat: boolean;
  canUsePotion: boolean;
  onClose: () => void;
};

export function InventoryPanel({
  inventory, effects, onUseItem, onShortRest, onLongRest, inCombat, canUsePotion, onClose,
}: Props) {
  const { t } = useTranslation();
  const restTitle = inCombat ? t("inventory.noRestInCombat") : "";
  const potionDisabledTitle = inCombat && !canUsePotion ? t("inventory.potionInCombatHint") : "";
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-stone-900 border border-stone-700 rounded-t-3xl p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-amber-400 font-bold" style={{ fontFamily: "serif" }}>
            🎒 {t("inventory.title")}
          </div>
          <button onClick={onClose} className="text-stone-500 text-xl leading-none">✕</button>
        </div>
        {inventory.length === 0 ? (
          <div className="text-stone-600 text-sm text-center py-4">{t("inventory.empty")}</div>
        ) : (
          <div className="space-y-2">
            {inventory.map((item, i) => {
              const usable = isPotion(item);
              return (
                <div key={i} className="flex items-center justify-between bg-stone-800 rounded-xl px-4 py-3">
                  <span className="text-amber-100 text-sm">{item}</span>
                  {usable && (
                    <button
                      onClick={() => onUseItem(item, i)}
                      disabled={inCombat && !canUsePotion}
                      title={potionDisabledTitle}
                      className="text-xs px-3 py-1 rounded-lg font-bold text-stone-900 ml-2 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: inCombat && !canUsePotion ? "#57534e" : "linear-gradient(135deg,#d97706,#92400e)",
                      }}
                    >
                      {t("common.use")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {effects.length > 0 && (
          <div className="mt-4 pt-4 border-t border-stone-800">
            <div className="text-stone-500 text-xs uppercase tracking-widest mb-2">
              {t("inventory.activeEffects")}
            </div>
            {effects.map((e, i) => (
              <div key={i} className="text-amber-300 text-sm bg-stone-800 rounded-lg px-3 py-2 mb-1">
                {e}
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-stone-800">
          <div className="text-stone-500 text-xs uppercase tracking-widest mb-2">{t("inventory.rest")}</div>
          <div className="space-y-2">
            <button
              onClick={onShortRest}
              disabled={inCombat}
              title={restTitle}
              className="w-full text-left px-4 py-3 rounded-xl border border-stone-700 bg-stone-800 text-amber-100 text-sm font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed hover:border-amber-700/50"
              style={{ fontFamily: "serif" }}
            >
              ☕ {t("inventory.shortRest")}
              <span className="text-xs font-normal text-stone-500 block mt-0.5">
                {t("inventory.shortRestSubtitle")}
              </span>
            </button>
            <button
              onClick={onLongRest}
              disabled={inCombat}
              title={restTitle}
              className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: inCombat ? "#292524" : "linear-gradient(135deg,#d97706,#92400e)",
                color: inCombat ? "#57534e" : "#0c0a09",
                fontFamily: "serif",
              }}
            >
              🌙 {t("inventory.longRest")}
              <span className="text-xs font-normal opacity-75 block mt-0.5">
                {t("inventory.longRestSubtitle")}
              </span>
            </button>
          </div>
          {inCombat && (
            <div className="text-stone-600 text-xs mt-2 text-center">{t("inventory.noRestInCombat")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
