// ─────────────────────────────────────────────────────────────────
// ARC VARIATION
// ─────────────────────────────────────────────────────────────────
// Asks the LLM to "flavor" a hardcoded arc template for the chosen
// hero — keeps the same skeleton (5 phases, mid-boss + boss), but
// rewrites the goal/antagonist/setting/midBossName in the active UI
// language so two playthroughs of the same template feel different.
//
// This call BLOCKS the start of the first scene (the player sees a
// short "Master is preparing the adventure..." overlay). On any
// failure — network, parse, missing field — we silently fall back
// to the bare template. The game must NEVER softlock here.
// ─────────────────────────────────────────────────────────────────

import type { Character } from "./types";
import type { Arc, ArcTemplate } from "./arcs";
import { createArcFromTemplate, parseArcVariation } from "./arcs";

import { requestDm } from "./api";

export async function varyArcWithLLM(
  template: ArcTemplate,
  character: Character,
  language: "en" | "ru",
): Promise<Arc> {
  const fallback = createArcFromTemplate(template, language);
  const { toneHint } = template.text[language];

  const system = language === "ru"
    ? `Ты помогаешь Мастеру (DM) подготовить новое приключение. Твоя задача — взять скелет арки и переписать его в свежем варианте, сохранив структуру (мини-босс, финальный босс, та же тема), но с новыми именами, местом и подачей. Пиши строго на русском кириллицей. Верни ТОЛЬКО валидный JSON без markdown, без комментариев. Поля: goal (короткая цель героя, 1 предложение), antagonist (имя и краткое описание главного злодея), setting (где разворачивается арка), midBossName (имя мини-босса).`
    : `You help the Dungeon Master prepare a new adventure. Your task: take an arc skeleton and rewrite it as a fresh variant — keep the structure (mid-boss, final boss, same theme) but invent new names, place and flavor. Write in English. Return ONLY valid JSON, no markdown, no commentary. Fields: goal (1-sentence hero goal), antagonist (name + short description of main villain), setting (where the arc takes place), midBossName (mid-boss name).`;

  const userMsg = language === "ru"
    ? `Класс героя: ${character.name}.
Тон арки: ${toneHint}.

Скелет (перепиши с новыми именами/местом, СОХРАНИ суть):
- Цель: ${fallback.goal}
- Антагонист: ${fallback.antagonist}
- Сеттинг: ${fallback.setting}
- Мини-босс: ${fallback.midBossName}

Верни JSON: {"goal":"...","antagonist":"...","setting":"...","midBossName":"..."}`
    : `Hero class: ${character.name}.
Arc tone: ${toneHint}.

Skeleton (rewrite with new names/place, KEEP the essence):
- Goal: ${fallback.goal}
- Antagonist: ${fallback.antagonist}
- Setting: ${fallback.setting}
- Mid-boss: ${fallback.midBossName}

Return JSON: {"goal":"...","antagonist":"...","setting":"...","midBossName":"..."}`;

  try {
    const raw = await requestDm({
      purpose: "arc-setup",
      system,
      messages: [{ role: "user", content: userMsg }],
    });
    const parsed = parseArcVariation(raw, language);
    if (!parsed) return fallback;
    return {
      ...fallback,
      goal: parsed.goal ?? fallback.goal,
      antagonist: parsed.antagonist ?? fallback.antagonist,
      setting: parsed.setting ?? fallback.setting,
      midBossName: parsed.midBossName ?? fallback.midBossName,
    };
  } catch {
    return fallback;
  }
}
