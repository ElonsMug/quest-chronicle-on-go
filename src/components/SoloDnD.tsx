import { useState, useRef, useEffect } from "react";
import { initAnalytics, trackEvent } from "@/lib/analytics";

// ─────────────────────────────────────────────────────────────────
// ДАННЫЕ
// ─────────────────────────────────────────────────────────────────
type Stat = "str" | "dex" | "int";
type SpellType = "attack" | "defense" | "control";
type Spell = { name: string; cost: number; type: SpellType; dice?: string; stat?: Stat; description: string };
type ClassAbility = { name: string; type: "berserk" | "sneak" };
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
  spellSlots?: { current: number; max: number };
  spellSaveDC?: number;
  spells?: Spell[];
  classAbility?: ClassAbility;
};

const CHARACTERS: Character[] = [
  {
    id: "warrior", name: "Воин", emoji: "⚔️", subtitle: "Закалённый боец",
    hp: 14, maxHp: 14, stats: { str: 3, dex: 1, int: -1 },
    ability: "Берсерк", abilityDesc: "Раз в бой: +2 урон / -2 AC на 2 хода",
    weapon: { name: "Меч", dice: "d8", stat: "str" }, color: "#C0392B",
    backstory: "Бывший наёмник из Серого Берега. Ты видел войны и предательства, но меч не бросил.",
    startItems: ["Короткий меч", "Кожаный доспех", "Зелье лечения (d6+2 HP)"],
    classAbility: { name: "Берсерк", type: "berserk" },
  },
  {
    id: "rogue", name: "Плут", emoji: "🗡️", subtitle: "Теневой клинок",
    hp: 10, maxHp: 10, stats: { str: 0, dex: 3, int: 1 },
    ability: "Скрытая атака", abilityDesc: "+d6 урона после уклонения",
    weapon: { name: "Кинжал", dice: "d6", stat: "dex" }, color: "#8E44AD",
    backstory: "Сирота с городских улиц. Ты вырос в переулках и знаешь каждую тень портового квартала.",
    startItems: ["Кинжал", "Отмычки", "Зелье лечения (d6+2 HP)"],
    classAbility: { name: "Скрытая атака", type: "sneak" },
  },
  {
    id: "mage", name: "Маг", emoji: "🔮", subtitle: "Изгнанник Академии",
    hp: 8, maxHp: 8, stats: { str: -1, dex: 0, int: 4 },
    ability: "Заклинания", abilityDesc: "3 слота в день",
    weapon: { name: "Посох", dice: "d6", stat: "int" }, color: "#2980B9",
    backstory: "Отчисленный студент Академии Серых Магов. Тебе запретили практиковать — ты практикуешь.",
    startItems: ["Посох", "Зелье лечения (d6+2 HP)", "Свиток Огненного Болта"],
    spellSlots: { current: 3, max: 3 },
    spellSaveDC: 14,
    spells: [
      { name: "Огненный болт", cost: 1, dice: "d10", stat: "int", type: "attack", description: "d10+INT урон" },
      { name: "Щит", cost: 1, type: "defense", description: "+5 AC до следующего хода" },
      { name: "Усыпление", cost: 1, type: "control", description: "Бросаем 5d8 пул HP. Засыпают враги от слабых к сильным пока пул не иссякнет. Нежить — иммунны." },
    ],
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
function buildSystemPrompt(character: Character, hp: number, inventory: string[], effects: string[], spellSlots: { current: number; max: number } | null) {
  const inv = inventory.length ? inventory.join(", ") : "пусто";
  const eff = effects.length ? effects.join(", ") : "нет";
  const s = (n: number) => (n >= 0 ? "+" : "") + n;
  const spellsBlock = character.id === "mage" && spellSlots
    ? `Слоты заклинаний: ${spellSlots.current}/${spellSlots.max}\n`
    : "";
  const mageRules = character.id === "mage" ? `

ЗАКЛИНАНИЯ МАГА:
- Заклинания (Огненный болт, Щит, Усыпление) — стоят 1 слот
- Текущие слоты: ${spellSlots?.current ?? 0}/${spellSlots?.max ?? 0}
- Когда игрок применяет заклинание через UI — система УЖЕ списала слот, не списывай повторно
- DM описывает эффект заклинания в нарративе ярко и сочно
- Огненный болт — система сама бросает d10+INT vs AC, DM описывает попадание/промах
- При Щите: добавь эффект игроку [ЭФФЕКТ: Щит, 1 раунд]

SPELL SAVE DC МАГА: 14 (= 8 + proficiency(2) + INT(4)).
Когда враг сопротивляется заклинанию контроля — он бросает Wisdom saving throw против DC 14.
Модификаторы Wisdom типичных врагов:
  - Обычный бандит / разбойник: WIS +0 (сложно устоять)
  - Гвардеец / стражник: WIS +2
  - Культист / фанатик: WIS +1
  - Нежить / конструкт / демон: иммунны к Усыплению (не засыпают)

УСЫПЛЕНИЕ — МЕХАНИКА ПУЛА HP:
Когда игрок применяет Усыпление — система пишет "[Усыпление: пул X HP. ...]" с уже посчитанным пулом.
ТЫ ОБЯЗАН:
1. Отсортировать живых врагов по возрастанию HP.
2. Идти от врага с наименьшим HP. Если его текущий HP ≤ оставшемуся пулу — он засыпает, вычитаешь его HP из пула, переходишь к следующему. Иначе — стоп.
3. Нежить, конструкты, демоны — НЕ засыпают (пропускаешь, но HP пула не тратишь).
4. Для каждого уснувшего пиши: [ЭФФЕКТ: <Имя_врага>_спит, 2 раунда]
5. Спящий враг НЕ считается побеждённым — он без сознания, лежит беспомощный.
6. После описания — спроси игрока что делать со спящими: добить, связать, допросить, обыскать.
   Дай это как варианты 1-2-3 (не боевые кнопки — это уже не активный бой со спящими).
7. Если после Усыпления остались бодрствующие враги — продолжаешь бой как обычно с ними.
8. [КОНЕЦ_БОЯ] ставится только когда все враги либо мертвы, либо выведены из строя необратимо
   (связаны, добиты). Спящие сами по себе бой не заканчивают.
` : "";
  return `Ты — Мастер Подземелий в соло текстовой RPG (D&D 5e упрощённая). Один игрок.

ПЕРСОНАЖ:
Класс: ${character.name} | HP: ${hp}/${character.maxHp}
Сила ${s(character.stats.str)} | Ловкость ${s(character.stats.dex)} | Интеллект ${s(character.stats.int)}
Оружие: ${character.weapon.name} (${character.weapon.dice}+${s(character.stats[character.weapon.stat])})
${spellsBlock}Инвентарь: ${inv} | Эффекты: ${eff}

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
[ПРЕДМЕТ: название] — добавить предмет в инвентарь.
   ⚠️ КРИТИЧНО: КАЖДЫЙ РАЗ когда игрок получает предмет любым способом
   (находит, покупает, крадёт, получает в награду, берёт у NPC, поднимает с трупа,
   получает золото/монеты) — ты ОБЯЗАН написать тег [ПРЕДМЕТ: название] на отдельной
   строке. Без исключений.
   Примеры:
     Купил зелье → [ПРЕДМЕТ: Зелье лечения (d6+2 HP)]
     Нашёл верёвку → [ПРЕДМЕТ: Верёвка]
     Получил награду → [ПРЕДМЕТ: 10 золотых]
     Снял с врага → [ПРЕДМЕТ: Кинжал бандита]
   Несколько предметов = несколько тегов, каждый на своей строке.
[УЛУЧШЕНИЕ: старое_название -> новое_название] — когда игрок улучшает, чинит,
   зачаровывает или модифицирует существующий предмет. Система найдёт предмет со
   старым названием в инвентаре и заменит на новое.
   Примеры:
     [УЛУЧШЕНИЕ: Кинжал -> Заточенный кинжал]
     [УЛУЧШЕНИЕ: Меч -> Меч +1]
     [УЛУЧШЕНИЕ: Сломанный щит -> Починенный щит]
[ВРАГ: Имя, HP:число, AC:число, УРОН:кубик] — объявить врага с атрибутами.
   AC = Armor Class (типичные значения: бандит AC12, стражник AC14, рыцарь AC16, маг AC11).
   УРОН = кубик урона врага (бандит d6+1, стражник d8+2, маг d4+3, гоблин d4).
   Пример: [ВРАГ: Лысый бандит, HP:8, AC:12, УРОН:d6+1]
   Для нежити добавь флаг: [ВРАГ: Скелет, HP:6, AC:13, УРОН:d6, НЕЖИТЬ]
   Если не указать AC и УРОН — дефолт AC:12, УРОН:d4+1.
[ВРАГ_УРОН: Имя, число] — нанести урон врагу (система отслеживает HP врагов).
   Используй РОВНО то же уникальное имя что и в [ВРАГ:] — иначе урон не применится.
[СОЮЗНИК: Имя, HP:число] — объявить союзника NPC (атакует автоматически в нарративе).
[СОЮЗНИК_УРОН: Имя, число] — урон союзнику от врага.
[ИНИЦИАТИВА] — в начале КАЖДОГО боя, система бросит d20 за обе стороны
[КОНЕЦ_БОЯ] — когда все враги повержены

СВОБОДА ДЕЙСТВИЙ (КРИТИЧНО):
- Если игрок выбирает "Свой вариант" и описывает нестандартное действие — ВСЕГДА назначай бросок.
  * Угрожает? → [БРОСОК: Харизма/Запугивание, DC13]
  * Горсть пыли в лицо? → [БРОСОК: Ловкость, DC12], при успехе враг ослеплён 1 раунд
  * Пытается договориться? → [БРОСОК: Убеждение, DC14]
  * Физическое действие? → [БРОСОК: Сила, DC12]
  Никогда не отказывай. Всегда найди механику.

[ЭФФЕКТ: название, длительность] — добавить временный эффект (например, [ЭФФЕКТ: Враг_замедлен, 1 раунд], [ЭФФЕКТ: Щит, 1 раунд]).

БОЙ:
- ⚠️ КРИТИЧНО: В ПЕРВОМ сообщении любой боевой сцены ты ОБЯЗАН объявить ВСЕХ врагов
  тегами [ВРАГ: Имя, HP:число] — каждый на отдельной строке — ДО любого описания атак,
  ДО нарратива про удары, ДО [ИНИЦИАТИВА]. Без этих тегов система НЕ показывает полоски HP врагов.
  Пример правильного начала боя:
    [ВРАГ: Культист, HP:6]
    [ВРАГ: Культист, HP:6]
    [ВРАГ: Культист, HP:6]
    [ИНИЦИАТИВА]
    (затем нарратив без вариантов — система покажет боевые кнопки)
- Если ты забыл объявить врагов в первом сообщении боя — СДЕЛАЙ ЭТО В СЛЕДУЮЩЕМ ЖЕ сообщении,
  до любых других действий и тегов.
- Порядок: сначала [ВРАГ: ...] для всех врагов, затем [ИНИЦИАТИВА], потом чередование ходов.
- Показывай HP врага в скобках после имени: "Бандит (HP: 5/8)"
- Когда враг получает урон — обнови его HP тегом [ВРАГ_УРОН: Имя, число]
- Урон от атаки при попадании — посчитай сам исходя из кубика и модификатора, напиши [ВРАГ_УРОН: Имя, урон]
- При промахе — просто опиши промах, не используй [ВРАГ_УРОН]

ПОРЯДОК БОЕВОГО ХОДА (КРИТИЧНО):
- ⚠️ Когда система присылает "[Инициатива выиграна: ...]" — игрок действует первым.
  ТЫ НЕ АТАКУЕШЬ В ЭТОМ ОТВЕТЕ. ТЫ НЕ ПИШЕШЬ [АТАКА:]. ТЫ НЕ ПИШЕШЬ [УРОН:].
  Только короткое описание сцены (1-2 предложения) — кто где стоит, что в воздухе.
  Затем жди — система покажет боевые кнопки игроку.
- ⚠️ Когда система присылает "[Инициатива проиграна: ...]" — враги атакуют ПЕРВЫМИ.
  ТЫ ОБЯЗАН в этом же ответе:
  1. Описать атаку каждого живого врага.
  2. Для каждого попадания написать [УРОН: число] на отдельной строке.
  3. После этого — короткая пауза, жди ход игрока (система покажет кнопки).
- После КАЖДОГО действия игрока в бою (атака, берсерк, оборона, уклонение, заклинание, свой вариант)
  ты ОБЯЗАН в этом же ответе:
  1. Описать результат действия игрока (1-2 предложения).
  2. Описать атаку КАЖДОГО живого врага (1 предложение на врага).
  3. Для каждого попадания написать [УРОН: число] на отдельной строке.
  4. НЕ предлагать варианты 1-2-3 — система покажет боевые кнопки сама.
- Враги не ждут. Враги не пропускают ход. Если игрок сделал что-то странное и не атаковал —
  враги всё равно бьют его в этом же ответе.
- Исключение: если игрок выбрал [Уклонение] — враги атакуют с помехой (см. ниже).
- Исключение: если игрок выбрал [Применён Щит] — игрок имеет +5 AC до следующего хода,
  атаки врагов с большой вероятностью промахиваются (учитывай это в d20 vs AC).

БОЕВЫЕ КНОПКИ КЛАССА:
В бою игрок использует фиксированные кнопки класса, НЕ варианты от DM.
DM в бою НЕ предлагает варианты 1-2-3 — только описывает результат действия игрока и атаки врагов.
Исключение: после окончания боя [КОНЕЦ_БОЯ] — снова предлагай 3 варианта.

Берсерк: когда получаешь [Активирован Берсерк] — следующие 2 атаки игрока наносят +2 урона, враги бьют игрока с +2 урона (AC снижен).
Уклонение (КРИТИЧНО): когда игрок выбрал [Уклонение] — каждый враг бросает d20 ДВАЖДЫ и использует МЕНЬШИЙ результат.
   Это НЕ гарантирует промах — если оба броска высокие, враг всё равно попадёт. DM ОБЯЗАН явно показать ОБА броска в нарративе.
   Примеры:
     "Бандит замахивается — d20(14) и d20(7), берёт меньший: 7. Промах, ты уходишь под клинком."
     "Культист ударяет — d20(15) и d20(18), берёт меньший: 15. Удар достигает цели. [УРОН: 4]"
   Уклонение НЕ гарантирует избегание урона — это лишь снижает шанс попасть.
Скрытая атака: когда получаешь атаку после уклонения — добавь +d6 к урону в описании.
Магическая стрела: когда получаешь [Магическая стрела: X урона] — напиши [ВРАГ_УРОН: Имя, X] для первого живого врага.

УНИКАЛЬНЫЕ ИМЕНА ВРАГОВ (КРИТИЧНО):
Если в одном бою несколько врагов одного типа — ты ОБЯЗАН дать им уникальные описательные имена при объявлении через [ВРАГ:].
Никогда не используй одинаковые имена для разных врагов в одном бою — система применит урон только к одному из них.
Примеры правильных имён:
   [ВРАГ: Лысый бандит, HP:8]
   [ВРАГ: Тощий бандит, HP:8]
   [ВРАГ: Бандит со шрамом, HP:8]
Или порядковые: "Первый бандит", "Второй бандит", "Третий бандит".
В тегах [ВРАГ_УРОН: Имя, X] используй ровно те же уникальные имена.

СЮЖЕТ: тёмный фэнтезийный портовый город "Серый Берег". Краткость — мобильный, метро.${mageRules}`;
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
  const newEnemies: { name: string; maxHp: number; hp: number; ac: number; damage: string; isUndead?: boolean }[] = [];
  const newAllies: { name: string; maxHp: number; hp: number }[] = [];
  const allyDamages: { name: string; damage: number }[] = [];
  const enemyDamages: { name: string; damage: number }[] = [];
  const newEffects: { name: string; duration: string }[] = [];
  let initiativeTrigger = false;
  let combatEnd = false;

  const TAG = /\[(АТАКА|БРОСОК|УРОН|ПРЕДМЕТ|УЛУЧШЕНИЕ|ВРАГ|ВРАГ_УРОН|СОЮЗНИК|СОЮЗНИК_УРОН|ЭФФЕКТ|ИНИЦИАТИВА|КОНЕЦ_БОЯ)[^\]]*\]/gi;

  const atk = text.match(/\[АТАКА:\s*([^,\]]+),\s*([^,\]]+),\s*([^,\]]+),\s*AC(\d+)\]/i);
  if (atk) attackRequest = { weapon: atk[1].trim(), dice: atk[2].trim(), mod: parseInt(atk[3]) || 0, ac: parseInt(atk[4]) };

  const rol = text.match(/\[БРОСОК:\s*([^,\]]+)(?:,\s*DC(\d+))?\]/i);
  if (rol) rollRequest = { stat: rol[1].trim(), dc: parseInt(rol[2] || "15") };

  // Суммируем все [УРОН: X] за ход
  const dmgRe = /\[УРОН:\s*(\d+)\]/gi;
  let totalDamage = 0;
  let dmgMatch: RegExpExecArray | null;
  while ((dmgMatch = dmgRe.exec(text)) !== null) {
    totalDamage += parseInt(dmgMatch[1]);
  }
  if (totalDamage > 0) damage = totalDamage;

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

  // Расширенный [ВРАГ: Имя, HP:N, AC:N, УРОН:dX+Y, НЕЖИТЬ]
  const enemyRe = /\[ВРАГ:\s*([^,\]]+),\s*HP:(\d+)(?:,\s*AC:(\d+))?(?:,\s*УРОН:([^\],]+))?(?:,\s*(НЕЖИТЬ))?\]/gi;
  let em: RegExpExecArray | null;
  while ((em = enemyRe.exec(text)) !== null) {
    const hp = parseInt(em[2]);
    newEnemies.push({
      name: em[1].trim(),
      maxHp: hp,
      hp,
      ac: em[3] ? parseInt(em[3]) : 12,
      damage: em[4] ? em[4].trim() : "d4+1",
      isUndead: !!em[5],
    });
  }

  const allyRe = /\[СОЮЗНИК:\s*([^,\]]+),\s*HP:(\d+)\]/gi;
  let am: RegExpExecArray | null;
  while ((am = allyRe.exec(text)) !== null) {
    const hp = parseInt(am[2]);
    newAllies.push({ name: am[1].trim(), maxHp: hp, hp });
  }

  const allyDmgRe = /\[СОЮЗНИК_УРОН:\s*([^,\]]+),\s*(\d+)\]/gi;
  let adm: RegExpExecArray | null;
  while ((adm = allyDmgRe.exec(text)) !== null) {
    allyDamages.push({ name: adm[1].trim(), damage: parseInt(adm[2]) });
  }

  const edRe = /\[ВРАГ_УРОН:\s*([^,\]]+),\s*(\d+)\]/gi;
  let ed: RegExpExecArray | null;
  while ((ed = edRe.exec(text)) !== null) enemyDamages.push({ name: ed[1].trim(), damage: parseInt(ed[2]) });

  const effRe = /\[ЭФФЕКТ:\s*([^,\]]+)(?:,\s*([^\]]+))?\]/gi;
  let efm: RegExpExecArray | null;
  while ((efm = effRe.exec(text)) !== null) {
    const name = efm[1].trim();
    const duration = (efm[2] || "").trim();
    if (name) newEffects.push({ name, duration });
  }

  if (/\[ИНИЦИАТИВА\]/i.test(text)) initiativeTrigger = true;
  if (/\[КОНЕЦ_БОЯ\]/i.test(text)) combatEnd = true;

  for (const line of text.trim().split("\n")) {
    const choiceMatch = line.trim().match(/^\*{0,2}(\d+)\.\s+(.+?)\*{0,2}$/);
    if (choiceMatch) { choices.push({ num: choiceMatch[1], text: choiceMatch[2].trim() }); continue; }
    if (TAG.test(line)) { TAG.lastIndex = 0; continue; }
    TAG.lastIndex = 0;
    narrativeLines.push(line);
  }

  return { narrative: narrativeLines.join("\n").trim(), choices, attackRequest, rollRequest, damage, newItem, newItems, upgrades, newEnemies, newAllies, allyDamages, enemyDamages, newEffects, initiativeTrigger, combatEnd };
}

