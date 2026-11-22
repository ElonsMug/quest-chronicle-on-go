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

import { finalePlanSchema, type FinalePlan, type FinaleProgress } from "./arcFinale.ts";
import type { CharacterId, Enemy, Parsed } from "./types";

export type ArcPhase = 1 | 2 | 3 | 4 | 5;

export type ArcEnding = {
  kind: "victory" | "surrender";
  epilogue: string;
  rewardGold?: number;
  artifact?: FinalePlan["artifact"];
};

export type Arc = {
  id: string;
  templateId: string;

  // Narrative content (shown to DM in every prompt)
  goal: string;
  antagonist: string;
  setting: string;
  midBossName: string;
  successEpilogue?: string;
  finalePlan?: FinalePlan;
  finale?: FinaleProgress;

  // Progression (mutated by computeNextPhase)
  phase: ArcPhase;
  sceneCount: number;       // total scenes since arc start
  phaseSceneCount: number;  // scenes spent in current phase
  midBossDefeated: boolean;
  midBossBypassed?: boolean;
  bossDefeated: boolean;
  completed: boolean;
  ending?: ArcEnding;
};

export type ArcTemplate = {
  id: string;
  classId: CharacterId;
  text: Record<"en" | "ru", ArcTemplateText>;
};

type ArcTemplateText = Pick<Arc, "goal" | "antagonist" | "setting" | "midBossName"> & {
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
    text: {
      ru: {
        goal: "Сразить Лорда-разбойника, терроризирующего торговый тракт",
        antagonist: "Гарек Кровавый Топор, бывший наёмник, ставший главарём банды",
        setting: "Лесной тракт и заброшенная крепость на холме",
        midBossName: "Сержант Вепрь, правая рука Гарека",
        toneHint: "брутально, прямолинейно, тема предательства бывшего товарища",
      },
      en: {
        goal: "Defeat the bandit lord terrorizing the trade road",
        antagonist: "Garek Bloodaxe, a former mercenary turned bandit chief",
        setting: "A forest trade road and a deserted hilltop fortress",
        midBossName: "Sergeant Boar, Garek’s right hand",
        toneHint: "Gritty and direct, with betrayal by a former comrade",
      },
    },
  },
  {
    id: "warrior-orc-warband",
    classId: "warrior",
    text: {
      ru: {
        goal: "Остановить вторжение орочьего боевого отряда",
        antagonist: "Вождь Грумаш Железный Клык",
        setting: "Пограничная застава и орочий лагерь в ущелье",
        midBossName: "Шаман Угрук, правая рука вождя",
        toneHint: "героический фронтир, защита деревни, нарастающая угроза",
      },
      en: {
        goal: "Stop an invading orc warband",
        antagonist: "Chieftain Grumash Ironfang",
        setting: "A frontier outpost and an orc camp in a ravine",
        midBossName: "Shaman Ugruk, the chieftain’s right hand",
        toneHint: "Frontier heroism, a village to defend, and a mounting threat",
      },
    },
  },
  {
    id: "warrior-fallen-knight",
    classId: "warrior",
    text: {
      ru: {
        goal: "Низвергнуть павшего рыцаря, поднявшего нежить",
        antagonist: "Сэр Альбрехт, рыцарь, продавший душу за бессмертие",
        setting: "Разорённое аббатство и его склепы",
        midBossName: "Капитан Морр, командир мёртвой стражи",
        toneHint: "мрачное рыцарство, искупление, тема падшей чести",
      },
      en: {
        goal: "Bring down the fallen knight who raised the undead",
        antagonist: "Sir Albrecht, a knight who sold his soul for immortality",
        setting: "A ruined abbey and its crypts",
        midBossName: "Captain Morr, commander of the dead guard",
        toneHint: "Dark chivalry, redemption, and lost honor",
      },
    },
  },

  // ── ROGUE ──────────────────────────────────────────────────────
  {
    id: "rogue-thieves-guild",
    classId: "rogue",
    text: {
      ru: {
        goal: "Раскрыть и обезглавить тайную гильдию воров, подмявшую город",
        antagonist: "Шёлковая Вуаль — таинственный глава гильдии",
        setting: "Трущобы, канализация и роскошный особняк в верхнем городе",
        midBossName: "Финч Двуликий, сборщик дани гильдии",
        toneHint: "интриги, городская тень, маскарады и предательство",
      },
      en: {
        goal: "Expose and dismantle the secret thieves’ guild that has seized control of the city",
        antagonist: "The Silk Veil, the mysterious head of the guild",
        setting: "Slums, sewers, and a lavish mansion in the upper city",
        midBossName: "Two-Faced Finch, the guild’s tribute collector",
        toneHint: "Urban intrigue, masquerades, and betrayal",
      },
    },
  },
  {
    id: "rogue-cult-shadow",
    classId: "rogue",
    text: {
      ru: {
        goal: "Сорвать ритуал культа Багровой Луны до полуночи",
        antagonist: "Магистр Велиар, верховный жрец культа",
        setting: "Заброшенные шахты под городом и подземный храм",
        midBossName: "Иерофант Ноктис, проводник ритуала",
        toneHint: "оккультный детектив, гонка со временем, кровь и шёпот",
      },
      en: {
        goal: "Disrupt the Crimson Moon cult’s ritual before midnight",
        antagonist: "Magister Veliar, the cult’s high priest",
        setting: "Abandoned mines and an underground temple",
        midBossName: "Hierophant Noctis, who leads the ritual",
        toneHint: "Occult investigation, a race against time, and whispered threats",
      },
    },
  },
  {
    id: "rogue-noble-conspiracy",
    classId: "rogue",
    text: {
      ru: {
        goal: "Раскрыть заговор в королевском дворе и вырвать яд у его сердца",
        antagonist: "Граф Вальдемар, советник короля и кукловод",
        setting: "Дворцовые сады, бальный зал и тайные ходы под троном",
        midBossName: "Леди Селестия, отравительница графа",
        toneHint: "придворная интрига, маски, шёпот за гобеленами",
      },
      en: {
        goal: "Expose a royal court conspiracy and bring down its mastermind",
        antagonist: "Count Valdemar, a royal adviser who pulls the strings",
        setting: "Palace gardens, a ballroom, and secret passages beneath the throne",
        midBossName: "Lady Celestia, the count’s poisoner",
        toneHint: "Court intrigue, masks, and whispers behind tapestries",
      },
    },
  },

  // ── MAGE ───────────────────────────────────────────────────────
  {
    id: "mage-rogue-wizard",
    classId: "mage",
    text: {
      ru: {
        goal: "Остановить чародея-отступника, искажающего ткань реальности",
        antagonist: "Архимаг Зарекс, бывший наставник героя",
        setting: "Башня в Гиблых пустошах, где истончилась грань миров",
        midBossName: "Гомункул Эхо, творение Зарекса",
        toneHint: "тёмная академия, тема ученика и учителя, искажённая магия",
      },
      en: {
        goal: "Stop a renegade wizard who is warping reality",
        antagonist: "Archmage Zarex, the hero’s former mentor",
        setting: "A tower in the Blighted Wastes where the boundary between worlds has thinned",
        midBossName: "Echo the Homunculus, a creation of Zarex",
        toneHint: "Dark academia, a divided mentor and student, and distorted magic",
      },
    },
  },
  {
    id: "mage-lich-awakening",
    classId: "mage",
    text: {
      ru: {
        goal: "Не дать пробудиться древнему личу под городскими катакомбами",
        antagonist: "Лич Морвакс, заточённый три века назад",
        setting: "Подземный некрополь под старым городом",
        midBossName: "Хранитель печати, нежить-страж",
        toneHint: "мрачная археология, шёпот мёртвых, гонка против пробуждения",
      },
      en: {
        goal: "Prevent an ancient lich from awakening beneath the city catacombs",
        antagonist: "Morvax the Lich, imprisoned three centuries ago",
        setting: "An underground necropolis beneath the old city",
        midBossName: "The Seal Keeper, an undead guardian",
        toneHint: "Grim archaeology, whispers of the dead, and a race to prevent the awakening",
      },
    },
  },
  {
    id: "mage-demon-pact",
    classId: "mage",
    text: {
      ru: {
        goal: "Разорвать пакт ковена, призвавшего демона в смертный мир",
        antagonist: "Демон Азраил, привязанный кровью ковена",
        setting: "Отдалённая деревня, охваченная одержимостью",
        midBossName: "Матриарх Хелга, глава ковена",
        toneHint: "деревенский ужас, паранойя, цена запретной сделки",
      },
      en: {
        goal: "Break the coven’s pact that summoned a demon into the mortal world",
        antagonist: "Azrael, a demon bound by the coven’s blood",
        setting: "A remote village gripped by possession",
        midBossName: "Matriarch Helga, leader of the coven",
        toneHint: "Folk horror, paranoia, and the price of a forbidden bargain",
      },
    },
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
export function createArcFromTemplate(template: ArcTemplate, language: "en" | "ru"): Arc {
  const { goal, antagonist, setting, midBossName } = template.text[language];
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `arc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateId: template.id,
    goal,
    antagonist,
    setting,
    midBossName,
    phase: 1,
    sceneCount: 0,
    phaseSceneCount: 0,
    midBossDefeated: false,
    bossDefeated: false,
    completed: false,
  };
}

export function parseArcVariation(raw: string, language: "en" | "ru"): Partial<{
  goal: string;
  antagonist: string;
  setting: string;
  midBossName: string;
  successEpilogue: string;
  finalePlan: FinalePlan;
}> | null {
  // The model often wraps JSON in ```json fences or surrounding prose.
  // Pull out the first {...} block instead of trusting the whole string.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const pick = (key: string) => {
      const value = obj[key];
      if (typeof value !== "string") return undefined;
      const hasCyrillic = /\p{Script=Cyrillic}/u.test(value);
      const hasLatin = /\p{Script=Latin}/u.test(value);
      const matches = language === "ru" ? hasCyrillic && !hasLatin : hasLatin && !hasCyrillic;
      return matches ? value.trim() : undefined;
    };
    const successEpilogue = pick("successEpilogue")?.slice(0, 800);
    const candidate = finalePlanSchema.safeParse(obj.finalePlan);
    const plan = candidate.success ? candidate.data : undefined;
    const localized = plan && [plan.objective?.action, plan.objective?.result, plan.recognition?.recipient,
      plan.recognition?.response, plan.artifact.name].every(value => !value
        || (language === "ru" ? /\p{Script=Cyrillic}/u.test(value) : !/\p{Script=Cyrillic}/u.test(value)));
    return {
      goal: pick("goal"),
      antagonist: pick("antagonist"),
      setting: pick("setting"),
      midBossName: pick("midBossName"),
      ...(successEpilogue ? { successEpilogue } : {}),
      ...(localized ? { finalePlan: plan } : {}),
    };
  } catch {
    return null;
  }
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
//   • Phase 3 → 4 when the mid-boss is defeated or bypassed.
//   • Phase 4 → 5 once phaseSceneCount >= target AND not in combat.
//   • Phase 5 → completed after a resolved final encounter.
// ─────────────────────────────────────────────────────────────────
export function finalEncounterOutcome(
  arc: Arc | null, before: readonly Enemy[], after: readonly Enemy[], playerHp: number,
  encounterActive: boolean, combatEnd: Parsed["combatEndType"], acceptedSurrender: boolean,
): ArcEnding["kind"] | null {
  if (!arc || arc.completed || arc.phase !== 5 || playerHp <= 0 || encounterActive) return null;
  if (!before.some(enemy => enemy.isBoss) || !before.some(enemy => enemy.hp > 0)) return null;
  if (acceptedSurrender && combatEnd === "surrender" && before.some(enemy => enemy.isBoss && enemy.hp > 0)) {
    return "surrender";
  }
  return combatEnd === "victory" && after.length >= before.length && !after.some(enemy => enemy.hp > 0)
    ? "victory" : null;
}

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
      if (next.midBossDefeated || next.midBossBypassed) advance(4);
      break;
    case 4:
      if (next.phaseSceneCount >= PHASE_TARGET_SCENES[4] && !inCombat) advance(5);
      break;
    case 5:
      if (next.ending || (next.bossDefeated && !next.finale)) {
        next.completed = true;
      }
      break;
  }

  return next;
}
