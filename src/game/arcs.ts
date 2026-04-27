// ─────────────────────────────────────────────────────────────────
// ARC SYSTEM — narrative arc templates and progression logic
// ─────────────────────────────────────────────────────────────────
// An "arc" is one self-contained adventure: ~15 scenes, 5 phases,
// from hook to final boss. Templates are static skeletons; on game
// start we let the LLM "flavor" them for the chosen hero (handled
// elsewhere). Phase progression is computed deterministically here
// — we never trust the LLM to count scenes or decide when the boss
// arrives.
// ─────────────────────────────────────────────────────────────────

import type { CharacterId, Parsed } from "./types";

export type ArcPhase = 1 | 2 | 3 | 4 | 5;

export type Arc = {
  id: string;
  templateId: string;

  // Narrative content (shown to DM in every prompt)
  goal: string;
  antagonist: string;
  setting: string;
  midBossName: string;

  // Progression (mutated by computeNextPhase)
  phase: ArcPhase;
  sceneCount: number;       // total scenes since arc start
  phaseSceneCount: number;  // scenes spent in current phase
  midBossDefeated: boolean;
  bossDefeated: boolean;
  completed: boolean;
};

export type ArcTemplate = {
  id: string;
  classId: CharacterId;
  // Skeletons used as-is if LLM variation fails.
  goal: string;
  antagonist: string;
  setting: string;
  midBossName: string;
  // Hint passed to the LLM when asking for a flavored variation.
  toneHint: string;
};

// ─────────────────────────────────────────────────────────────────
// TEMPLATES — 3 per class, kept short and evocative.
// ─────────────────────────────────────────────────────────────────
export const ARC_TEMPLATES: ArcTemplate[] = [
  // ── WARRIOR ────────────────────────────────────────────────────
  {
    id: "warrior-bandit-lord",
    classId: "warrior",
    goal: "Сразить Лорда-разбойника, терроризирующего торговый тракт",
    antagonist: "Гарек Кровавый Топор, бывший наёмник, ставший главарём банды",
    setting: "Лесной тракт и заброшенная крепость на холме",
    midBossName: "Сержант Вепрь, правая рука Гарека",
    toneHint: "брутально, прямолинейно, тема предательства бывшего товарища",
  },
  {
    id: "warrior-orc-warband",
    classId: "warrior",
    goal: "Остановить вторжение орочьего боевого отряда",
    antagonist: "Вождь Грумаш Железный Клык",
    setting: "Пограничная застава и орочий лагерь в ущелье",
    midBossName: "Шаман Угрук, правая рука вождя",
    toneHint: "героический фронтир, защита деревни, нарастающая угроза",
  },
  {
    id: "warrior-fallen-knight",
    classId: "warrior",
    goal: "Низвергнуть павшего рыцаря, поднявшего нежить",
    antagonist: "Сэр Альбрехт, рыцарь, продавший душу за бессмертие",
    setting: "Разорённое аббатство и его склепы",
    midBossName: "Капитан Морр, командир мёртвой стражи",
    toneHint: "мрачное рыцарство, искупление, тема падшей чести",
  },

  // ── ROGUE ──────────────────────────────────────────────────────
  {
    id: "rogue-thieves-guild",
    classId: "rogue",
    goal: "Раскрыть и обезглавить тайную гильдию воров, подмявшую город",
    antagonist: "Шёлковая Вуаль — таинственный глава гильдии",
    setting: "Трущобы, канализация и роскошный особняк в верхнем городе",
    midBossName: "Финч Двуликий, сборщик дани гильдии",
    toneHint: "интриги, городская тень, маскарады и предательство",
  },
  {
    id: "rogue-cult-shadow",
    classId: "rogue",
    goal: "Сорвать ритуал культа Багровой Луны до полуночи",
    antagonist: "Магистр Велиар, верховный жрец культа",
    setting: "Заброшенные шахты под городом и подземный храм",
    midBossName: "Иерофант Ноктис, проводник ритуала",
    toneHint: "оккультный детектив, гонка со временем, кровь и шёпот",
  },
  {
    id: "rogue-noble-conspiracy",
    classId: "rogue",
    goal: "Раскрыть заговор в королевском дворе и вырвать яд у его сердца",
    antagonist: "Граф Вальдемар, советник короля и кукловод",
    setting: "Дворцовые сады, бальный зал и тайные ходы под троном",
    midBossName: "Леди Селестия, отравительница графа",
    toneHint: "придворная интрига, маски, шёпот за гобеленами",
  },

  // ── MAGE ───────────────────────────────────────────────────────
  {
    id: "mage-rogue-wizard",
    classId: "mage",
    goal: "Остановить чародея-отступника, искажающего ткань реальности",
    antagonist: "Архимаг Зарекс, бывший наставник героя",
    setting: "Башня в Гиблых пустошах, где истончилась грань миров",
    midBossName: "Гомункул Эхо, творение Зарекса",
    toneHint: "тёмная академия, тема ученика и учителя, искажённая магия",
  },
  {
    id: "mage-lich-awakening",
    classId: "mage",
    goal: "Не дать пробудиться древнему личу под городскими катакомбами",
    antagonist: "Лич Морвакс, заточённый три века назад",
    setting: "Подземный некрополь под старым городом",
    midBossName: "Хранитель печати, нежить-страж",
    toneHint: "мрачная археология, шёпот мёртвых, гонка против пробуждения",
  },
  {
    id: "mage-demon-pact",
    classId: "mage",
    goal: "Разорвать пакт ковена, призвавшего демона в смертный мир",
    antagonist: "Демон Азраил, привязанный кровью ковена",
    setting: "Отдалённая деревня, охваченная одержимостью",
    midBossName: "Матриарх Хелга, глава ковена",
    toneHint: "деревенский ужас, паранойя, цена запретной сделки",
  },
];

