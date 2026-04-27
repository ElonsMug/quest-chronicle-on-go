// ─────────────────────────────────────────────────────────────────
// ArcProgressBar — compact 5-segment phase indicator shown in the
// sticky game header. Segments fill as the player advances through
// the arc; the current phase pulses with the amber accent.
// ─────────────────────────────────────────────────────────────────

import { useTranslation } from "react-i18next";
import type { Arc } from "@/game/arcs";
import { PHASE_LABELS } from "@/game/arcs";

type Props = { arc: Arc };

export function ArcProgressBar({ arc }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "ru" ? "ru" : "en";
  const phaseLabel = lang === "ru" ? PHASE_LABELS[arc.phase] : phaseLabelEn(arc.phase);

  return (
    <div className="px-4 pb-2 pt-1 border-t border-stone-800/40">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] tracking-[0.2em] uppercase text-stone-500 truncate">
          {t("arc.label")} · {phaseLabel}
        </span>
        <span className="text-[10px] text-stone-600 whitespace-nowrap">
          {arc.phase}/5
        </span>
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((p) => {
          const filled = p < arc.phase;
          const current = p === arc.phase;
          return (
            <div
              key={p}
              className="flex-1 h-1 rounded-full overflow-hidden"
              style={{
                background: filled
                  ? "linear-gradient(90deg,#d97706,#92400e)"
                  : current
                    ? "linear-gradient(90deg,#d97706,#3f2c10)"
                    : "#292524",
                boxShadow: current ? "0 0 6px rgba(217,119,6,0.5)" : "none",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function phaseLabelEn(p: 1 | 2 | 3 | 4 | 5): string {
  return ({
    1: "Hook",
    2: "Investigation",
    3: "Mid-boss",
    4: "Preparation",
    5: "Finale",
  } as const)[p];
}
