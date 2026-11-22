// ─────────────────────────────────────────────────────────────────
// useGameSession — lifecycle: start/save/exit/rest/items.
// ─────────────────────────────────────────────────────────────────

import i18n from "@/i18n";
import { useState } from "react";
import type { Arc } from "@/game/arcs";
import { rollDice } from "@/game/dice";
import { isPotion } from "@/game/inventory";
import { parseDMResponse } from "@/game/parser";
import { callDM, isDmUnavailable } from "@/game/api";
import { pickRandomTemplate } from "@/game/arcs";
import { varyArcWithLLM } from "@/game/arcVariation";
import { trackEvent } from "@/lib/analytics";
import type { Character, ChatMessage } from "@/game/types";
import type { GameDeps } from "./useGameDeps";

export function useGameSession(deps: GameDeps) {
  const {
    t, language, stateRef, dispatch,
    setHp, setInventory, setMessages, setEnemies, setAllies, setInCombat,
    setSelectingTarget, setPendingAction, setShowSpellMini,
    setLoading, setPendingRoll, setPendingInitiative, setPendingTurn,
    setScreen, setPreparingArc, setArcCompletedDismissed,
    setShowDefeated, setDefeatPending, setDefeatDismissed, setShowSpells,
    setFreeInput, setFreeText, setNegotiationDeclined,
    inCombat, loading, pendingRoll, pendingInitiative,
    pendingPotionInfoRef, combatCheckpointRef, needsCombatCheckpointRef,
  } = deps;

  const [openingRetry, setOpeningRetry] = useState<{ char: Character; arc: Arc; prompt: string } | null>(null);

  function doSave(
    char: Character, currentHp: number, currentInv: string[],
    currentEff: string[], msgs: ChatMessage[],
  ) {
    if (typeof window === "undefined") return;
    const recent = msgs.filter(m => m.role === "assistant").slice(-3)
      .map(m => (m.parsed?.narrative || m.content).slice(0, 100)).join(" → ");
    const save = {
      savedAt: new Date().toISOString(),
      locale: language,
      character: { id: char.id, name: char.name, emoji: char.emoji },
      hp: currentHp, maxHp: char.maxHp,
      inventory: currentInv, effects: currentEff,
      plotSummary: recent || "Adventure begins",
      messageCount: msgs.length,
    };
    try { window.localStorage.setItem("dnd_save_v3", JSON.stringify(save)); } catch { /* noop */ }
    trackEvent("session_saved", { characterId: char.id, messageNumber: msgs.length });
  }

  async function startGame(char: Character, customPrompt?: string) {
    setOpeningRetry(null);
    setShowDefeated(false);
    setDefeatPending(false);
    setDefeatDismissed(false);
    setNegotiationDeclined(false);
    setFreeInput(false);
    setFreeText("");
    setPendingAction(null);
    setShowSpells(false);
    pendingPotionInfoRef.current = null;
    setPendingTurn(null);
    combatCheckpointRef.current = null;
    needsCombatCheckpointRef.current = false;
    const startInv = [...char.startItems];
    const template = pickRandomTemplate(char.id);
    setScreen("game");
    setPreparingArc(true);
    setArcCompletedDismissed(false);
    const arc = await varyArcWithLLM(template, char, language);
    setPreparingArc(false);
    dispatch({ type: "START_GAME", character: char, startInventory: startInv, arc });
    dispatch({ type: "RESET_BOSS_FLAGS" });
    setPendingRoll(null);
    setPendingInitiative(false);
    setShowSpellMini(false);
    setSelectingTarget(false);
    trackEvent("game_started", {
      characterId: char.id,
      messageNumber: 0,
      characterName: char.name,
      arcTemplateId: template.id,
    });
    await loadOpening(char, arc, customPrompt || t("dm.startPrompt"));
  }

  async function loadOpening(char: Character, arc: Arc, prompt: string) {
    if (deps.turnRequestInFlight.current) return;
    deps.turnRequestInFlight.current = true;
    setLoading(true);
    setOpeningRetry(null);
    const startInv = [...char.startItems];
    try {
      const reply = await callDM({
        character: char,
        hp: char.hp,
        inventory: startInv,
        effects: [],
        history: [],
        userMessage: prompt,
        spellSlots: char.spellSlots ?? null,
        language,
        arc,
        gold: char.startGold,
        ac: char.ac,
        artifactBonus: 0,
        silentFallback: t("dm.silent"),
      });
      if (!reply.trim() || reply === t("dm.silent")) throw new Error("Empty opening scene");
      await deps.processAndSetMessagesRef.current(char, char.hp, startInv, [], [], reply, []);
    } catch (error) {
      const text = t(isDmUnavailable(error) ? "dm.masterUnavailableOpening" : "dm.connectionError");
      setMessages([{ role: "assistant", source: "client", content: text, parsed: parseDMResponse(text) }]);
      setOpeningRetry({ char, arc, prompt });
    } finally {
      deps.turnRequestInFlight.current = false;
      setLoading(false);
    }
  }

  async function handleStartNewArc() {
    const ch = stateRef.current.character;
    if (!ch) return;
    setArcCompletedDismissed(true);
    await startGame(ch);
  }

  function exitToMenu() {
    if (deps.turnRequestInFlight.current) return;
    setOpeningRetry(null);
    setPendingTurn(null);
    combatCheckpointRef.current = null;
    needsCombatCheckpointRef.current = false;
    const { character: c, hp: h, inventory: inv, effects: eff, messages: msgs } = stateRef.current;
    if (c) doSave(c, h, inv, eff, msgs);
    dispatch({ type: "RESET_TO_MENU" });
    setScreen("select");
    setPendingRoll(null);
    setPendingInitiative(false);
  }

  function handleShortRest() {
    const { character: c, hp: h } = stateRef.current;
    if (!c || inCombat || deps.loading || deps.pendingTurn || deps.turnRequestInFlight.current) return;
    const newHp = Math.min(c.maxHp, h + rollDice(6));
    const heal = newHp - h;
    setHp(newHp);
    const text = t("combat.shortRestNarrative", { heal, hp: newHp, max: c.maxHp });
    setMessages(prev => [...prev, {
      role: "assistant", source: "client", content: text, parsed: parseDMResponse(text),
    }]);
  }

  function handleLongRest() {
    const { character: c } = stateRef.current;
    if (!c || inCombat || deps.loading || deps.pendingTurn || deps.turnRequestInFlight.current) return;
    dispatch({
      type: "LONG_REST",
      hp: c.maxHp,
      spellSlots: c.spellSlots ? { current: c.spellSlots.max, max: c.spellSlots.max } : null,
    });
    const text = t("combat.longRestNarrative");
    setMessages(prev => [...prev, {
      role: "assistant", source: "client", content: text, parsed: parseDMResponse(text),
    }]);
  }

  function handleUseItem(_item: string, idx: number) {
    const { hp: h, character: c } = stateRef.current;
    if (!c || deps.pendingTurn || deps.turnRequestInFlight.current) return;
    if (inCombat && (loading || pendingRoll || pendingInitiative)) return;
    if (inCombat && pendingPotionInfoRef.current) return;
    const newHp = Math.min(c.maxHp, h + rollDice(6) + 2);
    const heal = newHp - h;
    setHp(newHp);
    setInventory(prev => prev.filter((_, i) => i !== idx));

    if (inCombat) {
      pendingPotionInfoRef.current = i18n.t("system.potionBonusAction", { heal, hp: newHp, max: c.maxHp });
      const narrativeText = t("combat.potionUsed", { heal, hp: newHp, max: c.maxHp });
      const parsedText = t("combat.potionUsedNarrative", { heal, hp: newHp, max: c.maxHp });
      setMessages(prev => [...prev, {
        role: "assistant", source: "client", content: narrativeText, parsed: parseDMResponse(parsedText),
      }]);
      return;
    }
    const narrativeText = t("combat.potionOutOfCombat", { heal, hp: newHp, max: c.maxHp });
    const parsedText = t("combat.potionOutOfCombatNarrative", { heal, hp: newHp, max: c.maxHp });
    setMessages(prev => [...prev, {
      role: "assistant", source: "client", content: narrativeText, parsed: parseDMResponse(parsedText),
    }]);
  }

  async function handleContinueStory() {
    if (!stateRef.current.character || stateRef.current.hp > 0 || deps.loading || deps.pendingTurn || deps.turnRequestInFlight.current) return;
    combatCheckpointRef.current = null;
    needsCombatCheckpointRef.current = false;
    setShowDefeated(false);
    setDefeatPending(false);
    setDefeatDismissed(true);
    setSelectingTarget(false);
    setPendingAction(null);
    setShowSpellMini(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    setEnemies([]);
    setAllies([]);
    setInCombat(false);
    await deps.handleChoiceRef.current(i18n.t("system.playerDefeatedNarrative"));
  }

  function handleDefeatedRetry() {
    const checkpoint = combatCheckpointRef.current;
    if (!checkpoint || !stateRef.current.inCombat || loading) return;
    setPendingTurn(null);

    const content = t("defeated.restarted");
    dispatch({
      type: "RESTORE_COMBAT_CHECKPOINT",
      checkpoint,
      restartNote: { role: "assistant", source: "client", content, parsed: parseDMResponse(content) },
    });
    setShowDefeated(false);
    setDefeatPending(false);
    setDefeatDismissed(false);
    setSelectingTarget(false);
    setPendingAction(null);
    setShowSpellMini(false);
    setShowSpells(false);
    setFreeInput(false);
    setFreeText("");
    setNegotiationDeclined(false);
    pendingPotionInfoRef.current = null;
    setPendingRoll(checkpoint.pendingRoll);
    setPendingInitiative(checkpoint.pendingInitiative);
  }

  function handleDefeatedUsePotion() {
    const { inventory: inv, character: c } = stateRef.current;
    if (!c) return;
    const potionIdx = inv.findIndex(isPotion);
    if (potionIdx < 0) return;
    const heal = rollDice(6) + 2;
    setHp(Math.min(c.maxHp, heal));
    setInventory(prev => prev.filter((_, i) => i !== potionIdx));
    setShowDefeated(false);
    setDefeatPending(false);
    setDefeatDismissed(false);
    const text = t("combat.defeatedRescue", { heal });
    setMessages(prev => [...prev, {
      role: "assistant", source: "client", content: text, parsed: parseDMResponse(text),
    }]);
  }

  return {
    doSave, startGame, handleStartNewArc, exitToMenu,
    retryOpening: openingRetry ? () => loadOpening(openingRetry.char, openingRetry.arc, openingRetry.prompt) : null,
    handleShortRest, handleLongRest, handleUseItem,
    handleContinueStory, handleDefeatedRetry, handleDefeatedUsePotion,
  };
}
