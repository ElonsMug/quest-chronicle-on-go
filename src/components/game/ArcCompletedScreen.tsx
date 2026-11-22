import { useTranslation } from "react-i18next";
import type { Arc } from "@/game/arcs";

type Props = {
  arc: Arc;
  finds: string[];
  onMenu: () => void;
};

export function ArcCompletedScreen({ arc, finds, onMenu }: Props) {
  const { t } = useTranslation();
  const { ending } = arc;
  const counts = new Map<string, number>();
  for (const item of finds) counts.set(item, (counts.get(item) ?? 0) + 1);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="arc-completed-title"
      className="fixed inset-0 z-[60] overflow-y-auto bg-stone-950/95 px-4 py-8">
      <div className="mx-auto flex min-h-full max-w-lg flex-col justify-center space-y-5">
        <header className="text-center">
          <span aria-hidden="true" className="block text-5xl mb-3">🏆</span>
          <h1 id="arc-completed-title" className="text-3xl font-bold text-amber-200">{t("arcCompleted.title")}</h1>
          <p className="mt-2 text-sm text-stone-400">{arc.goal}</p>
        </header>

        {ending && (
          <p className="whitespace-pre-line leading-relaxed text-amber-50">{ending.epilogue}</p>
        )}

        {(!!ending?.rewardGold || ending?.artifact) && (
          <section aria-label={t("arcCompleted.rewardHeading")}
            className="rounded-xl border border-amber-800/70 bg-amber-950/25 p-5">
            <h2 className="text-sm font-semibold text-amber-300">{t("arcCompleted.rewardHeading")}</h2>
            {!!ending.rewardGold && (
              <p className="mt-1 text-2xl font-bold text-amber-200">{t("arcCompleted.rewardAmount", { gold: ending.rewardGold })}</p>
            )}
            {ending.artifact && (
              <div className="mt-3 border-t border-amber-800/50 pt-3">
                <p className="font-bold text-amber-100">{ending.artifact.name}</p>
                <p className="mt-1 text-sm text-amber-200/80">{t(`arcCompleted.perks.${ending.artifact.perk}`)}</p>
              </div>
            )}
          </section>
        )}

        <section className="space-y-2">
          <h2 className="font-semibold text-amber-100">{t("arcCompleted.finds")}</h2>
          {counts.size ? (
            <ul className="divide-y divide-stone-800 rounded-xl border border-stone-800 text-sm text-stone-300">
              {[...counts].map(([item, count]) => (
                <li key={item} className="flex justify-between gap-4 px-3 py-2">
                  <span>{item}</span>{count > 1 && <span className="text-stone-400">×{count}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-stone-400">{t("arcCompleted.noFinds")}</p>}
          <p className="text-sm text-stone-400">{t("arcCompleted.futureInventory")}</p>
        </section>

        <div className="space-y-2">
          <button type="button" disabled
            className="w-full rounded-xl border border-stone-700 bg-stone-900 py-3 font-semibold text-stone-500">
            {t("arcCompleted.supportLater")}
          </button>
          <button type="button" onClick={onMenu}
            className="w-full rounded-xl bg-amber-600 py-3 font-bold text-stone-950 hover:bg-amber-500">
            {t("arcCompleted.returnToMenu")}
          </button>
        </div>
      </div>
    </div>
  );
}