export function getTemplatesForClass(classId: CharacterId): ArcTemplate[] {
  return ARC_TEMPLATES.filter((t) => t.classId === classId);
}

export function pickRandomTemplate(classId: CharacterId): ArcTemplate {
  const list = getTemplatesForClass(classId);
  return list[Math.floor(Math.random() * list.length)];
}

// ─────────────────────────────────────────────────────────────────
// PHASE METADATA — used by prompt builder and UI.
// ─────────────────────────────────────────────────────────────────
export const PHASE_LABELS: Record<ArcPhase, string> = {
  1: "Завязка",
  2: "Расследование",
  3: "Мини-босс",
  4: "Подготовка",
  5: "Финал",
};

// Target scene count per phase. Used as soft thresholds for transitions.
// Total ~10 mandatory + buffer for free roleplay scenes.
export const PHASE_TARGET_SCENES: Record<ArcPhase, number> = {
  1: 1,
  2: 4,
  3: 1,
  4: 3,
  5: 1,
};

// ─────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────
export function createArcFromTemplate(template: ArcTemplate): Arc {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `arc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateId: template.id,
    goal: template.goal,
    antagonist: template.antagonist,
    setting: template.setting,
    midBossName: template.midBossName,
    phase: 1,
    sceneCount: 0,
    phaseSceneCount: 0,
    midBossDefeated: false,
    bossDefeated: false,
    completed: false,
  };
}

// ─────────────────────────────────────────────────────────────────
// PROGRESSION — pure function called after every DM response.
// ─────────────────────────────────────────────────────────────────
//
// Inputs:
//   arc       — current arc state
//   parsed    — parser output for the latest DM message (for boss flags)
//   inCombat  — whether combat is currently active
//
// Returns the next arc state (same reference if nothing changed).
//
// Rules:
//   • Every DM response = +1 scene (phaseSceneCount, sceneCount).
//   • Phase 1 → 2 after first scene resolved.
//   • Phase 2 → 3 once phaseSceneCount >= target AND not in combat
//     (so we transition between scenes, not mid-fight).
//   • Phase 3 → 4 only when arc.midBossDefeated flips true
//     (set externally when an enemy with isBoss dies in phase 3).
//   • Phase 4 → 5 once phaseSceneCount >= target AND not in combat.
//   • Phase 5 → completed when arc.bossDefeated flips true.
// ─────────────────────────────────────────────────────────────────
export function computeNextArc(
  arc: Arc,
  _parsed: Parsed | null,
  inCombat: boolean,
): Arc {
  if (arc.completed) return arc;

  const next: Arc = {
    ...arc,
    sceneCount: arc.sceneCount + 1,
    phaseSceneCount: arc.phaseSceneCount + 1,
  };

  const advance = (to: ArcPhase) => {
    next.phase = to;
    next.phaseSceneCount = 0;
  };

  switch (next.phase) {
    case 1:
      if (next.phaseSceneCount >= PHASE_TARGET_SCENES[1]) advance(2);
      break;
    case 2:
      if (next.phaseSceneCount >= PHASE_TARGET_SCENES[2] && !inCombat) advance(3);
      break;
    case 3:
      if (next.midBossDefeated) advance(4);
      break;
    case 4:
      if (next.phaseSceneCount >= PHASE_TARGET_SCENES[4] && !inCombat) advance(5);
      break;
    case 5:
      if (next.bossDefeated) {
        next.completed = true;
      }
      break;
  }

  return next;
}