function rollDice(sides: number) { return Math.floor(Math.random() * sides) + 1; }
function parseDiceSides(s: string) { const m = s.match(/d(\d+)/i); return m ? parseInt(m[1]) : 20; }

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  parsed?: Parsed;
};

type Enemy = {
  name: string;
  hp: number;
  maxHp: number;
  ac: number;
  damage: string;
  isUndead?: boolean;
};
type Ally = { name: string; hp: number; maxHp: number };
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

function InventoryPanel({
  inventory, effects, onUseItem, onShortRest, onLongRest, inCombat, canUsePotion, onClose,
}: {
  inventory: string[];
  effects: string[];
  onUseItem: (item: string, idx: number) => void;
  onShortRest: () => void;
  onLongRest: () => void;
  inCombat: boolean;
  canUsePotion: boolean;
  onClose: () => void;
}) {
  const restTitle = inCombat ? "Нельзя отдыхать в бою" : "";
  const potionDisabledTitle = inCombat && !canUsePotion ? "Зелье можно выпить только в свой ход — перед основным действием" : "";
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
                      disabled={inCombat && !canUsePotion}
                      title={potionDisabledTitle}
                      className="text-xs px-3 py-1 rounded-lg font-bold text-stone-900 ml-2 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: inCombat && !canUsePotion ? "#57534e" : "linear-gradient(135deg,#d97706,#92400e)" }}>
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
        <div className="mt-4 pt-4 border-t border-stone-800">
          <div className="text-stone-500 text-xs uppercase tracking-widest mb-2">Отдых</div>
          <div className="space-y-2">
            <button
              onClick={onShortRest}
              disabled={inCombat}
              title={restTitle}
              className="w-full text-left px-4 py-3 rounded-xl border border-stone-700 bg-stone-800 text-amber-100 text-sm font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed hover:border-amber-700/50"
              style={{ fontFamily: "serif" }}>
              ☕ Короткий отдых
              <span className="text-xs font-normal text-stone-500 block mt-0.5">Восстановить d6 HP · Слоты не вернутся</span>
            </button>
            <button
              onClick={onLongRest}
              disabled={inCombat}
              title={restTitle}
              className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: inCombat ? "#292524" : "linear-gradient(135deg,#d97706,#92400e)", color: inCombat ? "#57534e" : "#0c0a09", fontFamily: "serif" }}>
              🌙 Длинный отдых
              <span className="text-xs font-normal opacity-75 block mt-0.5">Полное HP · Все слоты заклинаний</span>
            </button>
          </div>
          {inCombat && <div className="text-stone-600 text-xs mt-2 text-center">Нельзя отдыхать в бою</div>}
        </div>
      </div>
    </div>
  );
}

