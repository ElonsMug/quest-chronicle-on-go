import { useState, useRef, useEffect } from "react";
import { initAnalytics, trackEvent } from "@/lib/analytics";

// ─────────────────────────────────────────────────────────────────
// ДАННЫЕ
// ─────────────────────────────────────────────────────────────────
type Stat = "str" | "dex" | "int";
type Character = {
  id: string;
  name: string;
  emoji: string;
  subtitle: string;
  hp: number;
  maxHp: number;
  stats: Record<Stat, number>;
  ability: string;
  abilityDesc: string;
  weapon: { name: string; dice: string; stat: Stat };
  color: string;
  backstory: string;
  startItems: string[];
};

const CHARACTERS: Character[] = [
  {
    id: "warrior", name: "Воин", emoji: "⚔️", subtitle: "Закалённый боец",
    hp: 14, maxHp: 14, stats: { str: 3, dex: 1, int: -1 },
    ability: "Второе дыхание", abilityDesc: "Раз в день: восстановить d6 HP",
    weapon: { name: "Меч", dice: "d8", stat: "str" }, color: "#C0392B",
    backstory: "Бывший наёмник из Серого Берега. Ты видел войны и предательства, но меч не бросил.",
    startItems: ["Короткий меч", "Кожаный доспех", "Зелье лечения (d6+2 HP)"],
  },
  {
    id: "rogue", name: "Плут", emoji: "🗡️", subtitle: "Теневой клинок",
    hp: 10, maxHp: 10, stats: { str: 0, dex: 3, int: 1 },
    ability: "Скрытая атака", abilityDesc: "+d6 урона из засады",
    weapon: { name: "Кинжал", dice: "d6", stat: "dex" }, color: "#8E44AD",
    backstory: "Сирота с городских улиц. Ты вырос в переулках и знаешь каждую тень портового квартала.",
    startItems: ["Кинжал", "Отмычки", "Зелье лечения (d6+2 HP)"],
  },
  {
    id: "mage", name: "Маг", emoji: "🔮", subtitle: "Изгнанник Академии",
    hp: 8, maxHp: 8, stats: { str: -1, dex: 0, int: 4 },
    ability: "Заклинания", abilityDesc: "3 слота в день",
    weapon: { name: "Магический заряд", dice: "d6", stat: "int" }, color: "#2980B9",
    backstory: "Отчисленный студент Академии Серых Магов. Тебе запретили практиковать — ты практикуешь.",
    startItems: ["Посох", "Зелье лечения (d6+2 HP)", "Свиток Огненного Болта"],
  },
];

const DEV_SCENES = [
  { id: "tavern",  label: "🍺 Таверна",         prompt: "Начни сцену: игрок в таверне «Сломанный якорь». Незнакомец предлагает задание. 3 варианта." },
  { id: "combat",  label: "⚔️ Бой",             prompt: "Начни боевую сцену: на игрока нападают 2 бандита в переулке. Используй [ВРАГ: Бандит, HP:8] для каждого. Объяви инициативу [ИНИЦИАТИВА]. Дай варианты: атаковать, уклониться, свой." },
  { id: "social",  label: "🗣️ Допрос NPC",      prompt: "Начни допрос: игрок допрашивает пойманного вора. NPC скрывает что-то важное. 3 варианта." },
  { id: "mystery", label: "🔍 Тайна",           prompt: "Начни сцену: игрок обнаруживает труп в порту. Улики вокруг. 3 варианта." },
  { id: "magic",   label: "✨ Магический ивент", prompt: "Начни сцену: над городом вспыхивает магическая аномалия. 3 варианта реакции." },
  { id: "boss",    label: "💀 Финальный босс",   prompt: "Начни финальную сцену: игрок встречает Архимага Сейдра. Используй [ВРАГ: Архимаг Сейдр, HP:24]. Напряжённый момент. 3 варианта." },
];

