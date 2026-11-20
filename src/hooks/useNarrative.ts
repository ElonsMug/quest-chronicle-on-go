// ─────────────────────────────────────────────────────────────────
// useNarrative — extracts handleChoice, handleRollResult,
// handleInitiativeResult, processAndSetMessages, applyParsed.
// All cross-hook calls go through deps.*Ref refs to avoid cycles.
// ─────────────────────────────────────────────────────────────────

import { combatReference, findCombatantIndex } from "@/game/combatReferences";
import { applyPlayerAttackResult, stripEnemyAttackRolls, type PlayerCombatAttack } from "@/game/combatTurn";
import { canSettleGold, currentSceneMessageIndex, getSocialFailure, stagePaidOffer } from "@/game/sceneMessages";
import type { StoryChoice } from "@/game/abilityChecks";
import { balanceEnemy } from "@/game/enemyBalance";
import { hasScoutKitBonus, isScoutKit, scoutKitBonus, scoutKitName, spendScoutKit, vendorPrice, type VendorPurchase } from "@/game/vendor";
import { combatLootItemName, earnedCombatReward, plannedCombatReward, type CombatReward } from "@/game/combatLoot";
import i18n from "@/i18n";
import type {
  Character, ChatMessage, Enemy, Parsed, RollResult, SocialFailure,
} from "@/game/types";
import { parseDMResponse } from "@/game/parser";
import { reportLanguageLeaks } from "@/game/langGuard";
import { callDM } from "@/game/api";
import { computeNextArc } from "@/game/arcs";
import { trackEvent } from "@/lib/analytics";
import type { GameDeps } from "./useGameDeps";

