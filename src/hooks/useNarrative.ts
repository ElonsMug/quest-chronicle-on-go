// ─────────────────────────────────────────────────────────────────
// useNarrative — extracts handleChoice, handleRollResult,
// handleInitiativeResult, processAndSetMessages, applyParsed.
// All cross-hook calls go through deps.*Ref refs to avoid cycles.
// ─────────────────────────────────────────────────────────────────

import { combatReference, findCombatantIndex } from "@/game/combatReferences";
import { applyPlayerAttackResult, resolveDisengagement, stripEnemyAttackRolls, withdrawingEnemies } from "@/game/combatTurn";
import { turnMessages, type TurnResolution } from "@/game/pendingTurn";
import { canSettleGold, currentSceneMessageIndex, getSocialFailure, stagePaidOffer } from "@/game/sceneMessages";
import type { StoryChoice } from "@/game/abilityChecks";
import { isPotion } from "@/game/inventory";
import { balanceEnemy } from "@/game/enemyBalance";
import { hasScoutKitBonus, isScoutKit, scoutKitBonus, scoutKitName, spendScoutKit, vendorPrice, type VendorPurchase } from "@/game/vendor";
import { combatLootItemName, earnedCombatReward, isCombatLootItem, plannedCombatReward, type CombatReward } from "@/game/combatLoot";
import i18n from "@/i18n";
import type {
  Character, ChatMessage, Enemy, Parsed, RollResult,
} from "@/game/types";
import { parseDMResponse } from "@/game/parser";
import { reportLanguageLeaks } from "@/game/langGuard";
import { callDM, isDmUnavailable } from "@/game/api";
import { advanceFinale, beginFinale, fallbackFinalePlan, type FinaleAction } from "@/game/arcFinale";
import { computeNextArc, finalEncounterOutcome, type Arc } from "@/game/arcs";
import { trackEvent } from "@/lib/analytics";
import type { GameDeps } from "./useGameDeps";

type ChoiceContext = TurnResolution & {
  balanceAfterTransaction?: number;
  transactionAmount?: number;
  abilityRoll?: ChatMessage["abilityRoll"];
  vendorPurchase?: { kind: VendorPurchase; tip: string };
};