// ─────────────────────────────────────────────────────────────────
// СИСТЕМНЫЙ ПРОМПТ
// ─────────────────────────────────────────────────────────────────
function buildSystemPrompt(character: Character, hp: number, inventory: string[], effects: string[]) {
  const inv = inventory.length ? inventory.join(", ") : "пусто";
  const eff = effects.length ? effects.join(", ") : "нет";
  const s = (n: number) => (n >= 0 ? "+" : "") + n;
  return `Ты — Мастер Подземелий в соло текстовой RPG (D&D 5e упрощённая). Один игрок.

ПЕРСОНАЖ:
Класс: ${character.name} | HP: ${hp}/${character.maxHp}
Сила ${s(character.stats.str)} | Ловкость ${s(character.stats.dex)} | Интеллект ${s(character.stats.int)}
Оружие: ${character.weapon.name} (${character.weapon.dice}+${s(character.stats[character.weapon.stat])})
Инвентарь: ${inv} | Эффекты: ${eff}

ФОРМАТ ОТВЕТА:
- 3–5 предложений нарратива от второго лица
- Ровно 3 пронумерованных варианта в конце: "1. ...\n2. ...\n3. ..."
- 4-й вариант НЕ ПИШИ — в UI есть кнопка "Свой вариант"
- ⚠️ КРИТИЧНО: варианты ВСЕГДА в формате чистых номеров без markdown:
    1. Текст варианта
    2. Текст варианта
    3. Текст варианта
  НИКОГДА не используй **1. Текст**, *1. Текст*, бэктики, ### заголовки или
  любое другое форматирование вокруг номеров и текста вариантов. Только чистые
  строки вида "N. Текст" — иначе парсер UI не распознает варианты.

МЕХАНИКА ТЕГОВ (всегда на отдельной строке):
[БРОСОК: Характеристика, DC число] — любая небоевая проверка навыка
[АТАКА: Оружие, кубик_урона, модификатор, AC число] — атака игрока в бою.
   AC = Armor Class врага (НЕ DC!).
   Система САМА бросает d20 + модификатор + proficiency vs AC.
   DM НЕ пишет результат попадания в тексте — система вернёт исход.
   После получения результата DM описывает исход.
   При попадании DM пишет [ВРАГ_УРОН: Имя, число] с уроном, который посчитала система.
   Пример: [АТАКА: Меч, d8, +3, AC13]
[УРОН: число] — урон игроку от врага. ТОЛЬКО числом, без комментариев в нарративе.
   DM НИКОГДА не пишет "Твой HP: X/Y" в тексте — UI показывает HP сам.
[ПРЕДМЕТ: название] — добавить предмет в инвентарь
[ВРАГ: Имя, HP:число] — объявить врага (в начале боя или при появлении нового)
[ВРАГ_УРОН: Имя, число] — нанести урон врагу (система отслеживает HP врагов)
[ИНИЦИАТИВА] — в начале КАЖДОГО боя, система бросит d20 за обе стороны
[КОНЕЦ_БОЯ] — когда все враги повержены

СВОБОДА ДЕЙСТВИЙ (КРИТИЧНО):
- Если игрок выбирает "Свой вариант" и описывает нестандартное действие — ВСЕГДА назначай бросок.
  * Угрожает? → [БРОСОК: Харизма/Запугивание, DC13]
  * Горсть пыли в лицо? → [БРОСОК: Ловкость, DC12], при успехе враг ослеплён 1 раунд
  * Пытается договориться? → [БРОСОК: Убеждение, DC14]
  * Физическое действие? → [БРОСОК: Сила, DC12]
  Никогда не отказывай. Всегда найди механику.

БОЙ:
- ⚠️ КРИТИЧНО: В ПЕРВОМ сообщении любой боевой сцены ты ОБЯЗАН объявить ВСЕХ врагов
  тегами [ВРАГ: Имя, HP:число] — каждый на отдельной строке — ДО любого описания атак,
  ДО нарратива про удары, ДО [ИНИЦИАТИВА]. Без этих тегов система НЕ показывает полоски HP врагов.
  Пример правильного начала боя:
    [ВРАГ: Культист, HP:6]
    [ВРАГ: Культист, HP:6]
    [ВРАГ: Культист, HP:6]
    [ИНИЦИАТИВА]
    (затем нарратив и варианты)
- Если ты забыл объявить врагов в первом сообщении боя — СДЕЛАЙ ЭТО В СЛЕДУЮЩЕМ ЖЕ сообщении,
  до любых других действий и тегов.
- Порядок: сначала [ВРАГ: ...] для всех врагов, затем [ИНИЦИАТИВА], потом чередование ходов
- Если игрок выиграл инициативу — сначала его атака, потом враг
- Если проиграл — враг бьёт первым [УРОН: X], потом варианты игроку
- Показывай HP врага в скобках после имени: "Бандит (HP: 5/8)"
- Когда враг получает урон — обнови его HP тегом [ВРАГ_УРОН: Имя, число]
- Урон от атаки при попадании — посчитай сам исходя из кубика и модификатора, напиши [ВРАГ_УРОН: Имя, урон]
- При промахе — просто опиши промах, не используй [ВРАГ_УРОН]

СЮЖЕТ: тёмный фэнтезийный портовый город "Серый Берег". Краткость — мобильный, метро.`;
}

// ─────────────────────────────────────────────────────────────────
// ПАРСИНГ
// ─────────────────────────────────────────────────────────────────
type Parsed = ReturnType<typeof parseDMResponse>;

function parseDMResponse(text: string) {
  const choices: { num: string; text: string }[] = [];
  const narrativeLines: string[] = [];
  let attackRequest: { weapon: string; dice: string; mod: number; ac: number } | null = null;
  let rollRequest: { stat: string; dc: number } | null = null;
  let damage: number | null = null;
  let newItem: string | null = null;
  const newItems: string[] = [];
  const upgrades: { from: string; to: string }[] = [];
  const newEnemies: { name: string; maxHp: number; hp: number }[] = [];
  const enemyDamages: { name: string; damage: number }[] = [];
  let initiativeTrigger = false;
  let combatEnd = false;

  const TAG = /\[(АТАКА|БРОСОК|УРОН|ПРЕДМЕТ|УЛУЧШЕНИЕ|ВРАГ|ВРАГ_УРОН|ИНИЦИАТИВА|КОНЕЦ_БОЯ)[^\]]*\]/gi;

  const atk = text.match(/\[АТАКА:\s*([^,\]]+),\s*([^,\]]+),\s*([^,\]]+),\s*AC(\d+)\]/i);
  if (atk) attackRequest = { weapon: atk[1].trim(), dice: atk[2].trim(), mod: parseInt(atk[3]) || 0, ac: parseInt(atk[4]) };

  const rol = text.match(/\[БРОСОК:\s*([^,\]]+)(?:,\s*DC(\d+))?\]/i);
  if (rol) rollRequest = { stat: rol[1].trim(), dc: parseInt(rol[2] || "15") };

  const dmg = text.match(/\[УРОН:\s*(\d+)\]/i);
  if (dmg) damage = parseInt(dmg[1]);

  const itemRe = /\[ПРЕДМЕТ:\s*([^\]]+)\]/gi;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(text)) !== null) {
    const name = im[1].trim();
    if (name) {
      newItems.push(name);
      if (newItem === null) newItem = name;
    }
  }

  const upgradeRe = /\[УЛУЧШЕНИЕ:\s*([^\]]+?)\s*->\s*([^\]]+?)\]/gi;
  let um: RegExpExecArray | null;
  while ((um = upgradeRe.exec(text)) !== null) {
    upgrades.push({ from: um[1].trim(), to: um[2].trim() });
  }

  const enemyRe = /\[ВРАГ:\s*([^,\]]+),\s*HP:(\d+)\]/gi;
  let em: RegExpExecArray | null;
  while ((em = enemyRe.exec(text)) !== null) newEnemies.push({ name: em[1].trim(), maxHp: parseInt(em[2]), hp: parseInt(em[2]) });

  const edRe = /\[ВРАГ_УРОН:\s*([^,\]]+),\s*(\d+)\]/gi;
  let ed: RegExpExecArray | null;
  while ((ed = edRe.exec(text)) !== null) enemyDamages.push({ name: ed[1].trim(), damage: parseInt(ed[2]) });

  if (/\[ИНИЦИАТИВА\]/i.test(text)) initiativeTrigger = true;
  if (/\[КОНЕЦ_БОЯ\]/i.test(text)) combatEnd = true;

  for (const line of text.trim().split("\n")) {
    const choiceMatch = line.trim().match(/^\*{0,2}(\d+)\.\s+(.+?)\*{0,2}$/);
    if (choiceMatch) { choices.push({ num: choiceMatch[1], text: choiceMatch[2].trim() }); continue; }
    if (TAG.test(line)) { TAG.lastIndex = 0; continue; }
    TAG.lastIndex = 0;
    narrativeLines.push(line);
  }

  return { narrative: narrativeLines.join("\n").trim(), choices, attackRequest, rollRequest, damage, newItem, newEnemies, enemyDamages, initiativeTrigger, combatEnd };
}

