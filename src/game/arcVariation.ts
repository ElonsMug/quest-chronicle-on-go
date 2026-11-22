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

import { fallbackFinalePlan, requiresObjectiveAction } from "./arcFinale";
import i18n from "@/i18n";
import { requestDm } from "./api";

export async function varyArcWithLLM(
  template: ArcTemplate,
  character: Character,
  language: "en" | "ru",
): Promise<Arc> {
  const base = createArcFromTemplate(template, language);
  const defaultPlan = fallbackFinalePlan(base, i18n.getFixedT(language));
  const fallback = { ...base, finalePlan: defaultPlan };
  const { toneHint } = template.text[language];

  const system = [
    "Prepare a fresh version of an adventure for a solo D&D hero. Keep the same structure, with new names, setting, and details.",
    language === "ru" ? "Write all values in Russian Cyrillic." : "Write all values in English.",
    "Return JSON only with goal, antagonist, setting, midBossName, successEpilogue and finalePlan.",
    'finalePlan uses {"objective":null or {"action":"player action","result":"result of the action"},"recognition":null or {"recipient":"an interested NPC or group","response":"their personal thanks after the hero reports back"},"artifact":{"name":"unique short name suited to this adventure","perk":"resolve|insight|guard|fortune"}}.',
    "If the objective needs a deliberate act after the opponent is subdued, describe that act. For an altar include its actual destruction as the player action. If neutralizing the boss fulfills the whole goal, use null. Choose an optional beneficiary with a clear reason to thank the hero; establish them during this adventure.",
    "Use only one of resolve, insight, guard, fortune for the artifact perk. Never promise a sum of gold or invent the effect of the artifact in any prose.",
    "The goal is one sentence. Give the main enemy a name and brief description.",
    "Prepare the successful epilogue in 2–3 sentences. Describe the impact after all required player actions have taken place; do not make a choice for the player or describe an optional return.",
    "The ending must fit victory by force or accepted surrender. Do not assume specific loot, secondary choices, or whether the opponent lives.",
  ].join(" ");
  const userMsg = JSON.stringify({
    heroClass: character.name, heroBackstory: character.backstory, tone: toneHint,
    goal: fallback.goal, antagonist: fallback.antagonist, setting: fallback.setting, midBossName: fallback.midBossName,
  });

  try {
    const raw = await requestDm({
      purpose: "arc-setup",
      system,
      messages: [{ role: "user", content: userMsg }],
    });
    const parsed = parseArcVariation(raw, language);
    if (!parsed) return fallback;
    const plan = parsed.goal ? parsed.finalePlan : undefined;
    const finalePlan = plan ? { ...plan,
      objective: requiresObjectiveAction(template.id) ? plan.objective ?? defaultPlan.objective : plan.objective,
      recognition: plan.recognition ?? defaultPlan.recognition,
    } : defaultPlan;
    return {
      ...fallback,
      goal: parsed.goal ?? fallback.goal,
      antagonist: parsed.antagonist ?? fallback.antagonist,
      setting: parsed.setting ?? fallback.setting,
      midBossName: parsed.midBossName ?? fallback.midBossName,
      successEpilogue: parsed.goal ? parsed.successEpilogue : undefined,
      finalePlan,
    };
  } catch {
    return fallback;
  }
}
