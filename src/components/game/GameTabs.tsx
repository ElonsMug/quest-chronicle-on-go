// ─────────────────────────────────────────────────────────────────
// GameTabs — bottom navigation + Character/Inventory/Journal tab content.
// All user-visible strings come from i18n via useTranslation().
// ─────────────────────────────────────────────────────────────────

import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Character } from "@/game/types";
import type { Arc } from "@/game/arcs";
import { isPotion } from "@/game/inventory";

export type TabKey = "story" | "character" | "inventory" | "journal";
export type InvFilter = "all" | "weapons" | "armor" | "consumables" | "quest";

const NAV_HEIGHT = 56;
const PAD_BOTTOM = 80;

// ── Bottom nav bar ─────────────────────────────────────────────────
export function BottomNav({
  active,
  onChange,
  t,
}: {
  active: TabKey;
  onChange: (k: TabKey) => void;
  t: TFunction;
}) {
  const items: { key: TabKey; icon: string; label: string }[] = [
    { key: "story", icon: "📖", label: t("nav.story") },
    { key: "character", icon: "⚔️", label: t("nav.character") },
    { key: "inventory", icon: "🎒", label: t("nav.inventory") },
    { key: "journal", icon: "📜", label: t("nav.journal") },
  ];
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-20 flex items-stretch"
      style={{ background: "#111010", borderTop: "1px solid #292524", height: NAV_HEIGHT }}
    >
      {items.map((it) => {
        const isActive = active === it.key;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors active:scale-95"
            style={{ color: isActive ? "#d97706" : "#57534e" }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>{it.icon}</span>
            <span
              style={{
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontFamily: "sans-serif",
              }}
            >
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Item categorization ────────────────────────────────────────────
function categorize(item: string): InvFilter {
  if (isPotion(item)) return "consumables";
  if (/sword|dagger|staff|bow|axe|blade|меч|кинжал|посох|лук|топор/i.test(item)) return "weapons";
  if (/armor|shield|helm|cloak|mail|кольчуга|броня|щит|шлем|плащ/i.test(item)) return "armor";
  return "quest";
}

function categoryStyle(c: InvFilter, t: TFunction) {
  switch (c) {
    case "consumables":
      return { icon: "🧪", bg: "#1a2e1a", label: t("inventory.categoryPotion") };
    case "weapons":
      return { icon: "⚔️", bg: "#3b1f1f", label: t("inventory.categoryWeapon") };
    case "armor":
      return { icon: "🛡️", bg: "#1a2540", label: t("inventory.categoryArmor") };
    default:
      return { icon: "📜", bg: "#2a2218", label: t("inventory.categoryQuest") };
  }
}

// ── Character tab ──────────────────────────────────────────────────
export function CharacterTab({
  character,
  hp,
  spellSlots,
  effects,
}: {
  character: Character;
  hp: number;
  spellSlots: { current: number; max: number } | null;
  effects: string[];
}) {
  const { t } = useTranslation();
  const pct = (hp / character.maxHp) * 100;
  const hpColor = pct > 50 ? "#4ade80" : pct > 25 ? "#fbbf24" : "#f87171";
  const cardCls = "rounded-2xl p-4";
  const cardStyle = { background: "#1c1917", border: "1px solid #292524" };

  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      style={{ paddingBottom: PAD_BOTTOM }}
    >
      <div className={cardCls} style={cardStyle}>
        <div className="flex items-center gap-3">
          <div style={{ fontSize: 48, lineHeight: 1 }}>{character.emoji}</div>
          <div>
            <div className="text-amber-100 font-bold" style={{ fontSize: 18, fontFamily: "serif" }}>
              {character.name}
            </div>
            <div className="text-stone-400" style={{ fontSize: 12, fontFamily: "sans-serif" }}>
              {character.subtitle}
            </div>
          </div>
        </div>
      </div>

      <div className={cardCls} style={cardStyle}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-stone-400 text-xs uppercase tracking-widest" style={{ fontFamily: "sans-serif" }}>
            {t("stats.hp")}
          </span>
          <span className="font-bold" style={{ color: hpColor, fontFamily: "serif" }}>
            {hp}/{character.maxHp}
          </span>
        </div>
        <div className="h-3 rounded-full overflow-hidden" style={{ background: "#292524" }}>
          <div
            className="h-full transition-all"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: hpColor }}
          />
        </div>
      </div>

      <div className={cardCls} style={cardStyle}>
        <div className="text-stone-400 text-xs uppercase tracking-widest mb-3" style={{ fontFamily: "sans-serif" }}>
          {t("character.stats")}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["str", "dex", "int"] as const).map((k) => {
            const v = character.stats[k];
            return (
              <div key={k} className="text-center rounded-lg py-2" style={{ background: "#0c0a09" }}>
                <div className="text-stone-500 text-[10px] uppercase tracking-widest" style={{ fontFamily: "sans-serif" }}>
                  {t(`stats.${k}`)}
                </div>
                <div className="text-amber-400 font-bold text-xl" style={{ fontFamily: "serif" }}>
                  {v >= 0 ? `+${v}` : v}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={cardCls} style={cardStyle}>
        <div className="text-stone-400 text-xs uppercase tracking-widest mb-1" style={{ fontFamily: "sans-serif" }}>
          {t("character.weapon")}
        </div>
        <div className="text-amber-100 font-bold" style={{ fontFamily: "serif" }}>
          {character.weapon.name}
        </div>
        <div className="text-stone-500 text-xs mt-0.5">
          {character.weapon.dice} · {t(`stats.${character.weapon.stat}`)}
        </div>
      </div>

      <div className={cardCls} style={cardStyle}>
        <div className="text-stone-400 text-xs uppercase tracking-widest mb-1" style={{ fontFamily: "sans-serif" }}>
          {t("character.ability")}
        </div>
        <div className="text-amber-100 font-bold" style={{ fontFamily: "serif" }}>
          {character.ability}
        </div>
        <div className="text-stone-500 text-xs mt-1 leading-relaxed">{character.abilityDesc}</div>
      </div>

      {character.id === "mage" && spellSlots && (
        <div className={cardCls} style={cardStyle}>
          <div className="text-stone-400 text-xs uppercase tracking-widest mb-2" style={{ fontFamily: "sans-serif" }}>
            {t("spells.title")}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-blue-400 text-xl tracking-widest" style={{ fontFamily: "serif" }}>
              {Array.from({ length: spellSlots.max }, (_, i) =>
                i < spellSlots.current ? "✦" : "◇",
              ).join("")}
            </div>
            <div className="text-stone-400 text-sm">
              {spellSlots.current}/{spellSlots.max}
            </div>
          </div>
        </div>
      )}

      <div className={cardCls} style={cardStyle}>
        <div className="text-stone-400 text-xs uppercase tracking-widest mb-2" style={{ fontFamily: "sans-serif" }}>
          {t("character.effects")}
        </div>
        {effects.length === 0 ? (
          <div className="text-stone-500 text-sm">{t("character.noEffects")}</div>
        ) : (
          <div className="space-y-1">
            {effects.map((e, i) => (
              <div key={i} className="text-amber-300 text-sm rounded-lg px-3 py-2" style={{ background: "#0c0a09" }}>
                {e}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inventory tab ──────────────────────────────────────────────────
export function InventoryTab({
  inventory,
  effects,
  gold,
  inCombat,
  canUsePotion,
  filter,
  onFilterChange,
  onUseItem,
  onShortRest,
  onLongRest,
}: {
  inventory: string[];
  effects: string[];
  gold: number;
  inCombat: boolean;
  canUsePotion: boolean;
  filter: InvFilter;
  onFilterChange: (f: InvFilter) => void;
  onUseItem: (item: string, idx: number) => void;
  onShortRest: () => void;
  onLongRest: () => void;
}) {
  const { t } = useTranslation();
  const filters: { key: InvFilter; label: string }[] = [
    { key: "all", label: t("inventory.filterAll") },
    { key: "weapons", label: t("inventory.filterWeapons") },
    { key: "armor", label: t("inventory.filterArmor") },
    { key: "consumables", label: t("inventory.filterConsumables") },
    { key: "quest", label: t("inventory.filterQuest") },
  ];
  const items = inventory
    .map((it, idx) => ({ it, idx, cat: categorize(it) }))
    .filter((x) => filter === "all" || x.cat === filter);

  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      style={{ paddingBottom: PAD_BOTTOM }}
    >
      {/* Wallet */}
      <div className="rounded-2xl p-3" style={{ background: "#1c1917", border: "1px solid #fbbf24" }}>
        <div className="text-stone-400 text-xs uppercase tracking-widest mb-1" style={{ fontFamily: "sans-serif" }}>
          {t("inventory.wallet")}
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 26 }}>🪙</span>
          <span className="text-amber-300 font-bold text-xl" style={{ fontFamily: "serif" }}>
            {gold} {t("inventory.gold")}
          </span>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {filters.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors"
              style={{
                background: active ? "#d97706" : "#1c1917",
                color: active ? "#0c0a09" : "#57534e",
                border: active ? "none" : "1px solid #292524",
                fontFamily: "sans-serif",
                letterSpacing: "0.05em",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <div className="text-stone-500 text-sm text-center py-6">{t("inventory.empty")}</div>
      ) : (
        <div className="space-y-2">
          {items.map(({ it, idx, cat }) => {
            const cs = categoryStyle(cat, t);
            const usable = cat === "consumables";
            const disabled = inCombat && !canUsePotion;
            return (
              <div
                key={idx}
                className="rounded-xl flex items-center gap-3 p-2.5"
                style={{ background: "#1c1917", border: "1px solid #292524" }}
              >
                <div
                  className="flex-shrink-0 rounded-lg flex items-center justify-center"
                  style={{ width: 36, height: 36, background: cs.bg, fontSize: 18 }}
                >
                  {cs.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-amber-100 font-bold text-sm truncate" style={{ fontFamily: "serif" }}>
                    {it}
                  </div>
                  <div className="text-stone-500" style={{ fontSize: 11, fontFamily: "sans-serif" }}>
                    {cs.label}
                  </div>
                </div>
                {usable && (
                  <button
                    onClick={() => onUseItem(it, idx)}
                    disabled={disabled}
                    className="text-xs px-3 py-1.5 rounded-lg font-bold text-stone-900 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: disabled ? "#57534e" : "linear-gradient(135deg,#d97706,#92400e)",
                      fontFamily: "serif",
                    }}
                  >
                    {t("inventory.usePotion")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Active effects */}
      {effects.length > 0 && (
        <div className="pt-2">
          <div className="text-stone-400 text-xs uppercase tracking-widest mb-2" style={{ fontFamily: "sans-serif" }}>
            {t("inventory.activeEffects")}
          </div>
          <div className="space-y-1">
            {effects.map((e, i) => (
              <div key={i} className="text-amber-300 text-sm rounded-lg px-3 py-2" style={{ background: "#1c1917", border: "1px solid #292524" }}>
                {e}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rest */}
      <div className="pt-2 space-y-2">
        <div className="text-stone-400 text-xs uppercase tracking-widest mb-1" style={{ fontFamily: "sans-serif" }}>
          {t("inventory.rest")}
        </div>
        <button
          onClick={onShortRest}
          disabled={inCombat}
          className="w-full text-left px-4 py-3 rounded-xl text-amber-100 text-sm font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "#1c1917", border: "1px solid #292524", fontFamily: "serif" }}
        >
          ☕ {t("inventory.shortRest")}
          <span className="block text-xs font-normal text-stone-500 mt-0.5">
            {t("inventory.shortRestSubtitle")}
          </span>
        </button>
        <button
          onClick={onLongRest}
          disabled={inCombat}
          className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: inCombat ? "#292524" : "linear-gradient(135deg,#d97706,#92400e)",
            color: inCombat ? "#57534e" : "#0c0a09",
            fontFamily: "serif",
          }}
        >
          🌙 {t("inventory.longRest")}
          <span className="block text-xs font-normal opacity-75 mt-0.5">
            {t("inventory.longRestSubtitle")}
          </span>
        </button>
        {inCombat && (
          <div className="text-stone-500 text-xs text-center">{t("inventory.noRestInCombat")}</div>
        )}
      </div>
    </div>
  );
}

// ── Journal tab ────────────────────────────────────────────────────
export function JournalTab({ arc }: { arc: Arc | null }) {
  const { t } = useTranslation();

  if (!arc) {
    return (
      <div
        className="flex-1 overflow-y-auto px-4 py-12 flex items-center justify-center"
        style={{ paddingBottom: PAD_BOTTOM }}
      >
        <div className="text-stone-500 text-center" style={{ fontFamily: "serif" }}>
          {t("journal.noArc")}
        </div>
      </div>
    );
  }

  const phases: { n: 1 | 2 | 3 | 4 | 5; label: string; suffix?: string }[] = [
    { n: 1, label: t("journal.phase1") },
    { n: 2, label: t("journal.phase2") },
    { n: 3, label: t("journal.phase3"), suffix: arc.midBossName },
    { n: 4, label: t("journal.phase4") },
    { n: 5, label: t("journal.phase5"), suffix: arc.antagonist },
  ];
  const cardStyle = { background: "#1c1917", border: "1px solid #292524" };

  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      style={{ paddingBottom: PAD_BOTTOM }}
    >
      <div className="rounded-2xl p-4" style={cardStyle}>
        <div
          className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest mb-2"
          style={{ background: "#451a03", color: "#fbbf24", fontFamily: "sans-serif" }}
        >
          {t("journal.currentArc")}
        </div>
        <div className="text-amber-100 font-bold leading-snug" style={{ fontSize: 15, fontFamily: "serif" }}>
          {arc.goal}
        </div>
        <div className="text-stone-500 mt-1" style={{ fontSize: 12, fontFamily: "sans-serif" }}>
          {arc.setting}
        </div>
      </div>

      <div className="rounded-2xl p-4" style={cardStyle}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-stone-400 text-xs uppercase tracking-widest" style={{ fontFamily: "sans-serif" }}>
            {t("journal.arcProgress")}
          </span>
          <span className="text-amber-400 text-xs font-bold" style={{ fontFamily: "serif" }}>
            {arc.phase} / 5
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#292524" }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${(arc.phase / 5) * 100}%`,
              background: "linear-gradient(90deg,#d97706,#b45309)",
            }}
          />
        </div>
      </div>

      <div className="rounded-2xl p-4" style={cardStyle}>
        <div className="text-stone-400 text-xs uppercase tracking-widest mb-3" style={{ fontFamily: "sans-serif" }}>
          {t("journal.heroPath")}
        </div>
        <div className="space-y-2">
          {phases.map((p) => {
            const done = p.n < arc.phase;
            const active = p.n === arc.phase;
            const dotStyle = done
              ? { background: "#d97706", color: "#0c0a09", border: "none" }
              : active
                ? { background: "transparent", color: "#d97706", border: "2px solid #d97706" }
                : { background: "#1c1917", color: "#57534e", border: "1px solid #292524" };
            const labelColor = done ? "#d97706" : active ? "#fbbf24" : "#57534e";
            return (
              <div key={p.n} className="flex items-center gap-2">
                <div
                  className="flex-shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={{ width: 20, height: 20, ...dotStyle }}
                >
                  {done ? "✓" : p.n}
                </div>
                <div className="flex-1 text-sm" style={{ color: labelColor, fontFamily: "serif" }}>
                  {p.label}
                  {p.suffix ? ` — ${p.suffix}` : ""}
                </div>
                {done && (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest"
                    style={{ background: "#14532d", color: "#4ade80", fontFamily: "sans-serif" }}
                  >
                    {t("journal.phaseDone")}
                  </span>
                )}
                {active && (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest"
                    style={{ background: "#451a03", color: "#fbbf24", fontFamily: "sans-serif" }}
                  >
                    {t("journal.phaseNow")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl p-4" style={{ background: "#1c1917", border: "1px solid #7f1d1d" }}>
        <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "#7f1d1d", fontFamily: "sans-serif" }}>
          {t("journal.villain")}
        </div>
        <div className="font-bold mt-1" style={{ color: "#fca5a5", fontSize: 14, fontFamily: "serif" }}>
          {arc.antagonist}
        </div>
      </div>
    </div>
  );
}
