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
import { createArcFromTemplate } from "./arcs";

type DMResponse = { text?: string };

function tryParseArcJson(raw: string): Partial<{
  goal: string;
  antagonist: string;
  setting: string;
  midBossName: string;
}> | null {
  // The model often wraps JSON in ```json fences or surrounding prose.
  // Pull out the first {...} block instead of trusting the whole string.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const pick = (k: string) =>
      typeof obj[k] === "string" && (obj[k] as string).trim().length > 0
        ? (obj[k] as string).trim()
        : undefined;
    return {
      goal: pick("goal"),
      antagonist: pick("antagonist"),
      setting: pick("setting"),
      midBossName: pick("midBossName"),
    };
  } catch {
    return null;
  }
}

export async function varyArcWithLLM(
  template: ArcTemplate,
  character: Character,
  language: "en" | "ru",
): Promise<Arc> {
  const fallback = createArcFromTemplate(template);

  const system = language === "ru"
    ? `Ты помогаешь Мастеру (DM) подготовить новое приключение. Твоя задача — взять скелет арки и переписать его в свежем варианте, сохранив структуру (мини-босс, финальный босс, та же тема), но с новыми именами, местом и подачей. Пиши строго на русском кириллицей. Верни ТОЛЬКО валидный JSON без markdown, без комментариев. Поля: goal (короткая цель героя, 1 предложение), antagonist (имя и краткое описание главного злодея), setting (где разворачивается арка), midBossName (имя мини-босса).`
    : `You help the Dungeon Master prepare a new adventure. Your task: take an arc skeleton and rewrite it as a fresh variant — keep the structure (mid-boss, final boss, same theme) but invent new names, place and flavor. Write in English. Return ONLY valid JSON, no markdown, no commentary. Fields: goal (1-sentence hero goal), antagonist (name + short description of main villain), setting (where the arc takes place), midBossName (mid-boss name).`;

  const userMsg = language === "ru"
    ? `Класс героя: ${character.name}.
Тон арки: ${template.toneHint}.

Скелет (перепиши с новыми именами/местом, СОХРАНИ суть):
- Цель: ${template.goal}
- Антагонист: ${template.antagonist}
- Сеттинг: ${template.setting}
- Мини-босс: ${template.midBossName}

Верни JSON: {"goal":"...","antagonist":"...","setting":"...","midBossName":"..."}`
    : `Hero class: ${character.name}.
Arc tone: ${template.toneHint}.

Skeleton (rewrite with new names/place, KEEP the essence):
- Goal: ${template.goal}
- Antagonist: ${template.antagonist}
- Setting: ${template.setting}
- Mid-boss: ${template.midBossName}

Return JSON: {"goal":"...","antagonist":"...","setting":"...","midBossName":"..."}`;

  try {
    const res = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as DMResponse;
    const raw = data.text ?? "";
    const parsed = tryParseArcJson(raw);
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
