// ─────────────────────────────────────────────────────────────────
// RollBlock — interactive d20 roll for attacks and skill checks.
// Shows breakdown (d20 + mod + prof vs AC/DC) and reports the result.
// ─────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { rollDice, parseDiceSides, PROFICIENCY_BONUS } from "@/game/dice";
import type { RollRequest, RollResult } from "@/game/types";

type Props = {
  type: "attack" | "roll";
  request: RollRequest;
  onResult: (r: RollResult) => void;
};

export function RollBlock({ type, request, onResult }: Props) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const [res, setRes] = useState<RollResult | null>(null);

  function execute() {
    if (done) return;
    const mod = request.mod || 0;

    if (type === "attack") {
      const ac = request.ac ?? 10;
      const hitRoll = rollDice(20);
      const proficiencyBonus = PROFICIENCY_BONUS;
      const total = hitRoll + mod + proficiencyBonus;
      const crit = hitRoll === 20;
      const autoMiss = hitRoll === 1;
      const hit = !autoMiss && (crit || total >= ac);

      let damage = 0;
      if (hit) {
        const dmgDice = parseDiceSides(request.dice || "d6");
        damage = crit
          ? rollDice(dmgDice) + rollDice(dmgDice) + mod
          : rollDice(dmgDice) + mod;
      }

      setRes({
        hitRoll, mod, prof: proficiencyBonus, total,
        ac, dc: ac, success: hit, crit, autoMiss, damage,
      });
    } else {
      const dc = request.dc ?? 15;
      const hitRoll = rollDice(20);
      const total = hitRoll + mod;
      const success = total >= dc;
      setRes({
        hitRoll, mod, prof: 0, total,
        ac: dc, dc, success, crit: false, autoMiss: false, damage: 0,
      });
    }
  }

  function confirm() {
    if (res) {
      setDone(true);
      onResult(res);
    }
  }

  const diceLabel = type === "attack" ? `${request.weapon} (${request.dice})` : `${request.stat} d20`;
  const modLabel = (request.mod || 0) >= 0 ? `+${request.mod || 0}` : `${request.mod}`;
  const targetLabel = type === "attack" ? `AC${request.ac ?? 10}` : `DC${request.dc ?? 15}`;

  if (done && res) {
    let summary: string;
    if (type === "attack") {
      if (res.autoMiss) {
        summary = `d20(1) ✦ ${t("combat.autoMiss")}`;
      } else if (res.crit) {
        summary = `d20(20) ✦ ${t("combat.crit")} → ${t("combat.damage")}: ${res.damage}`;
      } else if (res.success) {
        summary = `d20(${res.hitRoll}) + mod(${res.mod}) + prof(${res.prof}) = ${res.total} vs AC${res.ac} → ✦ ${t("combat.hit")} → ${t("combat.damage")}: ${res.damage}`;
      } else {
        summary = `d20(${res.hitRoll}) + mod(${res.mod}) + prof(${res.prof}) = ${res.total} vs AC${res.ac} → ✦ ${t("combat.miss")}`;
      }
    } else {
      summary = `🎲 ${diceLabel}: ${res.hitRoll}${res.mod !== 0 ? ` ${modLabel}` : ""} = ${res.total} vs DC${res.dc} → ${res.success ? `✦ ${t("combat.success")}` : `✦ ${t("combat.fail")}`}`;
    }
    return (
      <div className="rounded-xl border border-stone-800 bg-stone-950/80 px-4 py-2 text-xs text-stone-500">
        {type === "attack" ? "⚔️ " : ""}{summary}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-900/40 bg-stone-950/80 px-4 py-3 my-2">
      <div className="text-amber-600 text-xs uppercase tracking-widest mb-2">
        {type === "attack" ? `⚔️ ${t("combat.attackLabel")}` : `🎲 ${t("combat.rollLabel")}`}: {diceLabel} {modLabel} vs {targetLabel}
      </div>
      {!res ? (
        <button
          onClick={execute}
          className="w-full py-2.5 rounded-lg text-sm font-bold text-stone-900 active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}
        >
          🎲 {t("combat.rollDie")}
        </button>
      ) : (
        <div>
          {type === "attack" ? (
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span
                className="bg-stone-800 rounded-lg px-3 py-1 text-lg font-bold"
                style={{
                  fontFamily: "serif",
                  color: res.crit ? "#fbbf24" : res.autoMiss ? "#ef4444" : res.success ? "#4ade80" : "#f87171",
                }}
              >
                {res.hitRoll}
              </span>
              {!res.crit && !res.autoMiss && (
                <>
                  <span className="text-stone-500 text-sm">+{res.mod}</span>
                  <span className="text-stone-500 text-sm">+{res.prof}</span>
                  <span className="text-stone-600">=</span>
                  <span className="text-amber-200 font-bold text-lg" style={{ fontFamily: "serif" }}>
                    {res.total}
                  </span>
                  <span className="text-stone-600 text-sm">vs AC{res.ac}</span>
                </>
              )}
              <span
                className={`font-bold text-sm ${
                  res.crit ? "text-amber-300"
                    : res.autoMiss ? "text-red-400"
                    : res.success ? "text-green-400" : "text-red-400"
                }`}
              >
                {res.crit
                  ? `✦ ${t("combat.crit")}`
                  : res.autoMiss
                  ? `✦ ${t("combat.autoMiss")}`
                  : res.success
                  ? `✦ ${t("combat.hit")}`
                  : `✦ ${t("combat.miss")}`}
              </span>
              {res.success && (
                <span className="text-amber-200 text-sm">
                  → {t("combat.damage")}: <b>{res.damage}</b>
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span
                className="bg-stone-800 rounded-lg px-3 py-1 text-lg font-bold"
                style={{ fontFamily: "serif", color: res.success ? "#4ade80" : "#f87171" }}
              >
                {res.hitRoll}
              </span>
              {res.mod !== 0 && (
                <>
                  <span className="text-stone-500 text-sm">{res.mod > 0 ? "+" : ""}{res.mod}</span>
                  <span className="text-stone-600">=</span>
                </>
              )}
              <span className="text-amber-200 font-bold text-lg" style={{ fontFamily: "serif" }}>
                {res.total}
              </span>
              <span className="text-stone-600 text-sm">vs DC{res.dc}</span>
              <span className={`font-bold text-sm ${res.success ? "text-green-400" : "text-red-400"}`}>
                {res.success ? `✦ ${t("combat.success")}` : `✦ ${t("combat.fail")}`}
              </span>
            </div>
          )}
          <button
            onClick={confirm}
            className="w-full py-2 rounded-lg text-xs font-bold bg-stone-700 hover:bg-stone-600 text-amber-100 transition-colors"
          >
            {t("common.ok")}
          </button>
        </div>
      )}
    </div>
  );
}