function SpellPanel({
  character, spellSlots, onSpell, onClose,
}: {
  character: Character;
  spellSlots: { current: number; max: number };
  onSpell: (s: Spell) => void;
  onClose: () => void;
}) {
  const slots = Array.from({ length: spellSlots.max }, (_, i) => i < spellSlots.current);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div className="w-full max-w-md bg-stone-900 border border-stone-700 rounded-t-3xl p-6 pb-10 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-amber-400 font-bold" style={{ fontFamily: "serif" }}>✦ Заклинания</div>
          <button onClick={onClose} className="text-stone-500 text-xl leading-none">✕</button>
        </div>
        <div className="text-center text-2xl mb-4 tracking-widest" style={{ color: "#60a5fa" }}>
          {slots.map((on, i) => (<span key={i}>{on ? "✦" : "◇"}</span>))}
          <span className="text-stone-500 text-sm ml-2 align-middle">{spellSlots.current}/{spellSlots.max}</span>
        </div>
        {character.spells && character.spells.length > 0 && (
          <div>
            <div className="text-stone-500 text-xs uppercase tracking-widest mb-2">Заклинания (1 слот)</div>
            <div className="space-y-2">
              {character.spells.map((s, i) => {
                const hasSlots = spellSlots.current > 0;
                return (
                  <div key={i} className="bg-stone-800 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-amber-100 text-sm font-bold" style={{ fontFamily: "serif" }}>{s.name}</span>
                      <button
                        onClick={() => hasSlots && onSpell(s)}
                        disabled={!hasSlots}
                        className="text-xs px-3 py-1 rounded-lg font-bold flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: hasSlots ? "linear-gradient(135deg,#3b82f6,#1e40af)" : "#292524", color: hasSlots ? "#0c0a09" : "#57534e" }}>
                        {hasSlots ? "Применить" : "Нет слотов"}
                      </button>
                    </div>
                    <div className="text-stone-400 text-xs">{s.description}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// БОЕВЫЕ КНОПКИ ПО КЛАССАМ
// ─────────────────────────────────────────────────────────────────
function CombatBtn({
  onClick, disabled, children, variant = "primary", subtitle,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger" | "magic";
  subtitle?: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: "linear-gradient(135deg,#d97706,#92400e)", color: "#0c0a09" },
    secondary: { background: "#1c1917", color: "#fde68a", border: "1px solid #44403c" },
    danger: { background: "linear-gradient(135deg,#dc2626,#7f1d1d)", color: "#0c0a09" },
    magic: { background: "linear-gradient(135deg,#3b82f6,#1e40af)", color: "#0c0a09" },
  };
  const disabledStyle: React.CSSProperties = { background: "#292524", color: "#57534e", border: "1px solid #292524" };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:cursor-not-allowed"
      style={{ ...(disabled ? disabledStyle : styles[variant]), fontFamily: "serif" }}
    >
      <div>{children}</div>
      {subtitle && <div className="text-xs font-normal opacity-70 mt-0.5">{subtitle}</div>}
    </button>
  );
}

function CombatButtonsWarrior({
  berserkUsed, onAttack, onBerserk, onDefend, onFree,
}: {
  berserkUsed: boolean;
  onAttack: () => void;
  onBerserk: () => void;
  onDefend: () => void;
  onFree: () => void;
}) {
  return (
    <>
      <CombatBtn onClick={onAttack} variant="primary">⚔️ Атаковать (меч d8)</CombatBtn>
      <CombatBtn onClick={berserkUsed ? undefined : onBerserk} disabled={berserkUsed} variant="danger" subtitle={berserkUsed ? "Использован в этом бою" : "+2 урон / -2 AC на 2 хода"}>
        🔥 Берсерк
      </CombatBtn>
      <CombatBtn onClick={onDefend} variant="secondary" subtitle="+2 AC до следующего хода">
        🛡 Занять оборону
      </CombatBtn>
      <CombatBtn onClick={onFree} variant="secondary">✍ Свой вариант…</CombatBtn>
    </>
  );
}

function CombatButtonsRogue({
  canSneak, onAttack, onDodge, onFree,
}: {
  canSneak: boolean;
  onAttack: () => void;
  onDodge: () => void;
  onFree: () => void;
}) {
  return (
    <>
      <CombatBtn onClick={onAttack} variant="primary">🗡 Атаковать (кинжал d6)</CombatBtn>
      <CombatBtn onClick={canSneak ? onAttack : undefined} disabled={!canSneak} variant="danger" subtitle={canSneak ? "+d6 урона" : "Доступна после уклонения"}>
        🎯 Скрытая атака
      </CombatBtn>
      <CombatBtn onClick={onDodge} variant="secondary" subtitle="Враг бьёт с помехой">
        💨 Уклониться
      </CombatBtn>
      <CombatBtn onClick={onFree} variant="secondary">✍ Свой вариант…</CombatBtn>
    </>
  );
}

function CombatButtonsMage({
  spellSlots, showMini, spells, onAttack, onToggleSpells, onCastSpell, onDodge, onFree,
}: {
  spellSlots: { current: number; max: number };
  showMini: boolean;
  spells: Spell[];
  onAttack: () => void;
  onToggleSpells: () => void;
  onCastSpell: (s: Spell) => void;
  onDodge: () => void;
  onFree: () => void;
}) {
  const hasSlots = spellSlots.current > 0;
  return (
    <>
      <CombatBtn onClick={onAttack} variant="primary">🪄 Атаковать (посох d6)</CombatBtn>
      <CombatBtn
        onClick={hasSlots ? onToggleSpells : undefined}
        disabled={!hasSlots}
        variant="magic"
        subtitle={hasSlots ? `${spellSlots.current}/${spellSlots.max} слотов` : "Нет слотов"}
      >
        ✦ Заклинание {hasSlots ? (showMini ? "▾" : "→") : ""}
      </CombatBtn>
      {showMini && hasSlots && (
        <div className="space-y-1.5 pl-3 border-l-2 border-blue-900/60">
          {spells.map((s, i) => (
            <button
              key={i}
              onClick={() => onCastSpell(s)}
              className="w-full text-left px-3 py-2 rounded-lg bg-stone-900 border border-stone-700 hover:border-blue-700 transition-colors"
              style={{ fontFamily: "serif" }}
            >
              <div className="text-amber-100 text-sm font-bold">{s.name}</div>
              <div className="text-stone-500 text-xs">{s.description}</div>
            </button>
          ))}
        </div>
      )}
      <CombatBtn onClick={onDodge} variant="secondary" subtitle="Враг бьёт с помехой">
        💨 Уклониться
      </CombatBtn>
      <CombatBtn onClick={onFree} variant="secondary">✍ Свой вариант…</CombatBtn>
    </>
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

function DefeatedScreen({
  hasPotion, onUsePotion, onRetry, onMenu,
}: {
  hasPotion: boolean;
  onUsePotion: () => void;
  onRetry: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.9)" }}>
      <div className="max-w-sm w-full mx-4 text-center">
        <div className="text-6xl mb-4">💀</div>
        <div className="text-2xl font-bold text-red-400 mb-2" style={{ fontFamily: "serif" }}>Ты повержен</div>
        <div className="text-stone-400 text-sm mb-6">Силы покидают тебя. Тьма смыкается...</div>
        <div className="space-y-3">
          {hasPotion && (
            <button onClick={onUsePotion}
              className="w-full py-3 rounded-xl font-bold text-stone-900"
              style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}>
              🧪 Выпить зелье лечения
            </button>
          )}
          <button onClick={onRetry}
            className="w-full py-3 rounded-xl border border-stone-600 bg-stone-800 text-amber-100 font-bold"
            style={{ fontFamily: "serif" }}>
            ⚔️ Начать бой заново
          </button>
          <button onClick={onMenu}
            className="w-full py-3 rounded-xl border border-stone-700 bg-stone-900 text-stone-400 text-sm"
            style={{ fontFamily: "serif" }}>
            ← Вернуться в меню
          </button>
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

const FREE_INPUT_PLACEHOLDERS = [
  "Прыгнуть со стола на врага...",
  "Схватить факел и поджечь занавески...",
  "Попытаться договориться с главарём...",
  "Кинуть горсть пыли в глаза...",
  "Опрокинуть стол как щит...",
  "Крикнуть чтобы отвлечь внимание...",
];

function CombatPanel({
  character, berserkUsedThisCombat, didDodgeLastTurn, spellSlots,
  showSpellMini, spells, onAttackClick, onSpecial, onDefend, onToggleSpells, onCastSpell, onFreeInput,
}: {
  character: Character;
  berserkUsedThisCombat: boolean;
  didDodgeLastTurn: boolean;
  spellSlots: { current: number; max: number } | null;
  showSpellMini: boolean;
  spells: Spell[] | undefined;
  onAttackClick: () => void;
  onSpecial: () => void;
  onDefend: () => void;
  onToggleSpells: () => void;
  onCastSpell: (s: Spell) => void;
  onFreeInput: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        <button onClick={onAttackClick}
          className="flex flex-col items-center py-3 rounded-xl text-stone-900 font-bold active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}>
          <span className="text-xl">⚔️</span>
          <span className="text-xs mt-0.5">Атака</span>
        </button>

        {character.id === "warrior" && (
          <button onClick={berserkUsedThisCombat ? undefined : onSpecial}
            disabled={berserkUsedThisCombat}
            className="flex flex-col items-center py-3 rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-40"
            style={{
              background: berserkUsedThisCombat ? "#292524" : "linear-gradient(135deg,#dc2626,#7f1d1d)",
              color: berserkUsedThisCombat ? "#57534e" : "#0c0a09",
              fontFamily: "serif",
            }}>
            <span className="text-xl">🔥</span>
            <span className="text-xs mt-0.5">Берсерк</span>
          </button>
        )}
        {character.id === "rogue" && (
          <button onClick={didDodgeLastTurn ? onSpecial : undefined}
            disabled={!didDodgeLastTurn}
            className="flex flex-col items-center py-3 rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-40"
            style={{
              background: didDodgeLastTurn ? "linear-gradient(135deg,#dc2626,#7f1d1d)" : "#292524",
              color: didDodgeLastTurn ? "#0c0a09" : "#57534e",
              fontFamily: "serif",
            }}>
            <span className="text-xl">🎯</span>
            <span className="text-xs mt-0.5">Скрытая</span>
          </button>
        )}
        {character.id === "mage" && spellSlots && (
          <button onClick={spellSlots.current > 0 ? onToggleSpells : undefined}
            disabled={spellSlots.current === 0}
            className="flex flex-col items-center py-3 rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-40"
            style={{
              background: spellSlots.current > 0 ? "linear-gradient(135deg,#3b82f6,#1e40af)" : "#292524",
              color: spellSlots.current > 0 ? "#0c0a09" : "#57534e",
              fontFamily: "serif",
            }}>
            <span className="text-xl">✦</span>
            <span className="text-xs mt-0.5">{spellSlots.current}/{spellSlots.max}</span>
          </button>
        )}

        <button onClick={onDefend}
          className="flex flex-col items-center py-3 rounded-xl border border-stone-700 bg-stone-900 font-bold active:scale-95 transition-transform"
          style={{ color: "#fde68a", fontFamily: "serif" }}>
          <span className="text-xl">{character.id === "warrior" ? "🛡" : "💨"}</span>
          <span className="text-xs mt-0.5">{character.id === "warrior" ? "Оборона" : "Уклон"}</span>
        </button>

        <button onClick={onFreeInput}
          className="flex flex-col items-center py-3 rounded-xl border border-stone-600 bg-stone-950 font-bold active:scale-95 transition-transform"
          style={{ color: "#78716c", fontFamily: "serif" }}>
          <span className="text-xl">✍</span>
          <span className="text-xs mt-0.5">Своё...</span>
        </button>
      </div>

      {showSpellMini && spells && spells.map((s, i) => (
        <button key={i} onClick={() => onCastSpell(s)}
          className="w-full text-left px-3 py-2 rounded-lg bg-stone-900 border border-blue-900/60 hover:border-blue-700 transition-colors"
          style={{ fontFamily: "serif" }}>
          <div className="text-amber-100 text-sm font-bold">{s.name}</div>
          <div className="text-stone-500 text-xs">{s.description}</div>
        </button>
      ))}
    </div>
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
  const [allies, setAllies] = useState<Ally[]>([]);
  const [inCombat, setInCombat] = useState(false);
  const [pendingRoll, setPendingRoll] = useState<PendingRoll | null>(null);
  const [pendingInitiative, setPendingInitiative] = useState(false);
  const [freeInput, setFreeInput] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [showInventory, setShowInventory] = useState(false);
  const [showSpells, setShowSpells] = useState(false);
  const [spellSlots, setSpellSlots] = useState<{ current: number; max: number } | null>(null);
  const [berserkChargesLeft, setBerserkChargesLeft] = useState(0);
  const [berserkUsedThisCombat, setBerserkUsedThisCombat] = useState(false);
  const [didDodgeLastTurn, setDidDodgeLastTurn] = useState(false);
  const [defensiveStance, setDefensiveStance] = useState(false);
  const [showSpellMini, setShowSpellMini] = useState(false);
  const [selectingTarget, setSelectingTarget] = useState(false);
  const [freeInputPlaceholder] = useState(() => FREE_INPUT_PLACEHOLDERS[Math.floor(Math.random() * FREE_INPUT_PLACEHOLDERS.length)]);
  const [showDev, setShowDev] = useState(false);
  const [showDefeated, setShowDefeated] = useState(false);
  const combatStartSnapshotRef = useRef<{ hp: number; enemies: Enemy[]; allies: Ally[] } | null>(null);
  // Бонусное действие "выпито зелье" — копится здесь и приклеивается к следующему основному действию игрока.
  const pendingPotionInfoRef = useRef<string | null>(null);
  const devTaps = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    character: Character | null;
    hp: number;
    inventory: string[];
    effects: string[];
    enemies: Enemy[];
    allies: Ally[];
    messages: ChatMessage[];
    spellSlots: { current: number; max: number } | null;
    berserkChargesLeft: number;
    didDodgeLastTurn: boolean;
    defensiveStance: boolean;
  }>({ character: null, hp: 0, inventory: [], effects: [], enemies: [], allies: [], messages: [], spellSlots: null, berserkChargesLeft: 0, didDodgeLastTurn: false, defensiveStance: false });
  stateRef.current = { character, hp, inventory, effects, enemies, allies, messages, spellSlots, berserkChargesLeft, didDodgeLastTurn, defensiveStance };

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
    const slotsForPrompt = char.id === "mage" ? (stateRef.current.spellSlots ?? { current: 0, max: 0 }) : null;
    const res = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: buildSystemPrompt(char, currentHp, currentInv, currentEff, slotsForPrompt),
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

    if (parsed.damage) {
      newHp = Math.max(0, newHp - parsed.damage);
      setHp(newHp);
      if (newHp <= 0) setShowDefeated(true);
    }

    if (parsed.newItems?.length) {
      newInv = [...newInv, ...parsed.newItems];
      setInventory(newInv);
    } else if (parsed.newItem) {
      newInv = [...newInv, parsed.newItem];
      setInventory(newInv);
    }

    if (parsed.upgrades?.length) {
      let changed = false;
      for (const up of parsed.upgrades) {
        const fromLc = up.from.toLowerCase();
        const idx = newInv.findIndex(it => it.toLowerCase() === fromLc || it.toLowerCase().includes(fromLc));
        if (idx >= 0) {
          newInv = [...newInv.slice(0, idx), up.to, ...newInv.slice(idx + 1)];
          changed = true;
        } else {
          // если старого нет — просто добавим новый
          newInv = [...newInv, up.to];
          changed = true;
        }
      }
      if (changed) setInventory(newInv);
    }

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
            inferred.push({ name, hp, maxHp, ac: 12, damage: "d4+1" });
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
        const targetIdx = newEnemies.findIndex(e => e.hp > 0 && e.name.toLowerCase() === ed.name.toLowerCase());
        if (targetIdx >= 0) {
          newEnemies = newEnemies.map((e, i) =>
            i === targetIdx ? { ...e, hp: Math.max(0, e.hp - ed.damage) } : e
          );
        }
      }
      setEnemies(newEnemies);
    }

    // Союзники: добавление и урон
    if (parsed.newAllies?.length) {
      setAllies(prev => [...prev, ...parsed.newAllies.map(a => ({ ...a }))]);
    }
    if (parsed.allyDamages?.length) {
      setAllies(prev => {
        let next = [...prev];
        for (const ad of parsed.allyDamages) {
          const idx = next.findIndex(a => a.hp > 0 && a.name.toLowerCase() === ad.name.toLowerCase());
          if (idx >= 0) {
            next = next.map((a, i) => i === idx ? { ...a, hp: Math.max(0, a.hp - ad.damage) } : a);
          }
        }
        return next;
      });
    }

    if (parsed.combatEnd || (newEnemies.length > 0 && newEnemies.every(e => e.hp <= 0))) {
      const wasInCombat = currentEnemies.length > 0 || stateRef.current.enemies.length > 0;
      setInCombat(false);
      setEnemies([]);
      setAllies([]);
      // Сброс боевых состояний при окончании боя
      setBerserkChargesLeft(0);
      setBerserkUsedThisCombat(false);
      setDidDodgeLastTurn(false);
      setDefensiveStance(false);
      setSelectingTarget(false);
      setShowSpellMini(false);
      if (wasInCombat) {
        trackEvent("combat_ended", {
          characterId: stateRef.current.character?.id,
          messageNumber: stateRef.current.messages.length,
          playerHp: newHp,
        });
      }
    }

    let finalEffects = newEff;
    if (parsed.newEffects?.length) {
      const labels = parsed.newEffects.map(e => e.duration ? `${e.name} (${e.duration})` : e.name);
      finalEffects = [...newEff, ...labels];
      setEffects(finalEffects);
    }

    // При окончании боя — убрать эффект Берсерка из списка
    if (parsed.combatEnd || (newEnemies.length > 0 && newEnemies.every(e => e.hp <= 0))) {
      const cleaned = finalEffects.filter(e => !/берсерк/i.test(e));
      if (cleaned.length !== finalEffects.length) {
        finalEffects = cleaned;
        setEffects(cleaned);
      }
    }

    // При начале нового боя — сбросить уклонение, оборону и UI-флаги
    if (parsed.initiativeTrigger) {
      setDidDodgeLastTurn(false);
      setDefensiveStance(false);
      setSelectingTarget(false);
      setShowSpellMini(false);
    }

    return { newHp, newInv, newEff: finalEffects, newEnemies };
  }

  // Авто-бросок атаки: считает d20+mod+prof vs AC, формирует системное сообщение для DM,
  // отправляет его через handleChoice. Никакого RollBlock — всё мгновенно.
  async function executeAttackRoll(req: { weapon: string; dice: string; mod: number; ac: number; targetName?: string }) {
    const hitRoll = rollDice(20);
    const prof = PROFICIENCY_BONUS;
    const total = hitRoll + req.mod + prof;
    const crit = hitRoll === 20;
    const autoMiss = hitRoll === 1;
    const hit = !autoMiss && (crit || total >= req.ac);
    let damage = 0;
    if (hit) {
      const dmgDice = parseDiceSides(req.dice || "d6");
      damage = crit
        ? rollDice(dmgDice) + rollDice(dmgDice) + req.mod
        : rollDice(dmgDice) + req.mod;
      if (damage < 1) damage = 1;
    }
    const tname = req.targetName ? `, цель: ${req.targetName}` : "";
    const tagName = req.targetName ?? "Имя";
    let msg: string;
    if (autoMiss) {
      msg = `[Атака: ${req.weapon}${tname} — d20(1) АВТОПРОМАХ vs AC${req.ac}]`;
    } else if (crit) {
      msg = `[Атака: ${req.weapon}${tname} — d20(20) КРИТ vs AC${req.ac} → Урон врагу: ${damage}. Опиши удар и напиши [ВРАГ_УРОН: ${tagName}, ${damage}].]`;
    } else if (hit) {
      msg = `[Атака: ${req.weapon}${tname} — d20(${hitRoll})+mod(${req.mod})+prof(${prof})=${total} vs AC${req.ac} ПОПАЛ → Урон врагу: ${damage}. Опиши удар и напиши [ВРАГ_УРОН: ${tagName}, ${damage}].]`;
    } else {
      msg = `[Атака: ${req.weapon}${tname} — d20(${hitRoll})+mod(${req.mod})+prof(${prof})=${total} vs AC${req.ac} МИМО]`;
    }
    await handleChoice(msg);
  }

  async function processAndSetMessages(char: Character, currentHp: number, currentInv: string[], currentEff: string[], currentEnemies: Enemy[], reply: string, prevMessages: ChatMessage[]) {
    const parsed = parseDMResponse(reply);
    const newMsgs: ChatMessage[] = [...prevMessages, { role: "assistant", content: reply, parsed }];
    const { newHp, newInv, newEff } = applyParsed(parsed, currentHp, currentInv, currentEff, currentEnemies);
    setMessages(newMsgs);

    // Сохраняем снапшот в начале каждого боя — для кнопки "Начать заново"
    if (parsed.initiativeTrigger) {
      const snapEnemies = (parsed.newEnemies?.length ? parsed.newEnemies : stateRef.current.enemies).map(e => ({ ...e }));
      const snapAllies = stateRef.current.allies.map(a => ({ ...a }));
      combatStartSnapshotRef.current = { hp: newHp, enemies: snapEnemies, allies: snapAllies };
    }

    let autoAttackReq: { weapon: string; dice: string; mod: number; ac: number } | null = null;

    // В бою атаки идут только через боевые кнопки игрока — не от DM-инициированных [АТАКА:].
    // Если DM всё-таки прислал [АТАКА:] в бою (игнорируя промпт) — игнорируем тег, чтобы не
    // ломать порядок хода и не атаковать после победы в инициативе автоматически.
    const wasInCombat = stateRef.current.enemies.length > 0 || currentEnemies.length > 0;

    if (parsed.initiativeTrigger) {
      setPendingInitiative(true);
      setPendingRoll(null);
    } else if (parsed.attackRequest && !wasInCombat) {
      // Атака вне боя (например, скрытная атака из засады) — авто-бросок
      const mod = char.stats[char.weapon.stat] || 0;
      autoAttackReq = { ...parsed.attackRequest, mod };
      setPendingRoll(null);
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

    if (autoAttackReq) {
      // Запускаем авто-бросок асинхронно после возврата текущего тика, чтобы стейт успел примениться
      setTimeout(() => { void executeAttackRoll(autoAttackReq!); }, 0);
    }

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
    setAllies([]);
    setInCombat(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    setSpellSlots(char.spellSlots ? { ...char.spellSlots } : null);
    setBerserkChargesLeft(0);
    setBerserkUsedThisCombat(false);
    setDidDodgeLastTurn(false);
    setDefensiveStance(false);
    setShowSpellMini(false);
    setSelectingTarget(false);
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
    // В бою после КАЖДОГО действия игрока — добавляем системное правило
    // чтобы враги ОБЯЗАТЕЛЬНО атаковали в этом же ответе DM.
    // Исключение: само сообщение "[Инициатива выиграна: ...]" — там враги ещё не ходят,
    // ждём первого действия игрока.
    const isInitiativeWin = /Инициатива выиграна/i.test(choiceText);
    // Если до этого было выпито зелье как бонусное действие — приклеиваем его к
    // основному действию ОДНИМ запросом, чтобы DM описал и зелье, и атаку,
    // и только ПОСЛЕ этого враги отвечали.
    const potionInfo = pendingPotionInfoRef.current;
    pendingPotionInfoRef.current = null;
    const choiceWithPotion = potionInfo ? `${potionInfo}\n${choiceText}` : choiceText;
    const apiMessage = (inCombat || en.length > 0) && !isInitiativeWin
      ? `${choiceWithPotion}\n\n[СИСТЕМНОЕ ПРАВИЛО: После описания результата действия игрока — враги ОБЯЗАНЫ атаковать в этом же ответе. Каждый живой враг делает одну атаку. Используй [УРОН: X] для каждого попадания. Не жди следующего хода игрока. Не предлагай варианты 1-2-3.]`
      : choiceWithPotion;
    try {
      const reply = await callAPI(c, h, inv, eff, msgs, apiMessage);
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
    // В бою зелье можно пить ТОЛЬКО в свой ход и ТОЛЬКО перед основным действием.
    // Условия "свой ход": не идёт запрос (loading), не висит бросок и не идёт инициатива.
    if (inCombat && (loading || pendingRoll || pendingInitiative)) return;
    // Нельзя выпить второе зелье поверх ещё не использованного бонусного действия.
    if (inCombat && pendingPotionInfoRef.current) return;
    const heal = rollDice(6) + 2;
    const newHp = Math.min(c.maxHp, h + heal);
    setHp(newHp);
    setInventory(prev => prev.filter((_, i) => i !== idx));
    setShowInventory(false);
    if (inCombat) {
      // Бонусное действие: НЕ обращаемся к DM сейчас, иначе враги атакуют после описания зелья.
      // Применяем эффект локально, показываем серое системное сообщение, а информация
      // о зелье будет приклеена к следующему основному действию игрока (атака/уклонение/спецспособность).
      pendingPotionInfoRef.current = `[Бонусное действие перед основной атакой: игрок выпил зелье лечения, +${heal} HP (${newHp}/${c.maxHp}). Опиши глоток зелья ОДНИМ предложением, затем сразу опиши основное действие игрока, описанное ниже.]`;
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `🧪 Ты выпиваешь зелье. +${heal} HP. (${newHp}/${c.maxHp}) — теперь выбери основное действие.`,
        parsed: parseDMResponse(`✦ Бонусное действие: ты выпиваешь зелье лечения. +${heal} HP. (${newHp}/${c.maxHp}). Теперь выбери основное действие.`)
      }]);
      return;
    }
    setMessages(prev => [...prev, {
      role: "assistant",
      content: `Зелье выпито. +${heal} HP. (${newHp}/${c.maxHp})`,
      parsed: parseDMResponse(`✦ Ты выпиваешь зелье лечения. Тёплая волна прокатывается по телу. +${heal} HP. (${newHp}/${c.maxHp})`)
    }]);
  }

  // Использование зелья на экране поражения — лечит и продолжает бой
  function handleDefeatedUsePotion() {
    const { inventory: inv, character: c } = stateRef.current;
    if (!c) return;
    const potionIdx = inv.findIndex(i => i.toLowerCase().includes("зелье"));
    if (potionIdx < 0) return;
    const heal = rollDice(6) + 2;
    setHp(Math.min(c.maxHp, heal));
    setInventory(prev => prev.filter((_, i) => i !== potionIdx));
    setShowDefeated(false);
    setMessages(prev => [...prev, {
      role: "assistant",
      content: `🧪 Последним усилием ты выпиваешь зелье. +${heal} HP. Ты снова в строю.`,
      parsed: parseDMResponse(`🧪 Последним усилием ты выпиваешь зелье. +${heal} HP. Ты снова в строю.`),
    }]);
  }

  // Начать бой заново — восстанавливаем снапшот
  function handleDefeatedRetry() {
    const snap = combatStartSnapshotRef.current;
    const { character: c } = stateRef.current;
    if (!snap || !c) {
      setShowDefeated(false);
      return;
    }
    // Сначала очищаем (фикс: иначе двоятся враги/союзники), потом восстанавливаем в следующем тике
    setEnemies([]);
    setAllies([]);
    setShowDefeated(false);
    setBerserkChargesLeft(0);
    setBerserkUsedThisCombat(false);
    setDidDodgeLastTurn(false);
    setDefensiveStance(false);
    setSelectingTarget(false);
    setShowSpellMini(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    setTimeout(() => {
      setHp(snap.hp);
      setEnemies(snap.enemies.map(e => ({ ...e, hp: e.maxHp })));
      setAllies(snap.allies ? snap.allies.map(a => ({ ...a })) : []);
      setInCombat(true);
      void handleChoice(`[Игрок начинает бой заново — то же столкновение, исходные HP]`);
    }, 0);
  }

  function handleShortRest() {
    const { character: c, hp: h } = stateRef.current;
    if (!c || inCombat) return;
    const heal = rollDice(6);
    const newHp = Math.min(c.maxHp, h + heal);
    setHp(newHp);
    setShowInventory(false);
    setMessages(prev => [...prev, {
      role: "assistant",
      content: `✦ Короткий отдых. Восстановлено ${heal} HP. (${newHp}/${c.maxHp})`,
      parsed: parseDMResponse(`✦ Короткий отдых. Восстановлено ${heal} HP. (${newHp}/${c.maxHp})`)
    }]);
  }

  function handleLongRest() {
    const { character: c } = stateRef.current;
    if (!c || inCombat) return;
    setHp(c.maxHp);
    if (c.spellSlots) setSpellSlots({ current: c.spellSlots.max, max: c.spellSlots.max });
    setBerserkChargesLeft(0);
    setBerserkUsedThisCombat(false);
    setShowInventory(false);
    setMessages(prev => [...prev, {
      role: "assistant",
      content: `✦ Длинный отдых. HP и слоты полностью восстановлены.`,
      parsed: parseDMResponse(`✦ Длинный отдых. HP и слоты полностью восстановлены.`)
    }]);
  }

  // ── Боевые действия ───────────────────────────────────────────
  async function handleAttack(targetName?: string) {
    const { character: ch, enemies: en, berserkChargesLeft: bcl } = stateRef.current;
    if (!ch) return;
    setSelectingTarget(false);
    setDidDodgeLastTurn(false);
    let mod = ch.stats[ch.weapon.stat] || 0;
    if (bcl > 0) {
      mod += 2;
      setBerserkChargesLeft(prev => Math.max(0, prev - 1));
    }
    if (stateRef.current.defensiveStance) {
      setDefensiveStance(false);
    }
    const target = targetName
      ? en.find(e => e.hp > 0 && e.name === targetName)
      : en.find(e => e.hp > 0);
    const ac = target?.ac ?? 12;
    await executeAttackRoll({ weapon: ch.weapon.name, dice: ch.weapon.dice, mod, ac, targetName: target?.name });
  }

  async function handleBerserk() {
    setBerserkChargesLeft(2);
    setBerserkUsedThisCombat(true);
    setDefensiveStance(false);
    setDidDodgeLastTurn(false);
    setEffects(prev => [...prev, "Берсерк: +2 урон / -2 AC (2 хода)"]);
    await handleChoice(`[Активирован Берсерк: +2 к урону и -2 AC на 2 хода]`);
  }

  async function handleDefend() {
    setDefensiveStance(true);
    setDidDodgeLastTurn(false);
    await handleChoice(`[Занята оборона: +2 AC до следующего хода]`);
  }

  async function handleDodge() {
    setDidDodgeLastTurn(true);
    await handleChoice(`[Уклонение: враг атакует с помехой (два броска, меньший результат)]`);
  }

  async function handleSpell(s: Spell) {
    const slots = stateRef.current.spellSlots;
    if (!slots || slots.current <= 0) return;
    const { character: ch, enemies: en } = stateRef.current;
    if (!ch) return;
    setShowSpells(false);
    setShowSpellMini(false);
    setSpellSlots({ current: slots.current - 1, max: slots.max });
    setDidDodgeLastTurn(false);

    if (s.type === "attack") {
      // Огненный болт — атака со слотом, авто-бросок
      const statKey: Stat = s.stat ?? "int";
      const mod = ch.stats[statKey] || 0;
      const target = en.find(e => e.hp > 0);
      const ac = target?.ac ?? 12;
      await executeAttackRoll({ weapon: s.name, dice: s.dice ?? "d10", mod, ac, targetName: target?.name });
      return;
    }
    if (s.name === "Магическая стрела") {
      const dmg = rollDice(4) + rollDice(4) + rollDice(4) + 3;
      await handleChoice(`[Магическая стрела: ${dmg} гарантированного урона → напиши [ВРАГ_УРОН: Имя, ${dmg}]]`);
      return;
    }
    if (s.type === "defense") {
      await handleChoice(`[Применён Щит: +5 AC до следующего хода]`);
      return;
    }
    if (s.type === "control" && s.name === "Усыпление") {
      // Механика пула: 5d8. DM сам распределяет на врагов от слабого к сильному.
      const pool = rollDice(8) + rollDice(8) + rollDice(8) + rollDice(8) + rollDice(8);
      await handleChoice(`[Усыпление: пул ${pool} HP. Засыпают живые враги начиная с наименьшего HP пока пул не иссякнет (вычитай HP уснувшего из пула). Нежить, конструкты и демоны иммунны. Для каждого уснувшего напиши [ЭФФЕКТ: <Имя_врага>_спит, 2 раунда]. Спящие беспомощны но живы — спроси игрока что делать с каждым (добить, связать, допросить, обыскать) — это уже не активный бой со спящими, дай 3 варианта.]`);
      return;
    }
    if (s.type === "control") {
      await handleChoice(`[Применено заклинание контроля: ${s.name}. Spell Save DC 14.]`);
      return;
    }
    await handleChoice(`[Применено: ${s.name}]`);
  }

  function exitToMenu() {
    const { character: c, hp: h, inventory: inv, effects: eff, messages: msgs } = stateRef.current;
    if (c) doSave(c, h, inv, eff, msgs);
    setScreen("select");
    setMessages([]);
    setEnemies([]);
    setAllies([]);
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
    setAllies([]);
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
  const showCombatButtons = !loading && !freeInput && !pendingRoll && !pendingInitiative && !showDefeated && inCombat && !!character;
  const showChoices = !loading && !freeInput && !pendingRoll && !pendingInitiative && !inCombat && (parsed?.choices?.length ?? 0) > 0;
  const showFreeArea = freeInput && !loading;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>

      {showInventory && (
        <InventoryPanel
          inventory={inventory}
          effects={effects}
          onUseItem={handleUseItem}
          onShortRest={handleShortRest}
          onLongRest={handleLongRest}
          inCombat={inCombat}
          canUsePotion={showCombatButtons && !pendingPotionInfoRef.current}
          onClose={() => setShowInventory(false)}
        />
      )}
      {showSpells && character && spellSlots && (
        <SpellPanel
          character={character}
          spellSlots={spellSlots}
          onSpell={handleSpell}
          onClose={() => setShowSpells(false)}
        />
      )}
      {showDev && <DevPanel onJump={jumpToScene} onClose={() => setShowDev(false)} />}
      {showDefeated && (
        <DefeatedScreen
          hasPotion={inventory.some(i => i.toLowerCase().includes("зелье"))}
          onUsePotion={handleDefeatedUsePotion}
          onRetry={handleDefeatedRetry}
          onMenu={() => { setShowDefeated(false); exitToMenu(); }}
        />
      )}

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

          <div className="flex items-center gap-2 min-w-[60px] justify-end">
            {character?.id === "mage" && spellSlots && (
              <button
                onClick={() => setShowSpells(true)}
                className="text-sm tracking-widest hover:opacity-80 transition-opacity"
                style={{ color: "#60a5fa", fontFamily: "serif" }}
                title={`Слоты заклинаний: ${spellSlots.current}/${spellSlots.max}`}
              >
                {Array.from({ length: spellSlots.max }, (_, i) => i < spellSlots.current ? "✦" : "◇").join("")}
              </button>
            )}
            <div className="flex items-center gap-1.5">
              <div className="text-xs text-stone-500">HP</div>
              <div className="font-bold text-sm" style={{ color: character && hp / character.maxHp > 0.5 ? "#f87171" : character && hp / character.maxHp > 0.25 ? "#fbbf24" : "#ef4444" }}>{hp}</div>
              <div className="text-stone-600 text-xs">/{character?.maxHp}</div>
            </div>
          </div>
        </div>

        {inCombat && enemies.filter(e => e.hp > 0).length > 0 && (
          <div className="px-4 pb-2 space-y-1 border-t border-stone-800/40 pt-2">
            {enemies.filter(e => e.hp > 0).map((en, i) => (
              <EnemyHP key={i} name={en.name} hp={en.hp} maxHp={en.maxHp} />
            ))}
          </div>
        )}
        {inCombat && allies.filter(a => a.hp > 0).length > 0 && (
          <div className="px-4 pb-2 space-y-1">
            {allies.filter(a => a.hp > 0).map((ally, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-green-400 text-xs truncate max-w-[100px]">⚔ {ally.name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-stone-800 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.round(ally.hp / ally.maxHp * 100)}%`, background: "#4ade80" }} />
                </div>
                <span className="text-xs text-green-400 font-bold">{ally.hp}/{ally.maxHp}</span>
              </div>
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
              </div>
              {p.damage ? (
                <div className="flex justify-end">
                  <div className="rounded-xl border border-red-900/40 bg-stone-950/80 px-3 py-1.5 text-xs text-red-400 font-mono">
                    ⚡ Урон игроку: −{p.damage} HP
                  </div>
                </div>
              ) : null}
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
          {showCombatButtons && character && (
            <>
              <CombatPanel
                character={character}
                berserkUsedThisCombat={berserkUsedThisCombat}
                didDodgeLastTurn={didDodgeLastTurn}
                spellSlots={spellSlots}
                showSpellMini={showSpellMini}
                spells={character.spells}
                onAttackClick={() => {
                  const liveEnemies = stateRef.current.enemies.filter(e => e.hp > 0);
                  if (liveEnemies.length > 1) {
                    setSelectingTarget(true);
                  } else {
                    void handleAttack();
                  }
                }}
                onSpecial={() => {
                  if (character.id === "warrior") void handleBerserk();
                  else if (character.id === "rogue") void handleAttack(); // скрытая = атака после уклонения
                  else if (character.id === "mage") setShowSpellMini(v => !v);
                }}
                onDefend={() => {
                  if (character.id === "warrior") void handleDefend();
                  else void handleDodge();
                }}
                onToggleSpells={() => setShowSpellMini(v => !v)}
                onCastSpell={handleSpell}
                onFreeInput={() => {
                  trackEvent("free_input_used", { characterId: character.id, messageNumber: messages.length, inCombat: true });
                  setFreeInput(true);
                }}
              />
              {selectingTarget && (
                <div className="space-y-1 pl-2 border-l-2 border-amber-900/60">
                  <div className="text-xs text-stone-500 px-2">Выбери цель:</div>
                  {enemies.filter(e => e.hp > 0).map((en, i) => (
                    <button key={i}
                      onClick={() => { setSelectingTarget(false); void handleAttack(en.name); }}
                      className="w-full text-left px-3 py-2 rounded-lg bg-stone-900 border border-stone-700 hover:border-amber-700 text-amber-100 text-sm transition-colors"
                      style={{ fontFamily: "serif" }}>
                      {en.name}
                      <span className="text-stone-500 text-xs ml-2">{en.hp}/{en.maxHp} HP</span>
                    </button>
                  ))}
                  <button onClick={() => setSelectingTarget(false)}
                    className="w-full text-center px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors">
                    Отмена
                  </button>
                </div>
              )}
            </>
          )}

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
                placeholder={freeInputPlaceholder}
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