export function useNarrative(deps: GameDeps) {
  const {
    t, language, stateRef, dispatch,
    setHp, setInventory, setEnemies, setAllies, setMessages,
    setEffects, setInCombat, setBerserkChargesLeft, setBerserkUsedThisCombat,
    setDidDodgeLastTurn, setDefensiveStance, setSelectingTarget,
    setPendingAction, setShowSpellMini, setNegotiationDeclined,
    setSurpriseAdvantage,
    setLoading, setPendingRoll, setPendingInitiative,
    setFreeInput, setFreeText, setDefeatPending, setDefeatDismissed,
    setShowDefeated, combatCheckpointRef, needsCombatCheckpointRef, pendingPotionInfoRef,
    inCombat, pendingTurn, setPendingTurn, turnRequestInFlight,
  } = deps;

  function scoutKitModifier(skill: string | undefined, inventory: string[], inCombat: boolean) {
    return !inCombat && hasScoutKitBonus(inventory, skill)
      ? { scoutKit: true as const, bonus: scoutKitBonus }
      : { bonus: 0 };
  }

  function applyParsed(
    parsed: Parsed, currentHp: number, currentInv: string[],
    currentEff: string[], currentEnemies: Enemy[],
  ) {
    let newHp = currentHp;
    let newInv = [...currentInv];
    const newEff = [...currentEff];
    let newEnemies = [...currentEnemies];

    if (parsed.damage) {
      const ch = stateRef.current.character;
      let incoming = parsed.damage;
      const livingEnemies = currentEnemies.filter((e) => e.hp > 0);
      const bossPresent = livingEnemies.some((e) => e.isBoss);
      if (ch && !bossPresent && newHp > ch.maxHp * 0.5) {
        const cap = Math.max(1, Math.floor(ch.maxHp * 0.6));
        if (incoming > cap) incoming = cap;
      }
      newHp = Math.max(0, newHp - incoming);
      setHp(newHp);
      if (newHp <= 0) { setDefeatPending(true); setDefeatDismissed(false); }
    }

    if (parsed.playerHpRestore !== null && parsed.playerHpRestore !== undefined) {
      const ch = stateRef.current.character;
      const cap = ch ? ch.maxHp : parsed.playerHpRestore;
      newHp = Math.max(1, Math.min(cap, parsed.playerHpRestore));
      setHp(newHp);
      setDefeatPending(false);
      setDefeatDismissed(false);
      setShowDefeated(false);
    } else if (newHp <= 0 && parsed.combatEndType === "narrative") {
      const ch = stateRef.current.character;
      newHp = ch ? Math.min(ch.maxHp, 1) : 1;
      setHp(newHp);
      setDefeatPending(false);
      setDefeatDismissed(false);
      setShowDefeated(false);
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
          newInv = [...newInv, up.to];
          changed = true;
        }
      }
      if (changed) setInventory(newInv);
      for (const up of parsed.upgrades) {
        const acMatch = up.to.match(/\(\s*(?:AC|КД)\s*(\d+)\s*\)/i);
        if (acMatch) {
          const newAc = parseInt(acMatch[1]);
          dispatch({ type: "SET_CHARACTER_AC", ac: newAc, armorName: up.to });
        }
      }
    }

    if (parsed.newEnemies?.length) {
      const wasInCombat = currentEnemies.length > 0;
      const phase = stateRef.current.arc?.phase;
      parsed.newEnemies = parsed.newEnemies.map(enemy => balanceEnemy({
        ...enemy,
        isBoss: enemy.isBoss && (phase === undefined || phase === 5),
        isMidBoss: enemy.isMidBoss && (phase === undefined || phase === 3),
      }));
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
      const combatHints = /(attack|attacks|ambush|HP:|cultist|bandit|enemy|raider|goblin|orc|skeleton|gnoll|атакует|нападает|нападают|культист|бандит|враг|разбойник|гоблин|орк|скелет|гнолл)/i;
      if (combatHints.test(parsed.narrative)) {
        const inferred: Enemy[] = [];
        const hpRe = /([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'`-]{1,30}?)\s*\(\s*HP:\s*(\d+)\s*\/\s*(\d+)\s*\)/gi;
        let m: RegExpExecArray | null;
        const seen = new Set<string>();
        while ((m = hpRe.exec(parsed.narrative)) !== null) {
          const name = m[1].trim().replace(/^[—–\-•:,\.]+/, "").trim();
          const enemyHp = parseInt(m[2]);
          const maxHp = parseInt(m[3]);
          const key = `${name.toLowerCase()}|${maxHp}`;
          if (name && maxHp > 0 && !seen.has(key)) {
            seen.add(key);
            inferred.push({ name, hp: enemyHp, maxHp, ac: 12, damage: "d4+1", attackBonus: 3, wisBonus: 0 });
          }
        }
        if (inferred.length) {
          newEnemies = [...newEnemies, ...inferred.map(balanceEnemy)];
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
        const targetIdx = findCombatantIndex(newEnemies, "enemy", ed.name);
        if (targetIdx >= 0) {
          newEnemies = newEnemies.map((e, i) =>
            i === targetIdx ? { ...e, hp: Math.max(0, e.hp - ed.damage) } : e
          );
        }
      }
      setEnemies(newEnemies);
    }

    if (parsed.newAllies?.length) {
      setAllies(prev => [...prev, ...parsed.newAllies.map(a => ({ ...a }))]);
    }
    if (parsed.allyDamages?.length) {
      setAllies(prev => {
        let next = [...prev];
        for (const ad of parsed.allyDamages) {
          const idx = findCombatantIndex(next, "ally", ad.name);
          if (idx >= 0) {
            next = next.map((a, i) => i === idx ? { ...a, hp: Math.max(0, a.hp - ad.damage) } : a);
          }
        }
        return next;
      });
    }

    const withdrawing = withdrawingEnemies(parsed, newEnemies);
    if (withdrawing.size > 0) {
      newEnemies = newEnemies.map((enemy, index) => withdrawing.has(index) ? { ...enemy, hp: 0 } : enemy);
      setEnemies(newEnemies);
    }
    if (parsed.combatEndType === "victory" && newEnemies.some(enemy => enemy.hp > 0)) {
      parsed.combatEnd = false;
      parsed.combatEndType = null;
    }
    const combatEnded = parsed.combatEnd || (newEnemies.length > 0 && newEnemies.every(enemy => enemy.hp <= 0));
    if (combatEnded) {
      if (!parsed.combatEnd) {
        parsed.combatEnd = true;
        parsed.combatEndType = "victory";
      }
      const wasInCombat = currentEnemies.length > 0 || stateRef.current.enemies.length > 0;
      setInCombat(false);
      setEnemies([]);
      setAllies([]);
      setBerserkChargesLeft(0);
      setBerserkUsedThisCombat(false);
      setDidDodgeLastTurn(false);
      setDefensiveStance(false);
      setSelectingTarget(false);
      setPendingAction(null);
      setShowSpellMini(false);
      setNegotiationDeclined(false);
      pendingPotionInfoRef.current = null;
      if (wasInCombat) {
        trackEvent("combat_ended", {
          characterId: stateRef.current.character?.id,
          messageNumber: stateRef.current.messages.length,
          playerHp: newHp,
        });
      }
    }

    if (!combatEnded && parsed.surprise === "player") {
      if (newEnemies.length > 0 && !stateRef.current.inCombat) {
        setInCombat(true);
      }
      setSurpriseAdvantage("player");
    }

    let finalEffects = newEff;
    if (parsed.newEffects?.length) {
      const labels = parsed.newEffects.map(e => e.duration ? `${e.name} (${e.duration})` : e.name);
      finalEffects = [...newEff, ...labels];
      setEffects(finalEffects);
    }

    if (combatEnded) {
      const cleaned = finalEffects.filter(e => !/berserk|берсерк/i.test(e));
      if (cleaned.length !== finalEffects.length) {
        finalEffects = cleaned;
        setEffects(cleaned);
      }
    }

    if (parsed.initiativeTrigger) {
      setDidDodgeLastTurn(false);
      setDefensiveStance(false);
      setSelectingTarget(false);
      setPendingAction(null);
      setShowSpellMini(false);
      setNegotiationDeclined(false);
    }

    return { newHp, newInv, newEff: finalEffects, newEnemies };
  }

  function describeReward(reward: CombatReward) {
    return [
      t("combatLoot.gold", { amount: reward.gold }),
      reward.item ? combatLootItemName(reward.item, language) : null,
      reward.kind === "midBoss" ? t("combatLoot.artifact") : null,
    ].filter(Boolean).join(" · ");
  }

  async function processAndSetMessages(
    char: Character, currentHp: number, currentInv: string[],
    currentEff: string[], currentEnemies: Enemy[], reply: string,
    prevMessages: ChatMessage[], context: ChoiceContext = {},
  ): Promise<ChatMessage[]> {
    const dmResult = parseDMResponse(stripEnemyAttackRolls(reply));
    const combatScene = currentEnemies.some(enemy => enemy.hp > 0) || dmResult.newEnemies.length > 0
      || dmResult.initiativeTrigger || stateRef.current.inCombat;
    const currentArc = stateRef.current.arc;
    const lastAction = prevMessages.at(-1);
    const midBoss = dmResult.newEnemies.find(enemy => enemy.isMidBoss);
    const declaredAction = lastAction?.role === "user" ? lastAction.content.split("\n")[0] : "";
    const hostileAction = !/без боя|избега|не (?:атак|напад)|\b(?:avoid|without|do not|don’t)\b/iu.test(declaredAction)
      && /атакова|атакую|напасть|нападу|нападаю|вызвать.{0,50}(?:бой|поединок)|\b(?:attack|fight|duel|strike)\b/iu.test(declaredAction);
    const prematureMidBoss = currentArc?.phase === 3 && midBoss && !hostileAction
      && !currentEnemies.some(enemy => enemy.isMidBoss && enemy.hp > 0);
    const offer = dmResult.goldOffer;
    const quote = !stateRef.current.inCombat && !dmResult.vendor && offer && offer.amount < 0
      ? t("goldOffer.quote", { amount: -offer.amount, reason: offer.reason }) : null;
    const result = quote ? stagePaidOffer(dmResult, parseDMResponse(quote)) : dmResult;
    const parsed = context.disengagement ? resolveDisengagement(result, context.disengagement)
      : context.attack ? applyPlayerAttackResult(result, context.attack, currentEnemies) : result;
    if (context.disengagement) {
      const invalid = !parsed.narrative || result.initiativeTrigger || result.newEnemies.length || result.enemyAttacks.length
        || result.combatEndType !== context.disengagement;
      const fallback = disengagementFallback(context.disengagement);
      if (invalid || !parsed.choices.length) parsed.choices = fallback.choices;
      if (invalid) parsed.narrative = fallback.narrative;
    }
    if (context.midBossBypass && currentArc?.phase === 3 && !currentEnemies.some(enemy => enemy.hp > 0)) {
      const safe = parseDMResponse([
        t("combat.midBossPassed"),
        `1. ${t("combat.disengageProceed")} [NO_CHECK]`,
        `2. ${t("combat.disengageLook")} [NO_CHECK]`,
      ].join("\n"));
      Object.assign(parsed, safe, { midBossBypassed: true });
    } else if (prematureMidBoss && !context.disengagement) {
      const name = midBoss.name;
      Object.assign(parsed, parseDMResponse([
        t("combat.midBossApproach", { name }),
        `1. ${t("combat.midBossBypassChoice")} [NO_CHECK]`,
        `2. ${t("combat.midBossTalkChoice")} [NO_CHECK]`,
        `3. ${t("combat.midBossFightChoice", { name })} [NO_CHECK]`,
      ].join("\n")));
    }
    if (context.attack && !parsed.combatEnd && dmResult.combatEnd) {
      parsed.narrative = t(context.attack.damage ? "combat.reconciledHit" : "combat.reconciledMiss");
      parsed.choices = [];
    }
    if (context.dodge) parsed.narrative = t("combat.dodgeAttempt");
    if (parsed.vendor && (isScoutKit(parsed.vendor.tip) || /(?:\b\d+\s*(?:gold|gp|зм)|(?:one|a) gold coin|за (?:одну )?золотую монету)/iu.test(parsed.narrative))) {
      parsed.narrative = t(isScoutKit(parsed.vendor.tip) ? "vendor.kitOnlyOffer" : "vendor.standardOffer");
    }
    if (context.attack || context.dodge || context.extraAttack) parsed.attackRequest = null;
    if (context.extraAttack || (combatScene && parsed.enemyAttacks.length)) parsed.damage = null;
    if (context.extraAttack) {
      if (parsed.enemyAttacks.length && !parsed.combatEnd) {
        parsed.narrative = t(context.attack?.damage ? "combat.reconciledHit" : "combat.reconciledMiss");
      }
      parsed.enemyAttacks = [];
    }
    const unverifiedCoins = !parsed.goldOffer && /\[ITEM:[^\]\r\n]*\d+\s*(?:gold|gp|зм)[^\]\r\n]*\]/iu.test(reply);
    if (unverifiedCoins) {
      parsed.narrative = parsed.narrative.replace(
        /\s+(?:and (?:a )?(?:purse|pouch|bag) of (?:gold|coins)|и (?:кошель|кошелёк|мешочек) с монетами)/giu, "",
      );
    }
    if (context.noCheck || context.checkResult || context.vendorPurchase) parsed.rollRequest = null;
    if (!quote && (combatScene || parsed.vendor || context.vendorPurchase)) {
      const firstDiscovery = !context.disengagement && parsed.initiativeTrigger && currentEnemies.length === 0
        && !dmResult.combatEnd && !parsed.vendor && !context.vendorPurchase;
      const items = context.vendorPurchase?.kind === "kit" ? [scoutKitName(language)]
        : firstDiscovery ? parsed.newItems.filter(item => isPotion(item) && !isCombatLootItem(item)) : [];
      parsed.newItem = items[0] ?? null;
      parsed.newItems = items;
      parsed.upgrades = [];
      parsed.goldOffer = null;
    }
    parsed.artifactBonus = null;
    reportLanguageLeaks(parsed.narrative, language, parsed.narrative);
    const unpreparedLead = context.followClue && !context.followClue.clueFallback;
    const discoveredClue = unpreparedLead ? parsed.discoveredClue : undefined;
    const clueStillMissing = unpreparedLead && !discoveredClue;
    const socialFailure = quote ? undefined : context.socialFailure
      ? { ...context.socialFailure, clueFallback: context.socialFailure.clueFallback ?? parsed.clueFallback }
      : clueStillMissing ? context.followClue : undefined;
    const engineNarration = context.disengagement || context.midBossBypass || prematureMidBoss || context.dodge || unverifiedCoins
      || context.attack && !parsed.combatEnd && dmResult.combatEnd;
    const visibleReply = engineNarration ? [parsed.narrative,
      ...parsed.choices.map(choice => `${choice.num}. ${choice.text}`)].join("\n") : reply;
    const sceneMessage: ChatMessage = {
      role: "assistant", content: quote ?? visibleReply, parsed,
      ...(quote || engineNarration ? { rawContent: reply } : {}),
      ...(socialFailure ? { socialFailure } : {}),
    };
    const newMsgs: ChatMessage[] = [...prevMessages, sceneMessage];
    if (context.vendorPurchase?.kind === "tip") {
      const vendorTip = context.vendorPurchase.tip;
      const content = t("vendor.tipReceived", { tip: vendorTip });
      newMsgs.push({ role: "assistant", source: "client", content, parsed: parseDMResponse(content), vendorTip });
    }
    if (discoveredClue && !parsed.narrative) parsed.narrative = discoveredClue;
    const availableInventory = context.consumeScoutKit ? spendScoutKit(currentInv) : currentInv;
    if (availableInventory !== currentInv) setInventory(availableInventory);
    const { newHp, newInv, newEff, newEnemies } = applyParsed(parsed, currentHp, availableInventory, currentEff, currentEnemies);
    let finalHp = newHp;
    if (!parsed.initiativeTrigger && !parsed.combatEnd && parsed.enemyAttacks.length > 0) {
      const { log, hp } = deps.executeEnemyAttacksRef.current(parsed.enemyAttacks, newEnemies, char.ac - (context.berserkAttack || stateRef.current.berserkChargesLeft > 0 ? 2 : 0), newHp, context.dodge);
      finalHp = hp;
      if (log) {
        newMsgs.push({ role: "assistant", source: "client", content: log, parsed: parseDMResponse(log) });
      }
    }

    const encounterActive = !parsed.combatEnd && newEnemies.some(enemy => enemy.hp > 0);
    const outcome = finalEncounterOutcome(currentArc, currentEnemies, newEnemies, finalHp, encounterActive,
      parsed.combatEndType, context.disengagement === "surrender");
    const { combatLoot } = stateRef.current;
    const earnedReward = !context.disengagement && parsed.combatEndType !== "retreat" && parsed.combatEndType !== "surrender"
      ? earnedCombatReward(combatLoot, currentArc, currentEnemies, newEnemies, finalHp) : null;
    const reward = earnedReward?.kind === "finalBoss" ? null : earnedReward;
    if (reward) {
      dispatch({ type: "CLAIM_COMBAT_REWARD", reward, language });
      const content = t("combatLoot.received", { reward: describeReward(reward) });
      newMsgs.push({ role: "assistant", source: "client", content, parsed: parseDMResponse(content) });
    }
    if (context.extraAttack) {
      const content = t("combat_log.heroicSurge");
      newMsgs.push({ role: "assistant", source: "client", content, parsed: parseDMResponse(content) });
    }

    if (reward?.kind === "midBoss") {
      parsed.choices = parsed.choices.filter(choice =>
        !/(?:забрать|подобрать|взять|collect|take|claim).{0,40}(?:артефакт|печать авангарда|artifact|vanguard seal)/iu.test(choice.text));
    }
    if (currentArc && !currentArc.completed && (!clueStillMissing || reward || outcome)) {
      const failedCheck = lastAction?.abilityRoll?.result.success === false
        || /\bFAIL\b/i.test(context.checkResult ?? "");
      const resolvedMidBoss = finalHp > 0 && currentArc.phase === 3 && !encounterActive
        && (context.disengagement ? currentEnemies.some(enemy => enemy.isMidBoss) : !failedCheck && parsed.midBossBypassed);
      let arcAfterEncounter = reward?.kind === "midBoss" ? { ...currentArc, midBossDefeated: true }
        : resolvedMidBoss ? { ...currentArc, midBossBypassed: true } : currentArc;
      if (outcome) {
        const plan = currentArc.finalePlan ?? fallbackFinalePlan(currentArc, t);
        const epilogue = (!plan.objective && !plan.recognition ? parsed.epilogue : undefined) || currentArc.successEpilogue
          || t(outcome === "surrender" ? "arcCompleted.surrenderFallback" : "arcCompleted.victoryFallback");
        arcAfterEncounter = beginFinale(arcAfterEncounter, plan, outcome, epilogue);
        parsed.choices = [];
        parsed.rollRequest = null;
        parsed.attackRequest = null;
        if (plan.objective) {
          const narration = t(outcome === "surrender" ? "arcCompleted.bossSurrendered" : "arcCompleted.bossFallen");
          parsed.narrative = `${narration} ${t("arcCompleted.objectivePending", { objective: plan.objective.action })}`;
          sceneMessage.content = parsed.narrative;
          sceneMessage.rawContent = reply;
        }
      }
      const nextArc = computeNextArc(arcAfterEncounter, parsed, encounterActive);
      if (nextArc !== currentArc) dispatch({ type: "SET_ARC", arc: nextArc });
      if (outcome && nextArc.finale?.stage === "recognition" && !nextArc.finalePlan?.recognition) {
        const finished = advanceFinale(nextArc, "finish");
        if (finished) {
          const history = commitFinale(finished.arc, newMsgs);
          const item = finished.arc.ending?.artifact?.name;
          deps.doSaveRef.current(char, finalHp, item ? [...newInv, item] : newInv, newEff, history);
          setPendingInitiative(false);
          setPendingRoll(null);
          return history;
        }
      }
    }
    setMessages(newMsgs);

    const initiativeReady = parsed.initiativeTrigger && encounterActive;
    if (encounterActive && !currentEnemies.some(enemy => enemy.hp > 0)) {
      combatCheckpointRef.current = null;
      needsCombatCheckpointRef.current = true;
    }

    let autoAttackReq: { weapon: string; dice: string; mod: number; ac: number } | null = null;

    const wasInCombat = stateRef.current.enemies.length > 0 || currentEnemies.length > 0;

    if (outcome) {
      setPendingInitiative(false);
      setPendingRoll(null);
    } else if (initiativeReady) {
      setPendingInitiative(true);
      setPendingRoll(null);
    } else if (!context.followClue && !parsed.initiativeTrigger && parsed.attackRequest && !wasInCombat) {
      const mod = char.stats[char.weapon.stat] || 0;
      autoAttackReq = { ...parsed.attackRequest, mod };
      setPendingRoll(null);
      setPendingInitiative(false);
    } else if (parsed.rollRequest && !context.followClue) {
      const { bonus, scoutKit } = scoutKitModifier(parsed.rollRequest.skill, newInv, encounterActive);
      const mod = char.stats[parsed.rollRequest.stat] + bonus;
      const lastMessage = prevMessages[prevMessages.length - 1];
      const action = lastMessage?.role === "user" ? lastMessage.content : undefined;
      setPendingRoll({ type: "roll", request: { ...parsed.rollRequest, mod, action, scoutKit } });
      setPendingInitiative(false);
    } else {
      setPendingRoll(null);
      setPendingInitiative(false);
    }

    const savedInventory = reward?.item ? [...newInv, combatLootItemName(reward.item, language)] : newInv;
    deps.doSaveRef.current(char, finalHp, savedInventory, newEff, newMsgs);
    trackEvent("scene_completed", {
      characterId: char.id,
      messageNumber: newMsgs.length,
      inCombat: stateRef.current.enemies.length > 0,
    });

    if (autoAttackReq) {
      setTimeout(() => { void deps.executeAttackRollRef.current(autoAttackReq!); }, 0);
    }

    return newMsgs;
  }

  function commitFinale(arc: Arc, history: ChatMessage[]): ChatMessage[] {
    const ending = arc.ending;
    if (!ending?.artifact) return history;
    const summary = [
      t("arcCompleted.journal", { epilogue: ending.epilogue }),
      t("arcCompleted.reward", { gold: ending.rewardGold }),
      t("arcCompleted.artifactAward", { name: ending.artifact.name }),
    ].join("\n\n");
    const messages: ChatMessage[] = [...history, {
      role: "assistant", source: "client", content: summary, parsed: parseDMResponse(summary),
    }];
    dispatch({ type: "COMPLETE_FINALE", arc, messages });
    return messages;
  }

  function chooseFinaleAction(action: FinaleAction) {
    if (deps.loading || deps.pendingTurn || turnRequestInFlight.current) return;
    const { arc, hp, inCombat, messages, character, inventory, effects } = stateRef.current;
    if (!character || !arc || hp <= 0 || inCombat) return;
    const next = advanceFinale(arc, action);
    if (!next) return;
    const text = action === "objective" ? arc.finalePlan?.objective?.action
      : action === "report" ? t("arcCompleted.reportBack", { recipient: arc.finalePlan?.recognition?.recipient })
      : t("arcCompleted.continueToEnding");
    const history: ChatMessage[] = [...messages, { role: "user", content: text ?? "" }];
    if (action === "objective" && next.narration) {
      history.push({ role: "assistant", source: "client", content: next.narration, parsed: parseDMResponse(next.narration) });
    }
    if (action === "objective") dispatch({ type: "SET_ARC", arc: next.arc });
    const done = next.arc.completed ? next.arc
      : next.arc.finale?.stage === "recognition" && !next.arc.finalePlan?.recognition
        ? advanceFinale(next.arc, "finish")?.arc : undefined;
    if (done?.ending?.artifact) {
      const saved = commitFinale(done, history);
      deps.doSaveRef.current(character, hp, [...inventory, done.ending.artifact.name], effects, saved);
    } else {
      setMessages(history);
      deps.doSaveRef.current(character, hp, inventory, effects, history);
    }
  }

  function disengagementFallback(ending: "surrender" | "retreat") {
    return parseDMResponse([
      t(ending === "surrender" ? "combat.surrenderFallback" : "combat.retreatFallback"),
      `1. ${t("combat.disengageProceed")} [NO_CHECK]`,
      `2. ${t("combat.disengageLook")} [NO_CHECK]`,
    ].join("\n"));
  }

  async function handleChoice(choiceText: string, context: ChoiceContext = {}) {
    if (deps.loading || pendingTurn || turnRequestInFlight.current) return;
    const { character, enemies, messages: msgs, arc } = stateRef.current;
    if (!character || arc?.finale || arc?.completed) return;
    setFreeInput(false);
    setFreeText("");
    setPendingRoll(null);
    setPendingInitiative(false);
    const content = [choiceText, context.checkResult].filter(Boolean).join("\n");
    const newMsgs: ChatMessage[] = [...msgs, { role: "user", content, ...(context.abilityRoll ? { abilityRoll: context.abilityRoll } : {}) }];
    const clue = context.followClue?.clueFallback;
    setMessages(newMsgs);
    const isNarrativeDefeat = /Player defeated/i.test(choiceText);
    const potionInfo = pendingPotionInfoRef.current;
    pendingPotionInfoRef.current = null;
    const choiceWithPotion = potionInfo ? `${potionInfo}\n${choiceText}` : choiceText;
    const surpriseActive = stateRef.current.surpriseAdvantage === "player";
    if (surpriseActive) setSurpriseAdvantage(null);
    const turnMessage = context.disengagement ? choiceWithPotion : surpriseActive
      ? `${choiceWithPotion}\n\n${i18n.t("system.surpriseRoundReminder")}`
      : (inCombat || enemies.length > 0) && !isNarrativeDefeat
        ? `${choiceWithPotion}\n\n${i18n.t("system.combatTurnReminder")}`
        : choiceWithPotion;
    const instructions = context.followClue
      ? t(clue ? "socialClue.followPrepared" : "socialClue.followUnprepared", {
          action: context.followClue.action ?? t("socialClue.previousApproach"),
          fact: clue?.fact,
        })
      : context.socialFailure
        ? t("socialClue.failedCheck", {
            action: context.socialFailure.action ?? t("socialClue.previousApproach"),
            lead: context.socialFailure.clueFallback?.lead ?? "",
          })
        : "";
    const target = context.attack && enemies[findCombatantIndex(enemies, "enemy", context.attack.target)];
    const attackOutcome = context.attack && target
      ? `[CLIENT ATTACK RESULT: ${context.attack.target}, damage ${context.attack.damage}, remaining HP ${Math.max(0, target.hp - context.attack.damage)}. The client will apply this result exactly once.]`
      : "";
    const abilityOutcome = context.checkResult
      ? `[CLIENT CHECK RESULT: ${context.checkResult} Resolve only the action the player selected, using this result. Do not request another roll.]`
      : context.noCheck ? "[CLIENT ACTION WITHOUT A CHECK: Continue this action directly without requesting a roll or adding a payment.]" : "";
    const apiMessage = [turnMessage, instructions, attackOutcome, abilityOutcome].filter(Boolean).join("\n\n");
    if (!context.transactionAmount) {
      const { attack, dodge, disengagement, extraAttack, berserkAttack, midBossBypass, noCheck, checkResult, consumeScoutKit, socialFailure, followClue } = context;
      setPendingTurn({
        messageIndex: msgs.length, requestText: apiMessage,
        resolution: { attack, dodge, disengagement, extraAttack, berserkAttack, midBossBypass, noCheck, checkResult, consumeScoutKit, socialFailure, followClue },
      });
    }
    await submitChoice(apiMessage, msgs, newMsgs, context);
  }

  async function submitChoice(apiMessage: string, history: ChatMessage[], newMsgs: ChatMessage[], context: ChoiceContext) {
    const { character: c, hp: h, inventory: inv, effects: eff, enemies: en, arc, combatLoot } = stateRef.current;
    if (!c || turnRequestInFlight.current) return;
    turnRequestInFlight.current = true;
    setLoading(true);
    try {
      let reply: string;
      const silentFallback = t("dm.silent");
      try {
        const reward = h > 0 && !context.disengagement ? plannedCombatReward(combatLoot, arc, en) : null;
        const rewardNote = reward && reward.kind !== "finalBoss"
          ? `\n\n[PREPARED COMBAT LOOT: ${describeReward(reward)}. The engine announces and grants this reward in a separate message. Focus on the encounter; do not mention a monetary amount, drop loot tags, or offer a second way to collect it.]`
          : "";
        const finalBoss = arc?.phase === 5 && en.some(enemy => enemy.isBoss);
        const plan = arc ? arc.finalePlan ?? fallbackFinalePlan(arc, t) : undefined;
        const endingNote = finalBoss && arc ? (plan?.objective
          ? `\n\n[FINALE: Ending the combat opens the way to this action: ${plan.objective.action}. Keep the objective incomplete until the player explicitly acts. Do not describe the hero performing it or write an epilogue yet.]`
          : `\n\n[FINALE: If the outcome definitively fulfills this goal: ${arc.goal}, add [EPILOGUE: two or three sentences about what changes in the world]. Omit money, items, returning to NPCs, and unsolicited actions.]`) : "";
        const extraActionNote = context.extraAttack
          ? "\n\n[HEROIC SURGE: This is an extra player attack. Describe the resolved strike only. There is no enemy reaction or extra turn.]"
          : "";
        reply = await callDM({
          character: c, hp: h, inventory: context.consumeScoutKit ? spendScoutKit(inv) : inv, effects: eff,
          history, userMessage: apiMessage + rewardNote + endingNote + extraActionNote,
          spellSlots: stateRef.current.spellSlots,
          language, arc: stateRef.current.arc,
          combatants: { enemies: en, allies: stateRef.current.allies },
          gold: context.balanceAfterTransaction ?? stateRef.current.gold, ac: c.ac,
          artifactBonus: stateRef.current.artifactBonus,
          silentFallback,
        });
        if (!reply.trim() || reply === silentFallback) {
          throw new Error("Empty turn reply");
        }
        if (context.transactionAmount && parseDMResponse(reply).goldOffer) throw new Error("Repeated gold offer");
      } catch (error) {
        if (context.disengagement) {
          const fallback = disengagementFallback(context.disengagement);
          const text = [fallback.narrative, `[END_COMBAT: ${context.disengagement}]`,
            ...fallback.choices.map(choice => `${choice.num}. ${choice.text} [NO_CHECK]`)].join("\n");
          setPendingTurn(null);
          await processAndSetMessages(c, h, inv, eff, en, text, newMsgs, context);
          return;
        }
        if (context.transactionAmount) {
          const content = t("goldOffer.connectionLost");
          setMessages([...history, { role: "assistant", source: "client", content, parsed: parseDMResponse(content) }]);
          return;
        }
        const lostText = t(isDmUnavailable(error) ? "dm.masterUnavailableTurn" : "dm.turnConnectionLost");
        setMessages([...newMsgs, {
          role: "assistant", content: lostText, parsed: parseDMResponse(lostText),
          source: "client",
        }]);
        return;
      }
      setPendingTurn(null);
      if (context.transactionAmount) dispatch({ type: "ADD_GOLD", amount: context.transactionAmount });
      await processAndSetMessages(c, h, inv, eff, en, reply, newMsgs, context);
    } finally {
      turnRequestInFlight.current = false;
      setLoading(false);
    }
  }

  async function retryTurn() {
    if (deps.loading || !pendingTurn || turnRequestInFlight.current) return;
    const { messageIndex, resolution, requestText } = pendingTurn;
    const messages = turnMessages(stateRef.current.messages, messageIndex);
    if (!messages) return;
    await submitChoice(requestText, messages.history, messages.includingTurn, resolution);
  }

  async function handleRollResult(rollRes: RollResult) {
    const r = deps.pendingRoll;
    if (!r || turnRequestInFlight.current) return;
    setPendingRoll(null);
    let msg: string;
    if (r.type === "attack") {
      const tname = "";
      if (rollRes.autoMiss) {
        msg = i18n.t("system.attackAutoMiss", { weapon: r.request.weapon, target: tname, ac: rollRes.ac });
      } else if (rollRes.crit) {
        msg = i18n.t("system.attackCrit", { weapon: r.request.weapon, target: tname, ac: rollRes.ac, damage: rollRes.damage, tagName: "Name" });
      } else if (rollRes.success) {
        msg = i18n.t("system.attackHit", { weapon: r.request.weapon, target: tname, ac: rollRes.ac, damage: rollRes.damage, tagName: "Name", roll: rollRes.hitRoll, mod: rollRes.mod, prof: rollRes.prof, total: rollRes.total });
      } else {
        msg = i18n.t("system.attackMiss", { weapon: r.request.weapon, target: tname, ac: rollRes.ac, roll: rollRes.hitRoll, mod: rollRes.mod, prof: rollRes.prof, total: rollRes.total });
      }
    } else {
      const modPart = rollRes.mod !== 0 ? `${rollRes.mod >= 0 ? "+" : ""}${rollRes.mod}` : "";
      msg = i18n.t(rollRes.success ? "system.rollSuccess" : "system.rollFail", {
        stat: r.request.stat,
        roll: rollRes.hitRoll,
        modPart,
        total: rollRes.total,
        dc: rollRes.dc,
      });
    }
    const abilityRoll = r.type === "roll"
      ? { action: r.choiceAction, skill: r.request.skill, stat: r.request.stat, result: rollRes }
      : undefined;
    if (r.choiceAction) {
      const result = r.request.skill ? `${r.request.skill} — ${msg}` : msg;
      const socialFailure = !rollRes.success && r.request.social ? { action: r.choiceAction, clueFallback: r.clueFallback } : undefined;
      await handleChoice(r.choiceAction, { checkResult: result, abilityRoll, socialFailure, consumeScoutKit: r.request.scoutKit });
      return;
    }
    const state = stateRef.current;
    const socialFailure = r.type === "roll"
      ? getSocialFailure(r.request, rollRes.success, state.inCombat, state.messages)
      : undefined;
    await handleChoice(msg, { abilityRoll, socialFailure, consumeScoutKit: r.request.scoutKit });
  }

  function handleInitiativeResult(res: { player: number; enemy: number; playerWins: boolean }) {
    setPendingInitiative(false);
    const { character, enemies, hp } = stateRef.current;
    if (!character || !enemies.some(enemy => enemy.hp > 0)) return;

    const initiative = t("combat.initiativeFooter", {
      player: res.player,
      enemy: res.enemy,
      result: t(res.playerWins ? "combat.initiativeYouFirst" : "combat.initiativeEnemyFirst"),
    });
    const attackers = enemies.flatMap((enemy, index) =>
      enemy.hp > 0 ? [combatReference("enemy", index)] : [],
    );
    const attackLog = res.playerWins
      ? ""
      : deps.executeEnemyAttacksRef.current(attackers, enemies, character.ac, hp).log;
    const content = [initiative, attackLog].filter(Boolean).join("\n");
    setMessages(prev => [...prev, {
      role: "assistant", source: "client", content, parsed: parseDMResponse(content),
    }]);
  }

  function chooseStoryAction(choice: StoryChoice) {
    const { character, inCombat, inventory, messages } = stateRef.current;
    if (!character || inCombat || deps.loading || pendingTurn || deps.pendingRoll || turnRequestInFlight.current) return;
    if (!choice.check) {
      const followClue = choice.clueRoute ? messages[currentSceneMessageIndex(messages)]?.socialFailure : undefined;
      const midBossBypass = stateRef.current.arc?.phase === 3 && choice.text === t("combat.midBossBypassChoice") ? true : undefined;
      void handleChoice(choice.text, { noCheck: choice.check === null, followClue, midBossBypass });
      return;
    }
    const { bonus, scoutKit } = scoutKitModifier(choice.check.skill, inventory, inCombat);
    setPendingRoll({
      type: "roll",
      choiceAction: choice.text,
      clueFallback: choice.clueFallback,
      request: { ...choice.check, mod: character.stats[choice.check.stat] + bonus, action: choice.text, scoutKit },
    });
  }

  async function confirmGoldOffer(messageIndex: number) {
    const { messages, gold, inCombat } = stateRef.current;
    if (deps.loading || deps.pendingRoll || deps.pendingInitiative || pendingTurn || turnRequestInFlight.current || inCombat
      || messageIndex !== currentSceneMessageIndex(messages)) return;
    const message = messages[messageIndex];
    const offer = message?.parsed?.goldOffer;
    if (!offer || !canSettleGold(gold, offer.amount)) return;

    const key = offer.amount > 0 ? "system.goldReceived" : "system.goldPaid";
    await handleChoice(t(key, { amount: Math.abs(offer.amount), reason: offer.reason }), {
      balanceAfterTransaction: gold + offer.amount, transactionAmount: offer.amount,
    });
  }

  async function declinePaidOffer(messageIndex: number) {
    const { messages, inCombat } = stateRef.current;
    const offer = messages[messageIndex]?.parsed?.goldOffer;
    if (inCombat || !offer || offer.amount >= 0 || messageIndex !== currentSceneMessageIndex(messages)) return;
    await handleChoice(t("goldOffer.declined"), { noCheck: true });
  }

  async function buyFromVendor(messageIndex: number, kind: VendorPurchase) {
    const { messages, gold, inCombat, inventory } = stateRef.current;
    if (deps.loading || deps.pendingRoll || deps.pendingInitiative || pendingTurn || turnRequestInFlight.current
      || inCombat || messageIndex !== currentSceneMessageIndex(messages) || !canSettleGold(gold, -vendorPrice)) return;
    const vendor = messages[messageIndex]?.parsed?.vendor;
    if (!vendor || (kind === "kit" ? inventory.some(isScoutKit) : messages.some(message => message.vendorTip === vendor.tip))) return;

    const choice = kind === "tip"
      ? t("vendor.confirmTip", { amount: vendorPrice, tip: vendor.tip })
      : t("vendor.confirmKit", { amount: vendorPrice, item: scoutKitName(language) });
    await handleChoice(choice, {
      transactionAmount: -vendorPrice,
      balanceAfterTransaction: gold - vendorPrice,
      vendorPurchase: { kind, tip: vendor.tip },
    });
  }

  return { applyParsed, processAndSetMessages, handleChoice, chooseFinaleAction, retryTurn, handleRollResult, handleInitiativeResult, confirmGoldOffer, declinePaidOffer, chooseStoryAction, buyFromVendor };
}
