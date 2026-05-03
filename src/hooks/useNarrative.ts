// ─────────────────────────────────────────────────────────────────
// useNarrative — extracts handleChoice, handleRollResult,
// handleInitiativeResult, processAndSetMessages, applyParsed.
// All cross-hook calls go through deps.*Ref refs to avoid cycles.
// ─────────────────────────────────────────────────────────────────

import i18n from "@/i18n";
import type {
  Character, ChatMessage, Enemy, Stat, Parsed, RollResult,
} from "@/game/types";
import { parseDMResponse } from "@/game/parser";
import { reportLanguageLeaks } from "@/game/langGuard";
import { callDM } from "@/game/api";
import { computeNextArc } from "@/game/arcs";
import { trackEvent } from "@/lib/analytics";
import type { GameDeps } from "./useGameDeps";

export function useNarrative(deps: GameDeps) {
  const {
    t, language, stateRef, dispatch,
    setHp, setInventory, setEnemies, setAllies, setMessages,
    setEffects, setInCombat, setBerserkChargesLeft, setBerserkUsedThisCombat,
    setDidDodgeLastTurn, setDefensiveStance, setSelectingTarget,
    setPendingAction, setShowSpellMini, setNegotiationDeclined,
    setSurpriseAdvantage, setArtifactBonus,
    setLoading, setPendingRoll, setPendingInitiative,
    setFreeInput, setFreeText, setDefeatPending, setDefeatDismissed,
    setShowDefeated, combatStartSnapshotRef, pendingPotionInfoRef,
    inCombat,
  } = deps;

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
    } else if (newHp <= 0 && (parsed.combatEnd || parsed.combatEndType === "narrative")) {
      const ch = stateRef.current.character;
      newHp = ch ? Math.min(ch.maxHp, 1) : 1;
      setHp(newHp);
      setDefeatPending(false);
      setDefeatDismissed(false);
      setShowDefeated(false);
    }

    if (parsed.goldChange != null) {
      dispatch({ type: "ADD_GOLD", amount: parsed.goldChange });
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
          newEnemies = [...newEnemies, ...inferred];
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
        const targetIdx = newEnemies.findIndex(e => e.hp > 0 && e.name.toLowerCase() === ed.name.toLowerCase());
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
          const idx = next.findIndex(a => a.hp > 0 && a.name.toLowerCase() === ad.name.toLowerCase());
          if (idx >= 0) {
            next = next.map((a, i) => i === idx ? { ...a, hp: Math.max(0, a.hp - ad.damage) } : a);
          }
        }
        return next;
      });
    }

    if (parsed.combatEnd || (newEnemies.length > 0 && newEnemies.every(e => e.hp <= 0))) {
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

    if (parsed.surprise === "player") {
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

    if (parsed.combatEnd || (newEnemies.length > 0 && newEnemies.every(e => e.hp <= 0))) {
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

  async function processAndSetMessages(
    char: Character, currentHp: number, currentInv: string[],
    currentEff: string[], currentEnemies: Enemy[], reply: string,
    prevMessages: ChatMessage[],
  ): Promise<ChatMessage[]> {
    const parsed = parseDMResponse(reply);
    reportLanguageLeaks(parsed.narrative, language, parsed.narrative);
    const newMsgs: ChatMessage[] = [...prevMessages, { role: "assistant", content: reply, parsed }];
    const { newHp, newInv, newEff, newEnemies } = applyParsed(parsed, currentHp, currentInv, currentEff, currentEnemies);
    setMessages(newMsgs);

    if (parsed.artifactBonus !== null && parsed.artifactBonus !== undefined) {
      setArtifactBonus(parsed.artifactBonus);
    }
    if (parsed.enemyAttacks && parsed.enemyAttacks.length > 0) {
      const ch = stateRef.current.character;
      if (ch) {
        const attackLog = await deps.executeEnemyAttacksRef.current(
          parsed.enemyAttacks,
          newEnemies.length > 0 ? newEnemies : currentEnemies,
          ch.ac,
        );
        if (attackLog) {
          setMessages(prev => [...prev, {
            role: "assistant" as const,
            content: attackLog,
            parsed: parseDMResponse(attackLog),
          }]);
        }
      }
    }

    const currentArc = stateRef.current.arc;
    if (currentArc && !currentArc.completed) {
      const liveBefore = new Set(
        currentEnemies.filter((e) => e.hp > 0).map((e) => e.name.toLowerCase()),
      );
      const killedThisScene = newEnemies.filter(
        (e) => e.hp <= 0 && liveBefore.has(e.name.toLowerCase()),
      );
      let arcAfterKills = currentArc;
      if (currentArc.phase === 3 && killedThisScene.length > 0 && !arcAfterKills.midBossDefeated) {
        arcAfterKills = { ...arcAfterKills, midBossDefeated: true };
        dispatch({ type: "MARK_MIDBOSS_DEFEATED" });
      }
      if (
        currentArc.phase === 5 &&
        killedThisScene.some((e) => e.isBoss) &&
        !arcAfterKills.bossDefeated
      ) {
        arcAfterKills = { ...arcAfterKills, bossDefeated: true };
        dispatch({ type: "MARK_BOSS_DEFEATED" });
      }
      const nextArc = computeNextArc(arcAfterKills, parsed, stateRef.current.inCombat);
      if (nextArc !== arcAfterKills || nextArc !== currentArc) {
        dispatch({ type: "SET_ARC", arc: nextArc });
      }
    }

    if (parsed.initiativeTrigger) {
      const snapEnemies = (parsed.newEnemies?.length ? parsed.newEnemies : stateRef.current.enemies).map(e => ({ ...e }));
      const snapAllies = stateRef.current.allies.map(a => ({ ...a }));
      combatStartSnapshotRef.current = { hp: newHp, enemies: snapEnemies, allies: snapAllies };
    }

    let autoAttackReq: { weapon: string; dice: string; mod: number; ac: number } | null = null;

    const wasInCombat = stateRef.current.enemies.length > 0 || currentEnemies.length > 0;

    if (parsed.initiativeTrigger) {
      setPendingInitiative(true);
      setPendingRoll(null);
    } else if (parsed.attackRequest && !wasInCombat) {
      const mod = char.stats[char.weapon.stat] || 0;
      autoAttackReq = { ...parsed.attackRequest, mod };
      setPendingRoll(null);
      setPendingInitiative(false);
    } else if (parsed.rollRequest) {
      const lower = parsed.rollRequest.stat.toLowerCase();
      const statKey: Stat = (lower.includes("str") || lower.includes("сил")) ? "str"
        : (lower.includes("dex") || lower.includes("лов")) ? "dex"
        : "int";
      const mod = char.stats[statKey] || 0;
      setPendingRoll({ type: "roll", request: { ...parsed.rollRequest, mod } });
      setPendingInitiative(false);
    } else {
      setPendingRoll(null);
      setPendingInitiative(false);
    }

    deps.doSaveRef.current(char, newHp, newInv, newEff, newMsgs);
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

  async function handleChoice(choiceText: string) {
    if (deps.loading) return;
    const { character: c, hp: h, inventory: inv, effects: eff, enemies: en, messages: msgs } = stateRef.current;
    if (!c) return;
    setFreeInput(false);
    setFreeText("");
    setPendingRoll(null);
    setPendingInitiative(false);
    const newMsgs: ChatMessage[] = [...msgs, { role: "user", content: choiceText }];
    setMessages(newMsgs);
    setLoading(true);
    const isInitiativeWin = /Initiative won/i.test(choiceText);
    const isNarrativeDefeat = /Player defeated/i.test(choiceText);
    const potionInfo = pendingPotionInfoRef.current;
    pendingPotionInfoRef.current = null;
    const choiceWithPotion = potionInfo ? `${potionInfo}\n${choiceText}` : choiceText;
    const surpriseActive = stateRef.current.surpriseAdvantage === "player";
    if (surpriseActive) setSurpriseAdvantage(null);
    const apiMessage = surpriseActive
      ? `${choiceWithPotion}\n\n${i18n.t("system.surpriseRoundReminder")}`
      : (inCombat || en.length > 0) && !isInitiativeWin && !isNarrativeDefeat
        ? `${choiceWithPotion}\n\n${i18n.t("system.combatTurnReminder")}`
        : choiceWithPotion;
    try {
      const reply = await callDM({
        character: c, hp: h, inventory: inv, effects: eff,
        history: msgs, userMessage: apiMessage,
        spellSlots: stateRef.current.spellSlots,
        language, arc: stateRef.current.arc,
        gold: stateRef.current.gold, ac: c.ac,
        artifactBonus: stateRef.current.artifactBonus,
        silentFallback: t("dm.silent"),
      });
      await processAndSetMessages(c, h, inv, eff, en, reply, newMsgs);
    } catch {
      const lostText = t("dm.connectionLost");
      setMessages([...newMsgs, { role: "assistant", content: lostText, parsed: parseDMResponse(lostText) }]);
    }
    setLoading(false);
  }

  async function handleRollResult(rollRes: RollResult) {
    const r = deps.pendingRoll;
    if (!r) return;
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
    await handleChoice(msg);
  }

  async function handleInitiativeResult(res: { player: number; enemy: number; playerWins: boolean }) {
    setPendingInitiative(false);
    const msg = res.playerWins
      ? i18n.t("system.initiativeWon", { player: res.player, enemy: res.enemy })
      : i18n.t("system.initiativeLost", { player: res.player, enemy: res.enemy });
    await handleChoice(msg);
  }

  return { applyParsed, processAndSetMessages, handleChoice, handleRollResult, handleInitiativeResult };
}