function rollDice(sides: number) { return Math.floor(Math.random() * sides) + 1; }
function parseDiceSides(s: string) { const m = s.match(/d(\d+)/i); return m ? parseInt(m[1]) : 20; }

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  parsed?: Parsed;
};

type Enemy = { name: string; hp: number; maxHp: number };
type RollRequest = { stat?: string; weapon?: string; dice?: string; mod: number; dc?: number; ac?: number };
type PendingRoll = { type: "attack" | "roll"; request: RollRequest };

// ─────────────────────────────────────────────────────────────────
// КОМПОНЕНТЫ
// ─────────────────────────────────────────────────────────────────

function EnemyHP({ name, hp, maxHp }: { name: string; hp: number; maxHp: number }) {
  const pct = Math.max(0, Math.round((hp / maxHp) * 100));
  const color = pct > 60 ? "#4ade80" : pct > 30 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex items-center gap-2">
      <span className="text-stone-400 text-xs truncate max-w-[100px]">{name}</span>
      <div className="flex-1 h-2 rounded-full bg-stone-800 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-bold" style={{ color }}>{hp}/{maxHp}</span>
    </div>
  );
}

function InitiativeBlock({ dexMod, onResult }: { dexMod: number; onResult: (r: { player: number; enemy: number; playerWins: boolean }) => void }) {
  const [done, setDone] = useState(false);
  const [res, setRes] = useState<{ playerRaw: number; player: number; enemy: number; playerWins: boolean } | null>(null);

  function roll() {
    const playerRaw = rollDice(20);
    const player = playerRaw + dexMod;
    const enemy = rollDice(20);
    const playerWins = player >= enemy;
    setRes({ playerRaw, player, enemy, playerWins });
  }

  function confirm() { if (res) { setDone(true); onResult({ player: res.player, enemy: res.enemy, playerWins: res.playerWins }); } }

  if (done && res) return (
    <div className="rounded-xl border border-stone-800 bg-stone-950/80 px-4 py-2 text-xs text-stone-500">
      ⚡ Инициатива: ты {res.player} / враг {res.enemy} → {res.playerWins ? "Ты первый" : "Враг первый"}
    </div>
  );

  const dexLabel = dexMod >= 0 ? `+${dexMod}` : `${dexMod}`;

  return (
    <div className="rounded-xl border border-amber-900/50 bg-stone-950/80 px-4 py-3 my-2">
      <div className="text-amber-500 text-xs uppercase tracking-widest mb-2">⚡ Инициатива (d20 {dexLabel} ЛОВ)</div>
      {!res ? (
        <button onClick={roll} className="w-full py-2.5 rounded-lg text-sm font-bold text-stone-900 active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}>
          🎲 Бросить инициативу
        </button>
      ) : (
        <div>
          <div className="flex justify-around mb-3 text-center">
            <div>
              <div className="text-2xl font-bold" style={{ fontFamily: "serif", color: res.playerWins ? "#4ade80" : "#f87171" }}>{res.player}</div>
              <div className="text-xs text-stone-500">Ты ({res.playerRaw}{dexMod !== 0 ? ` ${dexLabel}` : ""})</div>
            </div>
            <div className="text-stone-600 self-center text-lg">vs</div>
            <div>
              <div className="text-2xl font-bold" style={{ fontFamily: "serif", color: !res.playerWins ? "#4ade80" : "#f87171" }}>{res.enemy}</div>
              <div className="text-xs text-stone-500">Враг</div>
            </div>
          </div>
          <div className={`text-center text-sm font-bold mb-3 ${res.playerWins ? "text-green-400" : "text-red-400"}`}>
            {res.playerWins ? "✦ Ты действуешь первым!" : "✦ Враг атакует первым!"}
          </div>
          <button onClick={confirm} className="w-full py-2 rounded-lg text-sm font-bold bg-stone-700 hover:bg-stone-600 text-amber-100 transition-colors">
            Продолжить
          </button>
        </div>
      )}
    </div>
  );
}

type RollResult = {
  hitRoll: number;
  mod: number;
  prof: number;
  total: number;
  ac: number;
  dc: number;
  success: boolean;
  crit: boolean;
  autoMiss: boolean;
  damage: number;
};

const PROFICIENCY_BONUS = 2;

