// ─────────────────────────────────────────────────────────────────
// Shared deps type passed to all SoloDnD sub-hooks.
// Keeping this in one place avoids huge per-hook prop lists and
// gives SoloDnD a single object to construct every render.
// ─────────────────────────────────────────────────────────────────

import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type {
  Character, ChatMessage, Enemy, Ally, PendingRoll, RollResult, Spell,
} from "@/game/types";
import type { GameState, GameAction } from "@/game/state";

export type PendingAction =
  | { type: "attack" }
  | { type: "sneak" }
  | { type: "spell"; spell: Spell }
  | null;

export type GameDeps = {
  // i18n
  t: TFunction;
  language: "en" | "ru";

  // reducer
  stateRef: MutableRefObject<GameState>;
  dispatch: Dispatch<GameAction>;

  // setter shims (from SoloDnD)
  setHp: (v: number) => void;
  setInventory: (v: string[] | ((prev: string[]) => string[])) => void;
  setEffects: (v: string[] | ((prev: string[]) => string[])) => void;
  setEnemies: (v: Enemy[]) => void;
  setAllies: (v: Ally[] | ((prev: Ally[]) => Ally[])) => void;
  setMessages: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setSpellSlots: (v: { current: number; max: number } | null) => void;
  setInCombat: (v: boolean) => void;
  setBerserkChargesLeft: (v: number | ((prev: number) => number)) => void;
  setBerserkUsedThisCombat: (v: boolean) => void;
  setDidDodgeLastTurn: (v: boolean) => void;
  setDefensiveStance: (v: boolean) => void;
  setSurpriseAdvantage: (v: "player" | null) => void;
  setArtifactBonus: (bonus: number) => void;

  // UI setters
  setLoading: Dispatch<SetStateAction<boolean>>;
  setPendingRoll: Dispatch<SetStateAction<PendingRoll | null>>;
  setPendingInitiative: Dispatch<SetStateAction<boolean>>;
  setFreeInput: Dispatch<SetStateAction<boolean>>;
  setFreeText: Dispatch<SetStateAction<string>>;
  setSelectingTarget: Dispatch<SetStateAction<boolean>>;
  setPendingAction: Dispatch<SetStateAction<PendingAction>>;
  setShowSpellMini: Dispatch<SetStateAction<boolean>>;
  setShowSpells: Dispatch<SetStateAction<boolean>>;
  setDefeatPending: Dispatch<SetStateAction<boolean>>;
  setDefeatDismissed: Dispatch<SetStateAction<boolean>>;
  setShowDefeated: Dispatch<SetStateAction<boolean>>;
  setNegotiationDeclined: Dispatch<SetStateAction<boolean>>;
  setScreen: Dispatch<SetStateAction<"select" | "game">>;
  setPreparingArc: Dispatch<SetStateAction<boolean>>;
  setArcCompletedDismissed: Dispatch<SetStateAction<boolean>>;

  // refs
  combatStartSnapshotRef: MutableRefObject<{ hp: number; enemies: Enemy[]; allies: Ally[] } | null>;
  pendingPotionInfoRef: MutableRefObject<string | null>;

  // live React closure values (current render)
  inCombat: boolean;
  loading: boolean;
  pendingRoll: PendingRoll | null;
  pendingInitiative: boolean;

  // cross-hook function refs (wired after all hooks initialize)
  handleChoiceRef: MutableRefObject<(text: string) => Promise<void>>;
  processAndSetMessagesRef: MutableRefObject<(
    char: Character, hp: number, inv: string[], eff: string[],
    enemies: Enemy[], reply: string, prevMessages: ChatMessage[],
  ) => Promise<ChatMessage[]>>;
  executeAttackRollRef: MutableRefObject<(req: {
    weapon: string; dice: string; mod: number; ac: number; targetName?: string;
  }) => Promise<void>>;
  executeEnemyAttacksRef: MutableRefObject<(
    attackerNames: string[], currentEnemies: Enemy[], playerAc: number,
  ) => Promise<string>>;
  applyParsedRef: MutableRefObject<(
    parsed: import("@/game/types").Parsed,
    hp: number, inv: string[], eff: string[], enemies: Enemy[],
  ) => { newHp: number; newInv: string[]; newEff: string[]; newEnemies: Enemy[] }>;
  doSaveRef: MutableRefObject<(
    char: Character, hp: number, inv: string[], eff: string[], msgs: ChatMessage[],
  ) => void>;

  // re-export RollResult for hook signatures
  _rollResult?: RollResult;
};
