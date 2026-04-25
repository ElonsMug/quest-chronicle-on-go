// ─────────────────────────────────────────────────────────────────
// DevPanel — hidden debug panel triggered by 5 taps on the header.
// Lets the developer jump straight to a pre-built test scene.
// ─────────────────────────────────────────────────────────────────

import { useTranslation } from "react-i18next";
import type { DevScene } from "@/game/types";

type Props = {
  scenes: DevScene[];
  onJump: (prompt: string) => void;
  onClose: () => void;
};

export function DevPanel({ scenes, onJump, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-stone-900 border border-amber-900/50 rounded-t-3xl p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="text-amber-500 font-bold text-sm" style={{ fontFamily: "serif" }}>
            🛠 {t("dev.title")}
          </div>
          <button onClick={onClose} className="text-stone-500 text-xl leading-none">✕</button>
        </div>
        <div className="text-stone-600 text-xs mb-4">{t("dev.subtitle")}</div>
        <div className="grid grid-cols-2 gap-2">
          {scenes.map((scene) => (
            <button
              key={scene.id}
              onClick={() => { onJump(scene.prompt); onClose(); }}
              className="py-3 px-3 rounded-xl border border-stone-700 bg-stone-800 text-amber-100 text-sm text-left hover:border-amber-700 transition-colors active:scale-95"
            >
              {scene.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