function RollBlock({ type, request, onResult }: { type: "attack" | "roll"; request: RollRequest; onResult: (r: RollResult) => void }) {
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

  function confirm() { if (res) { setDone(true); onResult(res); } }

  const diceLabel = type === "attack" ? `${request.weapon} (${request.dice})` : `${request.stat} d20`;
  const modLabel = (request.mod || 0) >= 0 ? `+${request.mod || 0}` : `${request.mod}`;
  const targetLabel = type === "attack" ? `AC${request.ac ?? 10}` : `DC${request.dc ?? 15}`;

  if (done && res) {
    let summary: string;
    if (type === "attack") {
      if (res.autoMiss) {
        summary = `d20(1) ✦ АВТОПРОМАХ`;
      } else if (res.crit) {
        summary = `d20(20) ✦ КРИТ → Урон: ${res.damage}`;
      } else if (res.success) {
        summary = `d20(${res.hitRoll}) + mod(${res.mod}) + prof(${res.prof}) = ${res.total} vs AC${res.ac} → ✦ Попал → Урон: ${res.damage}`;
      } else {
        summary = `d20(${res.hitRoll}) + mod(${res.mod}) + prof(${res.prof}) = ${res.total} vs AC${res.ac} → ✦ Мимо`;
      }
    } else {
      summary = `🎲 ${diceLabel}: ${res.hitRoll}${res.mod !== 0 ? ` ${modLabel}` : ""} = ${res.total} vs DC${res.dc} → ${res.success ? "✦ Успех" : "✦ Провал"}`;
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
        {type === "attack" ? "⚔️ Атака" : "🎲 Проверка"}: {diceLabel} {modLabel} vs {targetLabel}
      </div>
      {!res ? (
        <button onClick={execute}
          className="w-full py-2.5 rounded-lg text-sm font-bold text-stone-900 active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}>
          🎲 Бросить d20
        </button>
      ) : (
        <div>
          {type === "attack" ? (
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="bg-stone-800 rounded-lg px-3 py-1 text-lg font-bold"
                style={{ fontFamily: "serif", color: res.crit ? "#fbbf24" : res.autoMiss ? "#ef4444" : res.success ? "#4ade80" : "#f87171" }}>
                {res.hitRoll}
              </span>
              {!res.crit && !res.autoMiss && (
                <>
                  <span className="text-stone-500 text-sm">+{res.mod}</span>
                  <span className="text-stone-500 text-sm">+{res.prof}</span>
                  <span className="text-stone-600">=</span>
                  <span className="text-amber-200 font-bold text-lg" style={{ fontFamily: "serif" }}>{res.total}</span>
                  <span className="text-stone-600 text-sm">vs AC{res.ac}</span>
                </>
              )}
              <span className={`font-bold text-sm ${res.crit ? "text-amber-300" : res.autoMiss ? "text-red-400" : res.success ? "text-green-400" : "text-red-400"}`}>
                {res.crit ? "✦ КРИТ" : res.autoMiss ? "✦ АВТОПРОМАХ" : res.success ? "✦ ПОПАЛ" : "✦ МИМО"}
              </span>
              {res.success && <span className="text-amber-200 text-sm">→ Урон: <b>{res.damage}</b></span>}
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="bg-stone-800 rounded-lg px-3 py-1 text-lg font-bold" style={{ fontFamily: "serif", color: res.success ? "#4ade80" : "#f87171" }}>{res.hitRoll}</span>
              {res.mod !== 0 && <><span className="text-stone-500 text-sm">{res.mod > 0 ? "+" : ""}{res.mod}</span><span className="text-stone-600">=</span></>}
              <span className="text-amber-200 font-bold text-lg" style={{ fontFamily: "serif" }}>{res.total}</span>
              <span className="text-stone-600 text-sm">vs DC{res.dc}</span>
              <span className={`font-bold text-sm ${res.success ? "text-green-400" : "text-red-400"}`}>{res.success ? "✦ УСПЕХ" : "✦ ПРОВАЛ"}</span>
            </div>
          )}
          <button onClick={confirm} className="w-full py-2 rounded-lg text-xs font-bold bg-stone-700 hover:bg-stone-600 text-amber-100 transition-colors">
            OK
          </button>
        </div>
      )}
    </div>
  );
}

function InventoryPanel({ inventory, effects, onUseItem, onClose }: { inventory: string[]; effects: string[]; onUseItem: (item: string, idx: number) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div className="w-full max-w-md bg-stone-900 border border-stone-700 rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-amber-400 font-bold" style={{ fontFamily: "serif" }}>🎒 Инвентарь</div>
          <button onClick={onClose} className="text-stone-500 text-xl leading-none">✕</button>
        </div>
        {inventory.length === 0 ? (
          <div className="text-stone-600 text-sm text-center py-4">Пусто</div>
        ) : (
          <div className="space-y-2">
            {inventory.map((item, i) => {
              const isPotion = item.toLowerCase().includes("зелье");
              return (
                <div key={i} className="flex items-center justify-between bg-stone-800 rounded-xl px-4 py-3">
                  <span className="text-amber-100 text-sm">{item}</span>
                  {isPotion && (
                    <button
                      onClick={() => onUseItem(item, i)}
                      className="text-xs px-3 py-1 rounded-lg font-bold text-stone-900 ml-2 flex-shrink-0"
                      style={{ background: "linear-gradient(135deg,#d97706,#92400e)" }}>
                      Использовать
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {effects.length > 0 && (
          <div className="mt-4 pt-4 border-t border-stone-800">
            <div className="text-stone-500 text-xs uppercase tracking-widest mb-2">Активные эффекты</div>
            {effects.map((e, i) => (
              <div key={i} className="text-amber-300 text-sm bg-stone-800 rounded-lg px-3 py-2 mb-1">{e}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DevPanel({ onJump, onClose }: { onJump: (prompt: string) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div className="w-full max-w-md bg-stone-900 border border-amber-900/50 rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-amber-500 font-bold text-sm" style={{ fontFamily: "serif" }}>🛠 Dev Mode</div>
          <button onClick={onClose} className="text-stone-500 text-xl leading-none">✕</button>
        </div>
        <div className="text-stone-600 text-xs mb-4">Телепортирует в сцену без прохождения пути</div>
        <div className="grid grid-cols-2 gap-2">
          {DEV_SCENES.map(scene => (
            <button key={scene.id} onClick={() => { onJump(scene.prompt); onClose(); }}
              className="py-3 px-3 rounded-xl border border-stone-700 bg-stone-800 text-amber-100 text-sm text-left hover:border-amber-700 transition-colors active:scale-95">
              {scene.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CharacterCard({ char, selected, onSelect }: { char: Character; selected: boolean; onSelect: (c: Character) => void }) {
  return (
    <button onClick={() => onSelect(char)}
      className={`relative w-full text-left rounded-2xl p-5 border transition-all duration-300 overflow-hidden ${selected ? "border-amber-400 shadow-lg shadow-amber-900/40 scale-[1.02]" : "border-stone-700 hover:border-stone-500"}`}
      style={{ background: "linear-gradient(135deg,#1c1917 0%,#0c0a09 100%)" }}>
      {selected && <div className="absolute inset-0 opacity-10" style={{ background: `radial-gradient(ellipse at center,${char.color} 0%,transparent 70%)` }} />}
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">{char.emoji}</span>
          <div>
            <div className="font-bold text-amber-100 text-lg leading-tight" style={{ fontFamily: "serif" }}>{char.name}</div>
            <div className="text-stone-400 text-xs">{char.subtitle}</div>
          </div>
          {selected && <div className="ml-auto text-amber-400 text-lg">✦</div>}
        </div>
        <p className="text-stone-400 text-xs leading-relaxed mb-3">{char.backstory}</p>
        <div className="flex gap-3 text-xs mb-2">
          {([["СИЛ", char.stats.str], ["ЛОВ", char.stats.dex], ["ИНТ", char.stats.int]] as const).map(([l, v]) => (
            <span key={l} className="text-stone-500">{l} <span className="text-amber-300">{v >= 0 ? "+" : ""}{v}</span></span>
          ))}
          <span className="text-stone-500">HP <span className="text-red-400">{char.hp}</span></span>
        </div>
        <div className="text-xs" style={{ color: char.color }}>✦ {char.ability}: <span className="text-stone-400">{char.abilityDesc}</span></div>
        <div className="text-xs text-stone-600 mt-1">🗡 {char.weapon.name} ({char.weapon.dice})</div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// ГЛАВНЫЙ КОМПОНЕНТ
// ─────────────────────────────────────────────────────────────────
export default function SoloDnD() {
  const [screen, setScreen] = useState<"select" | "game">("select");
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hp, setHp] = useState(14);
  const [inventory, setInventory] = useState<string[]>([]);
  const [effects, setEffects] = useState<string[]>([]);
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [inCombat, setInCombat] = useState(false);
  const [pendingRoll, setPendingRoll] = useState<PendingRoll | null>(null);
  const [pendingInitiative, setPendingInitiative] = useState(false);
  const [freeInput, setFreeInput] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [showInventory, setShowInventory] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const devTaps = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    character: Character | null;
    hp: number;
    inventory: string[];
    effects: string[];
    enemies: Enemy[];
    messages: ChatMessage[];
  }>({ character: null, hp: 0, inventory: [], effects: [], enemies: [], messages: [] });
  stateRef.current = { character, hp, inventory, effects, enemies, messages };

  useEffect(() => { initAnalytics(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, pendingRoll, pendingInitiative]);

  // ── Сейв (localStorage, безопасно к SSR) ──────────────────────
  function doSave(char: Character, currentHp: number, currentInv: string[], currentEff: string[], msgs: ChatMessage[]) {
    if (typeof window === "undefined") return;
    const recent = msgs.filter(m => m.role === "assistant").slice(-3)
      .map(m => (m.parsed?.narrative || m.content).slice(0, 100)).join(" → ");
    const save = {
      savedAt: new Date().toLocaleString("ru"),
      character: { id: char.id, name: char.name, emoji: char.emoji },
      hp: currentHp, maxHp: char.maxHp,
      inventory: currentInv, effects: currentEff,
      plotSummary: recent || "Начало приключения",
      messageCount: msgs.length,
    };
    try { window.localStorage.setItem("dnd_save_v3", JSON.stringify(save)); } catch { /* noop */ }
    trackEvent("session_saved", { characterId: char.id, messageNumber: msgs.length });
  }

  // ── API: запрос к серверной функции /api/dm ───────────────────
  async function callAPI(char: Character, currentHp: number, currentInv: string[], currentEff: string[], history: ChatMessage[], userMessage: string) {
    const res = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: buildSystemPrompt(char, currentHp, currentInv, currentEff),
        messages: [...history, { role: "user", content: userMessage }].map(m => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json() as { text?: string };
    return data.text || "Мастер молчит...";
  }

  // ── Обработка ответа DM ───────────────────────────────────────
  function applyParsed(parsed: Parsed, currentHp: number, currentInv: string[], currentEff: string[], currentEnemies: Enemy[]) {
    let newHp = currentHp;
    let newInv = [...currentInv];
    const newEff = [...currentEff];
    let newEnemies = [...currentEnemies];

    if (parsed.damage) { newHp = Math.max(0, newHp - parsed.damage); setHp(newHp); }
    if (parsed.newItem) { newInv = [...newInv, parsed.newItem]; setInventory(newInv); }

    if (parsed.newEnemies?.length) {
      const wasInCombat = currentEnemies.length > 0;
      newEnemies = [...newEnemies, ...parsed.newEnemies];
      setEnemies(newEnemies);
      setInCombat(true);
      if (!wasInCombat) {
        trackEvent("combat_started", {
          characterId: stateRef.current.character?.id,
          messageNumber: stateRef.current.messages.length,
          enemyCount: parsed.newEnemies.length,
        });
      }
    } else if (newEnemies.length === 0) {
      // Защита: DM забыл объявить врагов через [ВРАГ:], но в нарративе явно идёт бой.
      // Пробуем извлечь имена и HP из текста по паттерну "Имя (HP: X/Y)".
      const combatHints = /(атакует|нападает|нападают|HP:|культист|бандит|враг|разбойник|гоблин|орк|скелет|гнолл)/i;
      if (combatHints.test(parsed.narrative)) {
        const inferred: Enemy[] = [];
        const hpRe = /([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'`-]{1,30}?)\s*\(\s*HP:\s*(\d+)\s*\/\s*(\d+)\s*\)/gi;
        let m: RegExpExecArray | null;
        const seen = new Set<string>();
        while ((m = hpRe.exec(parsed.narrative)) !== null) {
          const name = m[1].trim().replace(/^[—–\-•:,\.]+/, "").trim();
          const hp = parseInt(m[2]);
          const maxHp = parseInt(m[3]);
          const key = `${name.toLowerCase()}|${maxHp}`;
          if (name && maxHp > 0 && !seen.has(key)) {
            seen.add(key);
            inferred.push({ name, hp, maxHp });
          }
        }
        if (inferred.length) {
          newEnemies = [...newEnemies, ...inferred];
          setEnemies(newEnemies);
          setInCombat(true);
          trackEvent("combat_started", {
            characterId: stateRef.current.character?.id,
            messageNumber: stateRef.current.messages.length,
            enemyCount: inferred.length,
            inferred: true,
          });
        }
      }
    }

    if (parsed.enemyDamages?.length) {
      for (const ed of parsed.enemyDamages) {
        newEnemies = newEnemies.map(e =>
          e.name.toLowerCase() === ed.name.toLowerCase()
            ? { ...e, hp: Math.max(0, e.hp - ed.damage) }
            : e
        );
      }
      setEnemies(newEnemies);
    }

    if (parsed.combatEnd || (newEnemies.length > 0 && newEnemies.every(e => e.hp <= 0))) {
      const wasInCombat = currentEnemies.length > 0 || stateRef.current.enemies.length > 0;
      setInCombat(false);
      setEnemies([]);
      if (wasInCombat) {
        trackEvent("combat_ended", {
          characterId: stateRef.current.character?.id,
          messageNumber: stateRef.current.messages.length,
          playerHp: newHp,
        });
      }
    }

    return { newHp, newInv, newEff, newEnemies };
  }

  async function processAndSetMessages(char: Character, currentHp: number, currentInv: string[], currentEff: string[], currentEnemies: Enemy[], reply: string, prevMessages: ChatMessage[]) {
    const parsed = parseDMResponse(reply);
    const newMsgs: ChatMessage[] = [...prevMessages, { role: "assistant", content: reply, parsed }];
    const { newHp, newInv, newEff } = applyParsed(parsed, currentHp, currentInv, currentEff, currentEnemies);
    setMessages(newMsgs);

    if (parsed.initiativeTrigger) {
      setPendingInitiative(true);
      setPendingRoll(null);
    } else if (parsed.attackRequest) {
      const mod = char.stats[char.weapon.stat] || 0;
      setPendingRoll({ type: "attack", request: { ...parsed.attackRequest, mod } });
      setPendingInitiative(false);
    } else if (parsed.rollRequest) {
      const lower = parsed.rollRequest.stat.toLowerCase();
      const statKey: Stat = lower.includes("сил") ? "str" : lower.includes("лов") ? "dex" : "int";
      const mod = char.stats[statKey] || 0;
      setPendingRoll({ type: "roll", request: { ...parsed.rollRequest, mod } });
      setPendingInitiative(false);
    } else {
      setPendingRoll(null);
      setPendingInitiative(false);
    }

    doSave(char, newHp, newInv, newEff, newMsgs);
    trackEvent("scene_completed", {
      characterId: char.id,
      messageNumber: newMsgs.length,
      inCombat: stateRef.current.enemies.length > 0,
    });
    return newMsgs;
  }

  // ── Старт игры ────────────────────────────────────────────────
  async function startGame(char: Character, customPrompt?: string) {
    setCharacter(char);
    setHp(char.hp);
    const startInv = [...char.startItems];
    setInventory(startInv);
    setEffects([]);
    setEnemies([]);
    setInCombat(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    setMessages([]);
    setScreen("game");
    setLoading(true);
    trackEvent("game_started", { characterId: char.id, messageNumber: 0, characterName: char.name });
    const prompt = customPrompt || "Начни приключение. Вводная сцена в Сером Берегу. 3 варианта действий.";
    try {
      const reply = await callAPI(char, char.hp, startInv, [], [], prompt);
      await processAndSetMessages(char, char.hp, startInv, [], [], reply, []);
    } catch {
      setMessages([{ role: "assistant", content: "Ошибка соединения с Мастером.", parsed: parseDMResponse("Ошибка соединения.") }]);
    }
    setLoading(false);
  }

  // ── Выбор действия ────────────────────────────────────────────
  async function handleChoice(choiceText: string) {
    if (loading) return;
    const { character: c, hp: h, inventory: inv, effects: eff, enemies: en, messages: msgs } = stateRef.current;
    if (!c) return;
    setFreeInput(false);
    setFreeText("");
    setPendingRoll(null);
    setPendingInitiative(false);
    const newMsgs: ChatMessage[] = [...msgs, { role: "user", content: choiceText }];
    setMessages(newMsgs);
    setLoading(true);
    try {
      const reply = await callAPI(c, h, inv, eff, msgs, choiceText);
      await processAndSetMessages(c, h, inv, eff, en, reply, newMsgs);
    } catch {
      setMessages([...newMsgs, { role: "assistant", content: "Связь прервалась.", parsed: parseDMResponse("Связь прервалась.") }]);
    }
    setLoading(false);
  }

  // ── Результат броска ──────────────────────────────────────────
  async function handleRollResult(rollRes: RollResult) {
    const r = pendingRoll;
    if (!r) return;
    setPendingRoll(null);
    let msg: string;
    if (r.type === "attack") {
      if (rollRes.autoMiss) {
        msg = `[Атака: ${r.request.weapon} — d20(1) АВТОПРОМАХ vs AC${rollRes.ac}]`;
      } else if (rollRes.crit) {
        msg = `[Атака: ${r.request.weapon} — d20(20) КРИТ vs AC${rollRes.ac} → Урон врагу: ${rollRes.damage}. Опиши удар и напиши [ВРАГ_УРОН: Имя, ${rollRes.damage}].]`;
      } else if (rollRes.success) {
        msg = `[Атака: ${r.request.weapon} — d20(${rollRes.hitRoll})+mod(${rollRes.mod})+prof(${rollRes.prof})=${rollRes.total} vs AC${rollRes.ac} ПОПАЛ → Урон врагу: ${rollRes.damage}. Опиши удар и напиши [ВРАГ_УРОН: Имя, ${rollRes.damage}].]`;
      } else {
        msg = `[Атака: ${r.request.weapon} — d20(${rollRes.hitRoll})+mod(${rollRes.mod})+prof(${rollRes.prof})=${rollRes.total} vs AC${rollRes.ac} МИМО]`;
      }
    } else {
      msg = `[Проверка: ${r.request.stat} — ${rollRes.success ? "УСПЕХ" : "ПРОВАЛ"} (${rollRes.hitRoll}${rollRes.mod !== 0 ? `${rollRes.mod >= 0 ? "+" : ""}${rollRes.mod}` : ""}=${rollRes.total} vs DC${rollRes.dc})]`;
    }
    await handleChoice(msg);
  }

  async function handleInitiativeResult(res: { player: number; enemy: number; playerWins: boolean }) {
    setPendingInitiative(false);
    const msg = res.playerWins
      ? `[Инициатива выиграна: ты ${res.player} vs враг ${res.enemy} — действуешь первым]`
      : `[Инициатива проиграна: ты ${res.player} vs враг ${res.enemy} — враг атакует первым]`;
    await handleChoice(msg);
  }

  function handleUseItem(_item: string, idx: number) {
    const { hp: h, character: c } = stateRef.current;
    if (!c) return;
    const heal = rollDice(6) + 2;
    const newHp = Math.min(c.maxHp, h + heal);
    setHp(newHp);
    setInventory(prev => prev.filter((_, i) => i !== idx));
    setShowInventory(false);
    setMessages(prev => [...prev, {
      role: "assistant",
      content: `Зелье выпито. +${heal} HP. (${newHp}/${c.maxHp})`,
      parsed: parseDMResponse(`✦ Ты выпиваешь зелье лечения. Тёплая волна прокатывается по телу. +${heal} HP. (${newHp}/${c.maxHp})`)
    }]);
  }

  function exitToMenu() {
    const { character: c, hp: h, inventory: inv, effects: eff, messages: msgs } = stateRef.current;
    if (c) doSave(c, h, inv, eff, msgs);
    setScreen("select");
    setMessages([]);
    setEnemies([]);
    setInCombat(false);
    setPendingRoll(null);
    setPendingInitiative(false);
  }

  function handleDevTap() {
    devTaps.current += 1;
    if (devTaps.current >= 5) {
      devTaps.current = 0;
      const { character: c, hp: h, inventory: inv, effects: eff, messages: msgs } = stateRef.current;
      if (c) doSave(c, h, inv, eff, msgs);
      setShowDev(true);
    }
  }

  async function jumpToScene(prompt: string) {
    const { character: c, hp: h, inventory: inv, effects: eff } = stateRef.current;
    if (!c) return;
    setMessages([]);
    setEnemies([]);
    setInCombat(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    setLoading(true);
    try {
      const reply = await callAPI(c, h, inv, eff, [], prompt);
      await processAndSetMessages(c, h, inv, eff, [], reply, []);
    } catch {
      setMessages([{ role: "assistant", content: "Ошибка.", parsed: parseDMResponse("Ошибка.") }]);
    }
    setLoading(false);
  }

  // ─────────────────────────────────────────────────────────────
  // ЭКРАН ВЫБОРА
  // ─────────────────────────────────────────────────────────────
  if (screen === "select") {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>
        <div className="text-center pt-12 pb-6 px-6">
          <div className="text-amber-600 text-xs tracking-[0.4em] uppercase mb-2">Серый Берег</div>
          <h1 className="text-4xl font-bold text-amber-100 leading-tight mb-2">Тени &<br />Легенды</h1>
          <p className="text-stone-500 text-sm">Соло приключение · D&amp;D 5e</p>
          <div className="mt-4 w-16 h-px bg-amber-700/50 mx-auto" />
        </div>
        <div className="px-4 pb-8 flex flex-col gap-3 max-w-md mx-auto w-full">
          <p className="text-stone-500 text-xs text-center mb-1 tracking-wide uppercase">Выбери своего героя</p>
          {CHARACTERS.map(char => (
            <CharacterCard key={char.id} char={char} selected={selectedChar?.id === char.id} onSelect={setSelectedChar} />
          ))}
          <button
            onClick={() => selectedChar && startGame(selectedChar)}
            disabled={!selectedChar}
            className="mt-2 w-full py-4 rounded-2xl font-bold text-lg transition-all duration-300 active:scale-95"
            style={{
              background: selectedChar ? "linear-gradient(135deg,#d97706 0%,#92400e 100%)" : "#292524",
              color: selectedChar ? "#0c0a09" : "#57534e",
              boxShadow: selectedChar ? "0 4px 24px rgba(217,119,6,0.3)" : "none",
              letterSpacing: "0.05em",
            }}>
            {selectedChar ? `Начать за ${selectedChar.name}` : "Выбери персонажа"}
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // ИГРОВОЙ ЭКРАН
  // ─────────────────────────────────────────────────────────────
  const lastMsg = messages[messages.length - 1];
  const parsed = lastMsg?.parsed;
  const showChoices = !loading && !freeInput && !pendingRoll && !pendingInitiative && (parsed?.choices?.length ?? 0) > 0;
  const showFreeArea = freeInput && !loading;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>

      {showInventory && <InventoryPanel inventory={inventory} effects={effects} onUseItem={handleUseItem} onClose={() => setShowInventory(false)} />}
      {showDev && <DevPanel onJump={jumpToScene} onClose={() => setShowDev(false)} />}

      <div className="sticky top-0 z-20 border-b border-stone-800/60 backdrop-blur" style={{ background: "rgba(12,10,9,0.93)" }}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <button onClick={exitToMenu} className="text-stone-500 text-sm hover:text-stone-300 transition-colors">← Меню</button>

          <div className="text-center cursor-pointer select-none" onClick={handleDevTap}>
            <div className="text-amber-200 text-sm font-bold">{character?.emoji} {character?.name}</div>
            <button
              onClick={e => { e.stopPropagation(); setShowInventory(true); }}
              className="text-stone-500 text-xs hover:text-amber-400 transition-colors"
            >
              🎒 {inventory.length} предм.
            </button>
          </div>

          <div className="flex items-center gap-1.5 min-w-[60px] justify-end">
            <div className="text-xs text-stone-500">HP</div>
            <div className="font-bold text-sm" style={{ color: character && hp / character.maxHp > 0.5 ? "#f87171" : character && hp / character.maxHp > 0.25 ? "#fbbf24" : "#ef4444" }}>{hp}</div>
            <div className="text-stone-600 text-xs">/{character?.maxHp}</div>
          </div>
        </div>

        {inCombat && enemies.filter(e => e.hp > 0).length > 0 && (
          <div className="px-4 pb-2 space-y-1 border-t border-stone-800/40 pt-2">
            {enemies.filter(e => e.hp > 0).map((en, i) => (
              <EnemyHP key={i} name={en.name} hp={en.hp} maxHp={en.maxHp} />
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ paddingBottom: "280px" }}>
        {messages.map((msg, i) => {
          if (msg.role === "user") {
            const isSystem = msg.content.startsWith("[");
            return (
              <div key={i} className="flex justify-end">
                <div className={`max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed ${
                  isSystem
                    ? "bg-stone-950 border border-stone-800 text-stone-500 text-xs font-mono"
                    : "bg-stone-800 text-stone-300"
                }`}>
                  {isSystem ? msg.content.replace(/^\[/, "").replace(/\]$/, "") : msg.content}
                </div>
              </div>
            );
          }
          const p = msg.parsed || parseDMResponse(msg.content);
          const isLast = i === messages.length - 1;
          return (
            <div key={i} className="space-y-2">
              <div className="bg-stone-900/60 rounded-2xl rounded-tl-sm px-4 py-4 border border-stone-800/40 max-w-full overflow-hidden">
                <p className="text-amber-100/90 text-sm leading-relaxed whitespace-pre-line" style={{ fontFamily: "serif", overflowWrap: "break-word", wordBreak: "break-word" }}>
                  {p.narrative}
                </p>
                {p.newItem && <div className="mt-2 text-xs text-amber-500">✦ Получен: {p.newItem}</div>}
                {p.damage && <div className="mt-2 text-xs text-red-400">⚡ Урон: -{p.damage} HP</div>}
              </div>
              {isLast && pendingInitiative && <InitiativeBlock dexMod={character?.stats.dex ?? 0} onResult={handleInitiativeResult} />}
              {isLast && pendingRoll && !pendingInitiative && (
                <RollBlock type={pendingRoll.type} request={pendingRoll.request} onResult={handleRollResult} />
              )}
            </div>
          );
        })}

        {loading && (
          <div className="bg-stone-900/60 rounded-2xl rounded-tl-sm px-4 py-4 border border-stone-800/40">
            <div className="flex gap-1.5 items-center">
              <div className="text-amber-600 text-xs tracking-widest">Мастер думает</div>
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1 h-1 bg-amber-600 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-10" style={{ background: "linear-gradient(0deg,#0c0a09 60%,transparent 100%)" }}>
        <div className="px-4 pb-6 pt-3 max-w-md mx-auto space-y-2">
          {showChoices && parsed && (
            <>
              {parsed.choices
                .filter(choice => !/свой\s*вариант/i.test(choice.text))
                .map((choice, i) => (
                <button key={i} onClick={() => handleChoice(choice.text)}
                  className="w-full text-left px-4 py-3 rounded-xl border border-stone-700 bg-stone-900/95 text-amber-100 text-sm leading-snug transition-all active:scale-[0.98] hover:border-amber-700/50 hover:bg-stone-800"
                  style={{ fontFamily: "serif", overflowWrap: "break-word", wordBreak: "break-word" }}>
                  <span className="text-amber-600 font-bold mr-2">{choice.num}.</span>{choice.text}
                </button>
              ))}
              <button onClick={() => {
                trackEvent("free_input_used", {
                  characterId: stateRef.current.character?.id,
                  messageNumber: stateRef.current.messages.length,
                });
                setFreeInput(true);
              }}
                className="w-full text-left px-4 py-3 rounded-xl border border-stone-800 bg-stone-950/90 text-stone-400 text-sm transition-all active:scale-[0.98] hover:border-stone-600 hover:text-stone-300"
                style={{ fontFamily: "serif" }}>
                <span className="text-stone-600 mr-2">✍</span>Свой вариант...
              </button>
            </>
          )}

          {showFreeArea && (
            <>
              <textarea autoFocus value={freeText} onChange={e => setFreeText(e.target.value)}
                placeholder="Опиши своё действие..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-stone-600 bg-stone-900 text-amber-100 text-sm leading-relaxed resize-none outline-none focus:border-amber-700 transition-colors"
                style={{ fontFamily: "serif" }} />
              <div className="flex gap-2">
                <button onClick={() => { setFreeInput(false); setFreeText(""); }}
                  className="flex-1 py-2.5 rounded-xl border border-stone-700 bg-stone-900 text-stone-400 text-sm hover:text-stone-300 transition-colors">
                  Отмена
                </button>
                <button onClick={() => freeText.trim() && handleChoice(freeText.trim())}
                  disabled={!freeText.trim()}
                  className="flex-[2] py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
                  style={{
                    background: freeText.trim() ? "linear-gradient(135deg,#d97706,#92400e)" : "#292524",
                    color: freeText.trim() ? "#0c0a09" : "#57534e"
                  }}>
                  Действовать
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
