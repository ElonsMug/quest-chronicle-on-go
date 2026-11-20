import type { GameState } from "./state";
import type { PendingCombatTurn } from "./combatTurn";
import type { Parsed, PendingRoll } from "./types";

type ReportContext = {
  language: "en" | "ru";
  activeTab: "story" | "character" | "inventory" | "journal";
  loading: boolean;
  pendingRoll: PendingRoll | null;
  pendingInitiative: boolean;
  showCombatButtons: boolean;
  showNegotiation: boolean;
  selectingTarget: boolean;
  freeInputOpen: boolean;
  freeChoiceAvailable: boolean;
  defeatPending: boolean;
  choiceSourceMessageIndex: number | null;
  displayedChoices: Parsed["choices"];
  alternativeClueLead?: string | null;
  pendingCombatTurn?: PendingCombatTurn | null;
};

export function buildSessionReport(game: GameState, context: ReportContext, exportedAt = new Date()) {
  return {
    format: "solo-dnd-session-report",
    version: 1,
    exportedAt: exportedAt.toISOString(),
    game,
    interface: context,
  };
}

export function downloadSessionReport(game: GameState, context: ReportContext) {
  const report = buildSessionReport(game, context);
  const file = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `solo-dnd-session-${report.exportedAt.replace(/[.:]/g, "-")}.json`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
