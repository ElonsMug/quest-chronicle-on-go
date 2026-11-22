import { z } from "zod";
import type { Arc, ArcEnding } from "./arcs.ts";

const title = z.string().trim().min(3).max(100);
const prose = z.string().trim().min(12).max(550);

export const artifactPerks = ["resolve", "insight", "guard", "fortune"] as const;
export type ArtifactPerk = typeof artifactPerks[number];
export const finalePlanSchema = z.object({
  objective: z.object({ action: title, result: prose }).nullable(),
  recognition: z.object({ recipient: title, response: prose }).nullable(),
  artifact: z.object({ name: title, perk: z.enum(artifactPerks) }),
});

export type FinalePlan = z.infer<typeof finalePlanSchema>;
export type FinaleProgress = {
  outcome: ArcEnding["kind"];
  stage: "objective" | "recognition";
  epilogue: string;
};
export type FinaleAction = "objective" | "report" | "finish";
export const completionGold = 50;

const directGoals = new Set([
  "warrior-bandit-lord", "warrior-orc-warband", "warrior-fallen-knight", "mage-rogue-wizard",
]);

export function requiresObjectiveAction(templateId: string): boolean {
  return !directGoals.has(templateId);
}

export function beginFinale(arc: Arc, plan: FinalePlan, outcome: ArcEnding["kind"], epilogue: string): Arc {
  if (arc.completed || arc.finale) return arc;
  return {
    ...arc,
    bossDefeated: outcome === "victory",
    finalePlan: plan,
    finale: { outcome, epilogue, stage: plan.objective ? "objective" : "recognition" },
  };
}

export function advanceFinale(arc: Arc, action: FinaleAction): { arc: Arc; narration?: string } | null {
  const { finale, finalePlan: plan } = arc;
  if (arc.completed || !finale || !plan) return null;
  if (finale.stage === "objective") {
    if (action !== "objective" || !plan.objective) return null;
    return {
      arc: { ...arc, finale: { ...finale, stage: "recognition" } },
      narration: plan.objective.result,
    };
  }
  if (action !== "finish" && (action !== "report" || !plan.recognition)) return null;
  const narration = action === "report" ? plan.recognition?.response : undefined;
  const ending: ArcEnding = {
    kind: finale.outcome,
    epilogue: [narration, finale.epilogue].filter(Boolean).join("\n\n"),
    rewardGold: completionGold,
    artifact: plan.artifact,
  };
  return { arc: { ...arc, completed: true, ending }, narration };
}

export function collectFinds(previous: string[], inventoryBefore: readonly string[], inventoryAfter: readonly string[]) {
  const remaining = new Map<string, number>();
  for (const item of inventoryBefore) remaining.set(item, (remaining.get(item) ?? 0) + 1);
  const additions = inventoryAfter.filter(item => {
    const count = remaining.get(item) ?? 0;
    if (!count) return true;
    remaining.set(item, count - 1);
    return false;
  });
  return additions.length ? [...previous, ...additions] : previous;
}

export function fallbackFinalePlan(arc: Arc, t: (key: string) => string): FinalePlan {
  const mission = arc.templateId === "mage-demon-pact" ? "altar"
    : arc.templateId === "rogue-cult-shadow" || arc.templateId === "mage-lich-awakening" ? "ritual" : "evidence";
  const beneficiary = arc.templateId === "warrior-bandit-lord" ? "merchants"
    : arc.templateId === "mage-demon-pact" ? "villagers" : null;
  const key = (parseInt(arc.id.replace(/[^a-f0-9]/gi, "").slice(-2), 16) || 0) % artifactPerks.length;
  const perk = artifactPerks[key];
  const prefix = "arcCompleted.fallback";
  return {
    objective: requiresObjectiveAction(arc.templateId) ? {
      action: t(`${prefix}.objective.${mission}.action`),
      result: t(`${prefix}.objective.${mission}.result`),
    } : null,
    recognition: beneficiary ? {
      recipient: t(`${prefix}.recognition.${beneficiary}.recipient`),
      response: t(`${prefix}.recognition.${beneficiary}.response`),
    } : null,
    artifact: { name: t(`${prefix}.artifacts.${perk}`), perk },
  };
}
