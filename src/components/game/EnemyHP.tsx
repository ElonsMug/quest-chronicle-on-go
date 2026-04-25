// ─────────────────────────────────────────────────────────────────
// EnemyHP — small inline HP bar shown next to enemy name in the header.
// Leaders get a crown marker + slightly different styling so the
// player can tell them apart from minions at a glance.
// ─────────────────────────────────────────────────────────────────

export function EnemyHP({
  name,
  hp,
  maxHp,
  isLeader = false,
}: {
  name: string;
  hp: number;
  maxHp: number;
  isLeader?: boolean;
}) {
  const pct = Math.max(0, Math.round((hp / maxHp) * 100));
  const color = pct > 60 ? "#4ade80" : pct > 30 ? "#fbbf24" : "#f87171";
  const nameClass = isLeader
    ? "text-amber-300 text-xs font-bold truncate max-w-[110px]"
    : "text-stone-400 text-xs truncate max-w-[100px]";
  return (
    <div className="flex items-center gap-2">
      {isLeader && <span className="text-amber-400 text-xs leading-none">👑</span>}
      <span className={nameClass}>{name}</span>
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
