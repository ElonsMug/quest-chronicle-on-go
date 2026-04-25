// ─────────────────────────────────────────────────────────────────
// InitiativeBlock — interactive d20 vs d20 roll at the start of every fight.
// Reports the result (player vs enemy + who acts first) back to the parent.
// ─────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { rollDice } from "@/game/dice";

type Props = {
  dexMod: number;
  onResult: (r: { player: number; enemy: number; playerWins: boolean }) => void;
};

export function InitiativeBlock({ dexMod, onResult }: Props) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const [res, setRes] = useState<{ playerRaw: number; player: number; enemy: number; playerWins: boolean } | null>(null);

  function roll() {
    const playerRaw = rollDice(20);
    const player = playerRaw + dexMod;
    const enemy = rollDice(20);
    const playerWins = player >= enemy;
    setRes({ playerRaw, player, enemy, playerWins });
  }

  function confirm() {
    if (res) {
      setDone(true);
      onResult({ player: res.player, enemy: res.enemy, playerWins: res.playerWins });
    }
  }

  if (done && res) {
    return (
      <div className="rounded-xl border border-stone-800 bg-stone-950/80 px-4 py-2 text-xs text-stone-500">
        ⚡ {t("combat.initiativeFooter", {
          player: res.player,
          enemy: res.enemy,
          result: res.playerWins ? t("combat.initiativeYouFirst") : t("combat.initiativeEnemyFirst"),
        })}
      </div>
    );
  }

  const dexLabel = dexMod >= 0 ? `+${dexMod}` : `${dexMod}`;

  return (
    <div className="rounded-xl border border-amber-900/50 bg-stone-950/80 px-4 py-3 my-2">
      <div className="text-amber-500 text-xs uppercase tracking-widest mb-2">
        ⚡ {t("combat.initiative")} (d20 {dexLabel} {t("stats.dex")})
      </div>
      {!res ? (
        <button
          onClick={roll}
          className="w-full py-2.5 rounded-lg text-sm font-bold text-stone-900 active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}
        >
          🎲 {t("combat.rollInitiative")}
        </button>
      ) : (
        <div>
          <div className="flex justify-around mb-3 text-center">
            <div>
              <div
                className="text-2xl font-bold"
                style={{ fontFamily: "serif", color: res.playerWins ? "#4ade80" : "#f87171" }}
              >
                {res.player}
              </div>
              <div className="text-xs text-stone-500">
                {t("combat.you")} ({res.playerRaw}{dexMod !== 0 ? ` ${dexLabel}` : ""})
              </div>
            </div>
            <div className="text-stone-600 self-center text-lg">{t("combat.vs")}</div>
            <div>
              <div
                className="text-2xl font-bold"
                style={{ fontFamily: "serif", color: !res.playerWins ? "#4ade80" : "#f87171" }}
              >
                {res.enemy}
              </div>
              <div className="text-xs text-stone-500">{t("combat.enemy")}</div>
            </div>
          </div>
          <div className={`text-center text-sm font-bold mb-3 ${res.playerWins ? "text-green-400" : "text-red-400"}`}>
            {res.playerWins ? t("combat.youAreFirst") : t("combat.enemyIsFirst")}
          </div>
          <button
            onClick={confirm}
            className="w-full py-2 rounded-lg text-sm font-bold bg-stone-700 hover:bg-stone-600 text-amber-100 transition-colors"
          >
            {t("common.continue")}
          </button>
        </div>
      )}
    </div>
  );
}