type ChoiceContext = {
  balanceAfterTransaction?: number;
  transactionAmount?: number;
  noCheck?: boolean;
  checkResult?: string;
  abilityRoll?: ChatMessage["abilityRoll"];
  dodge?: true;
  vendorPurchase?: { kind: VendorPurchase; tip: string };
  consumeScoutKit?: boolean;
  socialFailure?: SocialFailure;
  followClue?: SocialFailure;
  attack?: PlayerCombatAttack;
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
    inCombat, pendingCombatTurn, setPendingCombatTurn, turnRequestInFlight,
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

    if (parsed.combatEndType === "victory" && newEnemies.some(enemy => enemy.hp > 0)) {
      parsed.combatEnd = false;
      parsed.combatEndType = null;
    }
    const combatEnded = parsed.combatEnd || (newEnemies.length > 0 && newEnemies.every(enemy => enemy.hp <= 0));
    if (combatEnded) {
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
    const combatScene = currentEnemies.length > 0 || dmResult.newEnemies.length > 0
      || dmResult.initiativeTrigger || stateRef.current.inCombat;
    const offer = dmResult.goldOffer;
    const quote = !stateRef.current.inCombat && !dmResult.vendor && offer && offer.amount < 0
      ? t("goldOffer.quote", { amount: -offer.amount, reason: offer.reason }) : null;
    const result = quote ? stagePaidOffer(dmResult, parseDMResponse(quote)) : dmResult;
    const parsed = context.attack ? applyPlayerAttackResult(result, context.attack, currentEnemies) : result;
    if (context.noCheck || context.checkResult || context.vendorPurchase) parsed.rollRequest = null;
    if (!quote && (combatScene || parsed.vendor || context.vendorPurchase)) {
      const item = context.vendorPurchase?.kind === "kit" ? scoutKitName(language) : null;
      parsed.newItem = item;
      parsed.newItems = item ? [item] : [];
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
    const newMsgs: ChatMessage[] = [...prevMessages, {
      role: "assistant", content: quote ?? reply, parsed,
      ...(quote ? { rawContent: reply } : {}),
      ...(socialFailure ? { socialFailure } : {}),
    }];
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
      const { log, hp } = deps.executeEnemyAttacksRef.current(parsed.enemyAttacks, newEnemies, char.ac, newHp, context.dodge);
      finalHp = hp;
      if (log) {
        newMsgs.push({ role: "assistant", source: "client", content: log, parsed: parseDMResponse(log) });
      }
    }

    const { arc: currentArc, combatLoot } = stateRef.current;
    const reward = earnedCombatReward(combatLoot, currentArc, currentEnemies, newEnemies, finalHp);
    if (reward) {
      dispatch({ type: "CLAIM_COMBAT_REWARD", reward, language });
      const content = t("combatLoot.received", { reward: describeReward(reward) });
      newMsgs.push({ role: "assistant", source: "client", content, parsed: parseDMResponse(content) });
    }
    setMessages(newMsgs);

    const encounterActive = !parsed.combatEnd && newEnemies.some(enemy => enemy.hp > 0);
    if (currentArc && !currentArc.completed && (!clueStillMissing || reward)) {
      const arcAfterKills = reward?.kind === "midBoss" ? { ...currentArc, midBossDefeated: true }
        : reward?.kind === "finalBoss" ? { ...currentArc, bossDefeated: true } : currentArc;
      const nextArc = computeNextArc(arcAfterKills, parsed, encounterActive);
      if (nextArc !== currentArc) dispatch({ type: "SET_ARC", arc: nextArc });
    }

    const initiativeReady = parsed.initiativeTrigger && encounterActive;
    if (encounterActive && !currentEnemies.some(enemy => enemy.hp > 0)) {
      combatCheckpointRef.current = null;
      needsCombatCheckpointRef.current = true;
    }

    let autoAttackReq: { weapon: string; dice: string; mod: number; ac: number } | null = null;

    const wasInCombat = stateRef.current.enemies.length > 0 || currentEnemies.length > 0;

    if (initiativeReady) {
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

  async function handleChoice(choiceText: string, context: ChoiceContext = {}) {
    if (deps.loading || pendingCombatTurn || turnRequestInFlight.current) return;
    const { character, enemies, messages: msgs } = stateRef.current;
    if (!character) return;
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
    const turnMessage = surpriseActive
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
    if (context.attack) {
      setPendingCombatTurn({ messageIndex: msgs.length, requestText: apiMessage, attack: context.attack });
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
        const reward = h > 0 ? plannedCombatReward(combatLoot, arc, en) : null;
        const rewardNote = reward
          ? `\n\n[PREPARED COMBAT LOOT: ${describeReward(reward)}. Describe these exact finds only if this turn defeats every enemy and the hero survives. The engine grants them. Omit loot tags and do not promise any other prize.]`
          : "";
        reply = await callDM({
          character: c, hp: h, inventory: context.consumeScoutKit ? spendScoutKit(inv) : inv, effects: eff,
          history, userMessage: apiMessage + rewardNote,
          spellSlots: stateRef.current.spellSlots,
          language, arc: stateRef.current.arc,
          combatants: { enemies: en, allies: stateRef.current.allies },
          gold: context.balanceAfterTransaction ?? stateRef.current.gold, ac: c.ac,
          artifactBonus: stateRef.current.artifactBonus,
          silentFallback,
        });
        if ((context.attack || context.transactionAmount) && (!reply.trim() || reply === silentFallback)) {
          throw new Error("Empty turn reply");
        }
        if (context.transactionAmount && parseDMResponse(reply).goldOffer) throw new Error("Repeated gold offer");
      } catch {
        if (context.transactionAmount) {
          const content = t("goldOffer.connectionLost");
          setMessages([...history, { role: "assistant", source: "client", content, parsed: parseDMResponse(content) }]);
          return;
        }
        const lostText = t(context.attack ? "dm.combatConnectionLost" : "dm.connectionLost");
        setMessages([...newMsgs, {
          role: "assistant", content: lostText, parsed: parseDMResponse(lostText),
          ...(context.attack ? { source: "client" as const } : {}),
          socialFailure: context.socialFailure ?? (context.followClue?.clueFallback ? undefined : context.followClue),
        }]);
        return;
      }
      if (context.attack) setPendingCombatTurn(null);
      if (context.transactionAmount) dispatch({ type: "ADD_GOLD", amount: context.transactionAmount });
      await processAndSetMessages(c, h, inv, eff, en, reply, newMsgs, context);
    } finally {
      turnRequestInFlight.current = false;
      setLoading(false);
    }
  }

  async function retryCombatTurn() {
    if (deps.loading || !pendingCombatTurn || turnRequestInFlight.current) return;
    const { messageIndex, attack, requestText } = pendingCombatTurn;
    const { messages } = stateRef.current;
    const turnMessages = messages.slice(0, messageIndex + 1);
    await submitChoice(requestText, messages.slice(0, messageIndex), turnMessages, { attack });
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
    if (!character || inCombat || deps.loading || deps.pendingRoll || turnRequestInFlight.current) return;
    if (!choice.check) {
      const followClue = choice.clueRoute ? messages[currentSceneMessageIndex(messages)]?.socialFailure : undefined;
      void handleChoice(choice.text, { noCheck: choice.check === null, followClue });
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
    if (deps.loading || deps.pendingRoll || deps.pendingInitiative || pendingCombatTurn || turnRequestInFlight.current || inCombat
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
    if (deps.loading || deps.pendingRoll || deps.pendingInitiative || pendingCombatTurn || turnRequestInFlight.current
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

  return { applyParsed, processAndSetMessages, handleChoice, retryCombatTurn, handleRollResult, handleInitiativeResult, confirmGoldOffer, declinePaidOffer, chooseStoryAction, buyFromVendor };
}
