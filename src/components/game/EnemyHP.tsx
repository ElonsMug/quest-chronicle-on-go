// ─────────────────────────────────────────────────────────────────
// EnemyHP — small inline HP bar shown next to enemy name in the header.
// ─────────────────────────────────────────────────────────────────

export function EnemyHP({ name, hp, maxHp }: { name: string; hp: number; maxHp: number }) {
  const pct = Math.max(0, Math.round((hp / maxHp) * 100));
  const color = pct > 60 ? "#4ade80" : pct > 30 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex items-center gap-2">
      <span className="text-stone-400 text-xs truncate max-w-[100px]">{name}</span>
      <div className="flex-1 h-2 rounded-full bg-stone-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-xs font-bold" style={{ color }}>{hp}/{maxHp}</span>
    </div>
  );
}
