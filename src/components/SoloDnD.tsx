// ─────────────────────────────────────────────────────────────────
// SoloDnD — top-level orchestrator for the solo D&D experience.
// All pure logic lives in src/game/*; all extracted UI lives in
// src/components/game/*. This component wires them together,
// owns the global game state, talks to the DM API and applies
// parsed responses.
// ─────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect, useMemo, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { initAnalytics, trackEvent } from "@/lib/analytics";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import i18n from "@/i18n";

// ─── Pure game logic ─────────────────────────────────────────────
import type {
  Stat,
  Spell,
  Character,
  ChatMessage,
  Enemy,
  Ally,
  PendingRoll,
  RollResult,
  Parsed,
} from "@/game/types";
import { buildCharacters } from "@/game/characters";
import { buildDevScenes } from "@/game/devScenes";
import { parseDMResponse } from "@/game/parser";
import { reportLanguageLeaks } from "@/game/langGuard";
import { callDM } from "@/game/api";
import { rollDice, parseDiceSides, PROFICIENCY_BONUS } from "@/game/dice";
import { isPotion } from "@/game/inventory";
import { gameReducer } from "@/game/reducer";
import { initialGameState } from "@/game/state";
import { pickRandomTemplate, computeNextArc } from "@/game/arcs";
import { varyArcWithLLM } from "@/game/arcVariation";
import { ArcCompletedScreen } from "@/components/game/ArcCompletedScreen";
import { ArcProgressBar } from "@/components/game/ArcProgressBar";

// ─── UI components ───────────────────────────────────────────────
import { EnemyHP } from "@/components/game/EnemyHP";
import { InitiativeBlock } from "@/components/game/InitiativeBlock";
import { RollBlock } from "@/components/game/RollBlock";
import { CharacterCard } from "@/components/game/CharacterCard";
import { BottomNav, CharacterTab, InventoryTab, JournalTab } from "@/components/game/GameTabs";
import { SpellPanel } from "@/components/game/SpellPanel";
import { DevPanel } from "@/components/game/DevPanel";
import { DefeatedScreen } from "@/components/game/DefeatedScreen";
import { CombatPanel } from "@/components/game/CombatPanel";

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────
export default function SoloDnD() {
  const { t, i18n: i18nInstance } = useTranslation();
  const language: "en" | "ru" = i18nInstance.language === "ru" ? "ru" : "en";

  // CHARACTERS rebuilt whenever the active language changes so the menu
  // shows localized names/items immediately.
  const characters = useMemo(() => buildCharacters(t), [t, i18nInstance.language]);
  const devScenes = useMemo(() => buildDevScenes(t), [t, i18nInstance.language]);
  const freeInputPlaceholders = useMemo(() => {
    const list = i18nInstance.t("free.placeholders", { returnObjects: true }) as unknown;
    return Array.isArray(list) ? (list as string[]) : [];
  }, [i18nInstance, i18nInstance.language]);

  // ── UI / transient state (independent flags, kept as useState) ──
  const [screen, setScreen] = useState<"select" | "game">("select");
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingRoll, setPendingRoll] = useState<PendingRoll | null>(null);
  const [pendingInitiative, setPendingInitiative] = useState(false);
  const [freeInput, setFreeInput] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [activeTab, setActiveTab] = useState<"story" | "character" | "inventory" | "journal">("story");
  const [invFilter, setInvFilter] = useState<"all" | "weapons" | "armor" | "consumables" | "quest">("all");
  const [showSpells, setShowSpells] = useState(false);
  const [showSpellMini, setShowSpellMini] = useState(false);
  const [selectingTarget, setSelectingTarget] = useState(false);
  // What the target picker is for. Null when picker is closed.
  const [pendingAction, setPendingAction] = useState<
    | { type: "attack" }
    | { type: "sneak" }
    | { type: "spell"; spell: Spell }
    | null
  >(null);
  const [freeInputPlaceholder, setFreeInputPlaceholder] = useState("");
  const [showDev, setShowDev] = useState(false);
  const [showDefeated, setShowDefeated] = useState(false);
  // Defeat is "deferred": HP=0, but we let the player read the DM's last
  // message before showing the screen. After the screen closes this flag
  // stays true — it controls showing "Retry / Menu" instead of combat buttons.
  const [defeatPending, setDefeatPending] = useState(false);
  // Once the player chooses "Finish them off" during a behavior shift, hide
  // the negotiation panel for the rest of this fight (resets on combat end
  // / new initiative).
  const [negotiationDeclined, setNegotiationDeclined] = useState(false);
  // True once the player explicitly closed the defeat screen — prevents it
  // from reappearing on subsequent DM messages while defeatPending is still on.
  const [defeatDismissed, setDefeatDismissed] = useState(false);
  // Language-switch confirmation dialog (only shown if a session is active).
  const [pendingLanguageSwitch, setPendingLanguageSwitch] = useState<{
    next: "en" | "ru";
    resolve: (ok: boolean) => void;
  } | null>(null);
  // True while the LLM is generating a flavored arc variation before the
  // very first scene of a new adventure. Shows a dedicated full-screen
  // loader so the player understands the wait.
  const [preparingArc, setPreparingArc] = useState(false);
  // True once the player has dismissed the arc-completed screen (so it
  // doesn't keep re-opening if the arc.completed flag is still true).
  const [arcCompletedDismissed, setArcCompletedDismissed] = useState(false);

  // ── Game state (single reducer — see src/game/state.ts) ─────────
  // Everything that an async DM callback needs to read after-the-fact
  // lives here. The reducer guarantees a consistent snapshot per action,
  // and `stateRef` (below) keeps the same snapshot reachable from
  // closures captured before the dispatch.
  const [game, dispatch] = useReducer(gameReducer, initialGameState);
  const {
    character,
    hp,
    inventory,
    effects,
    enemies,
    allies,
    inCombat,
    spellSlots,
    berserkChargesLeft,
    berserkUsedThisCombat,
    didDodgeLastTurn,
    defensiveStance,
    messages,
    arc,
    surpriseAdvantage,
    gold,
    heroicSurgeUsed,
    artifactBonus,
  } = game;
  const useHeroicSurge = () => dispatch({ type: "USE_HEROIC_SURGE" });
  const setArtifactBonus = (bonus: number) => dispatch({ type: "SET_ARTIFACT_BONUS", bonus });

  // ── Setter shims ────────────────────────────────────────────────
  // Thin wrappers so existing call-sites keep their familiar
  // `setX(value)` / `setX(prev => next)` shape. They forward to the
  // reducer and remain the *only* way to mutate the game state.
  const setHp = (v: number) => dispatch({ type: "SET_HP", hp: v });
  const setInventory = (v: string[] | ((prev: string[]) => string[])) =>
    typeof v === "function"
      ? dispatch({ type: "UPDATE_INVENTORY", updater: v as (p: string[]) => string[] })
      : dispatch({ type: "SET_INVENTORY", inventory: v });
  const setEffects = (v: string[] | ((prev: string[]) => string[])) =>
    typeof v === "function"
      ? dispatch({ type: "UPDATE_EFFECTS", updater: v as (p: string[]) => string[] })
      : dispatch({ type: "SET_EFFECTS", effects: v });
  const setEnemies = (v: Enemy[]) => dispatch({ type: "SET_ENEMIES", enemies: v });
  const setAllies = (v: Ally[] | ((prev: Ally[]) => Ally[])) =>
    typeof v === "function"
      ? dispatch({ type: "UPDATE_ALLIES", updater: v as (p: Ally[]) => Ally[] })
      : dispatch({ type: "SET_ALLIES", allies: v });
  const setMessages = (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) =>
    typeof v === "function"
      ? dispatch({ type: "UPDATE_MESSAGES", updater: v as (p: ChatMessage[]) => ChatMessage[] })
      : dispatch({ type: "SET_MESSAGES", messages: v });
  const setSpellSlots = (v: { current: number; max: number } | null) =>
    dispatch({ type: "SET_SPELL_SLOTS", slots: v });
  const setInCombat = (v: boolean) => dispatch({ type: "SET_IN_COMBAT", value: v });
  const setBerserkChargesLeft = (v: number | ((prev: number) => number)) => {
    const next = typeof v === "function" ? (v as (p: number) => number)(berserkChargesLeft) : v;
    dispatch({ type: "SET_BERSERK_CHARGES", value: next });
  };
  const setBerserkUsedThisCombat = (v: boolean) =>
    dispatch({ type: "SET_BERSERK_USED", value: v });
  const setDidDodgeLastTurn = (v: boolean) =>
    dispatch({ type: "SET_DID_DODGE", value: v });
  const setDefensiveStance = (v: boolean) =>
    dispatch({ type: "SET_DEFENSIVE_STANCE", value: v });
  const setSurpriseAdvantage = (v: "player" | null) =>
    dispatch({ type: "SET_SURPRISE", value: v });

  const combatStartSnapshotRef = useRef<{ hp: number; enemies: Enemy[]; allies: Ally[] } | null>(null);
  // Bonus action "potion drunk" — accumulated here and attached to the next
  // main player action.
  const pendingPotionInfoRef = useRef<string | null>(null);
  const devTaps = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Mirror of `game` for closures captured by async DM callbacks.
  // The reducer is the source of truth; this ref just makes the latest
  // snapshot reachable without re-reading hooks inside async functions.
  const stateRef = useRef(game);
  stateRef.current = game;

  useEffect(() => { initAnalytics(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, pendingRoll, pendingInitiative]);

  // Pick a fresh free-input placeholder when the placeholder list updates
  // (i.e. on first render and on every language change).
  useEffect(() => {
    if (freeInputPlaceholders.length === 0) {
      setFreeInputPlaceholder("");
      return;
    }
    const idx = Math.floor(Math.random() * freeInputPlaceholders.length);
    setFreeInputPlaceholder(freeInputPlaceholders[idx]);
  }, [freeInputPlaceholders]);

  // When defeat is "deferred" — wait until the DM is done speaking
  // (loading=false), and give the player ~2.2s to read the last message,
  // only then show the "You are defeated" screen.
  useEffect(() => {
    if (!defeatPending || loading || showDefeated || defeatDismissed) return;
    const timer = setTimeout(() => setShowDefeated(true), 2200);
    return () => clearTimeout(timer);
  }, [defeatPending, loading, showDefeated, defeatDismissed, messages]);

  // ── Save (localStorage, SSR-safe) ─────────────────────────────
  function doSave(char: Character, currentHp: number, currentInv: string[], currentEff: string[], msgs: ChatMessage[]) {
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

  // ── API: request to the /api/dm server function ───────────────
  async function callAPI(char: Character, currentHp: number, currentInv: string[], currentEff: string[], history: ChatMessage[], userMessage: string) {
    return callDM({
      character: char,
      hp: currentHp,
      inventory: currentInv,
      effects: currentEff,
      history,
      userMessage,
      spellSlots: stateRef.current.spellSlots,
      language,
      arc: stateRef.current.arc,
      gold: stateRef.current.gold,
      ac: char.ac,
      artifactBonus: stateRef.current.artifactBonus,
      silentFallback: t("dm.silent"),
    });
  }

  // ── Apply parsed DM response ──────────────────────────────────
  function applyParsed(parsed: Parsed, currentHp: number, currentInv: string[], currentEff: string[], currentEnemies: Enemy[]) {
    let newHp = currentHp;
    let newInv = [...currentInv];
    const newEff = [...currentEff];
    let newEnemies = [...currentEnemies];

    if (parsed.damage) {
      // Anti-oneshot guard: while the player is above 50% HP, cap a single
      // incoming damage value to 60% of maxHp. This protects ALL classes
      // (especially fragile ones like the Mage with 8 HP) from being killed
      // in one die roll from full health.
      // Below 50% the cap lifts — at low HP any blow can finish the player.
      // EXCEPTION: if a boss is present in the current fight, the cap is
      // disabled. Bosses are chapter climaxes and their signature attacks
      // must be allowed to land for full lethal damage.
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
      // Don't show the defeat screen immediately — let the DM finish narrating.
      // We just mark the defeat as "pending"; the effect above will pick up
      // the flag and open the screen with a delay once the DM is done.
      if (newHp <= 0) { setDefeatPending(true); setDefeatDismissed(false); }
    }

    // [PLAYER_HP: N] — narrative HP restore (after rescue/capture etc.).
    // Clears the "defeated" overlay state since the story now continues.
    if (parsed.playerHpRestore !== null && parsed.playerHpRestore !== undefined) {
      const ch = stateRef.current.character;
      const cap = ch ? ch.maxHp : parsed.playerHpRestore;
      newHp = Math.max(1, Math.min(cap, parsed.playerHpRestore));
      setHp(newHp);
      setDefeatPending(false);
      setDefeatDismissed(false);
      setShowDefeated(false);
    } else if (newHp <= 0 && (parsed.combatEnd || parsed.combatEndType === "narrative")) {
      // Safety net: the DM ended combat narratively (player defeated path) but
      // forgot the [PLAYER_HP: N] tag. Without HP restore the player is stuck
      // at 0 with no way to act. Default to 1 HP — the story continues, the
      // player is "barely alive". Better than a softlock; matches the prompt's
      // documented minimum for the rescue path.
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
          // if the old item is missing — just add the new one
          newInv = [...newInv, up.to];
          changed = true;
        }
      }
      if (changed) setInventory(newInv);
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
      // Safety net: DM forgot to declare enemies via [ENEMY:] but the narrative
      // clearly describes a fight. Try to extract names and HP from text by
      // the "Name (HP: X/Y)" pattern. Keep multilingual combat hints to also
      // catch DM responses written in Russian.
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

    // Allies: spawning and damage
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
      // Reset combat state on combat end
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

    // [SURPRISE: player] — DM granted a free attack round. Mark combat as
    // active (without [INITIATIVE]) and remember the advantage so the next
    // player action skips the enemy retaliation reminder.
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

    // On combat end — strip the Berserk effect from the list
    if (parsed.combatEnd || (newEnemies.length > 0 && newEnemies.every(e => e.hp <= 0))) {
      const cleaned = finalEffects.filter(e => !/berserk|берсерк/i.test(e));
      if (cleaned.length !== finalEffects.length) {
        finalEffects = cleaned;
        setEffects(cleaned);
      }
    }

    // On a new combat start — reset dodge, defensive stance and UI flags
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

  // Auto attack-roll: computes d20+mod+prof vs AC, builds a system message
  // for the DM, sends it via handleChoice. No RollBlock — instant.
  async function executeAttackRoll(req: { weapon: string; dice: string; mod: number; ac: number; targetName?: string }) {
    const hitRoll = rollDice(20);
    const prof = PROFICIENCY_BONUS;
    const total = hitRoll + req.mod + prof;
    const crit = hitRoll === 20;
    const autoMiss = hitRoll === 1;
    const hit = !autoMiss && (crit || total >= req.ac);
    let damage = 0;
    if (hit) {
      const dmgDice = parseDiceSides(req.dice || "d6");
      damage = crit
        ? rollDice(dmgDice) + rollDice(dmgDice) + req.mod
        : rollDice(dmgDice) + req.mod;
      if (damage < 1) damage = 1;
    }
    const tname = req.targetName ? `, target: ${req.targetName}` : "";
    const tagName = req.targetName ?? "Name";
    let msg: string;
    if (autoMiss) {
      msg = i18n.t("system.attackAutoMiss", { weapon: req.weapon, target: tname, ac: req.ac });
    } else if (crit) {
      msg = i18n.t("system.attackCrit", { weapon: req.weapon, target: tname, ac: req.ac, damage, tagName });
    } else if (hit) {
      msg = i18n.t("system.attackHit", { weapon: req.weapon, target: tname, ac: req.ac, damage, tagName, roll: hitRoll, mod: req.mod, prof, total });
    } else {
      msg = i18n.t("system.attackMiss", { weapon: req.weapon, target: tname, ac: req.ac, roll: hitRoll, mod: req.mod, prof, total });
    }
    await handleChoice(msg);
  }

  // Resolve enemy attacks on the client. Each [ENEMY_ATTACK: Name] from the
  // DM rolls d20 + ATK vs player AC and applies damage directly. Returns a
  // human-readable log to be appended as an assistant system message.
  async function executeEnemyAttacks(
    attackerNames: string[],
    currentEnemies: Enemy[],
    playerAc: number,
  ): Promise<string> {
    const results: string[] = [];
    for (const name of attackerNames) {
      const enemy = currentEnemies.find(
        e => e.hp > 0 && e.name.toLowerCase() === name.toLowerCase()
      );
      if (!enemy) continue;
      const roll = rollDice(20);
      const total = roll + enemy.attackBonus;
      const crit = roll === 20;
      const autoMiss = roll === 1;
      const hit = !autoMiss && (crit || total >= playerAc);
      let dmgDealt = 0;
      if (hit) {
        const dmgDice = parseDiceSides(enemy.damage);
        const dmgMod = parseInt(enemy.damage.split("+")[1] || "0");
        dmgDealt = crit
          ? rollDice(dmgDice) + rollDice(dmgDice) + dmgMod
          : rollDice(dmgDice) + dmgMod;
        if (dmgDealt < 1) dmgDealt = 1;
        const ch = stateRef.current.character;
        const livingEnemies = currentEnemies.filter(e => e.hp > 0);
        const bossPresent = livingEnemies.some(e => e.isBoss);
        if (ch && !bossPresent) {
          const cap = Math.max(1, Math.floor(ch.maxHp * 0.6));
          if (dmgDealt > cap && stateRef.current.hp > ch.maxHp * 0.5) {
            dmgDealt = cap;
          }
        }
        const newHp = Math.max(0, stateRef.current.hp - dmgDealt);
        setHp(newHp);
        if (newHp <= 0) {
          setDefeatPending(true);
          setDefeatDismissed(false);
        }
      }
      if (crit) {
        results.push(i18n.t("combat_log.enemyAttackCrit", { name: enemy.name, dmg: dmgDealt }));
      } else if (autoMiss) {
        results.push(i18n.t("combat_log.enemyAttackMiss", {
          name: enemy.name, roll: 1, atk: enemy.attackBonus,
          total: 1 + enemy.attackBonus, ac: playerAc,
        }));
      } else if (hit) {
        results.push(i18n.t("combat_log.enemyAttackHit", {
          name: enemy.name, roll, atk: enemy.attackBonus,
          total, ac: playerAc, dmg: dmgDealt,
        }));
      } else {
        results.push(i18n.t("combat_log.enemyAttackMiss", {
          name: enemy.name, roll, atk: enemy.attackBonus,
          total, ac: playerAc,
        }));
      }
    }
    return results.join("\n");
  }

  async function processAndSetMessages(char: Character, currentHp: number, currentInv: string[], currentEff: string[], currentEnemies: Enemy[], reply: string, prevMessages: ChatMessage[]) {
    const parsed = parseDMResponse(reply);
    // Dev-only: warn in console if the DM leaked Latin words into a Russian
    // narrative. Helps catch prompt regressions before they ship.
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
        const attackLog = await executeEnemyAttacks(
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

    // ── Arc progression ────────────────────────────────────────
    // Detect bosses that died THIS scene by diffing live-before vs. after.
    // Phase 3 → any enemy kill is treated as the mid-boss (the prompt forces
    //          a single mid-boss combat in this phase).
    // Phase 5 → only enemies flagged isBoss count as the final-boss kill.
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
      // Compute next phase deterministically (same response = +1 scene).
      const nextArc = computeNextArc(arcAfterKills, parsed, stateRef.current.inCombat);
      if (nextArc !== arcAfterKills || nextArc !== currentArc) {
        dispatch({ type: "SET_ARC", arc: nextArc });
      }
    }

    // Snapshot the start of every fight — used by the "Restart fight" button
    if (parsed.initiativeTrigger) {
      const snapEnemies = (parsed.newEnemies?.length ? parsed.newEnemies : stateRef.current.enemies).map(e => ({ ...e }));
      const snapAllies = stateRef.current.allies.map(a => ({ ...a }));
      combatStartSnapshotRef.current = { hp: newHp, enemies: snapEnemies, allies: snapAllies };
    }

    let autoAttackReq: { weapon: string; dice: string; mod: number; ac: number } | null = null;

    // In combat, attacks only flow through player combat buttons — not via
    // DM-initiated [ATTACK:] tags. If the DM sends [ATTACK:] in combat
    // anyway (ignoring the prompt), drop the tag so we don't auto-attack
    // after winning initiative.
    const wasInCombat = stateRef.current.enemies.length > 0 || currentEnemies.length > 0;

    if (parsed.initiativeTrigger) {
      setPendingInitiative(true);
      setPendingRoll(null);
    } else if (parsed.attackRequest && !wasInCombat) {
      // Attack outside combat (e.g. an ambush sneak attack) — auto-roll
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

    doSave(char, newHp, newInv, newEff, newMsgs);
    trackEvent("scene_completed", {
      characterId: char.id,
      messageNumber: newMsgs.length,
      inCombat: stateRef.current.enemies.length > 0,
    });

    if (autoAttackReq) {
      // Run the auto-roll asynchronously after the current tick so state has applied
      setTimeout(() => { void executeAttackRoll(autoAttackReq!); }, 0);
    }

    return newMsgs;
  }

  // ── Game start ────────────────────────────────────────────────
  async function startGame(char: Character, customPrompt?: string) {
    const startInv = [...char.startItems];
    // Pick a random narrative arc skeleton for this hero's class.
    const template = pickRandomTemplate(char.id);
    setScreen("game");
    setPreparingArc(true);
    setArcCompletedDismissed(false);
    // Block on LLM-flavored arc variation (≈2-3s). Fallback to bare
    // template on any failure — game must never softlock here.
    const arc = await varyArcWithLLM(template, char, language);
    setPreparingArc(false);
    // Single atomic init — sets character, hp, inventory, spellSlots, arc
    // and resets effects/enemies/allies/inCombat/berserk/dodge/defensive/messages.
    dispatch({ type: "START_GAME", character: char, startInventory: startInv, arc });
    setPendingRoll(null);
    setPendingInitiative(false);
    setShowSpellMini(false);
    setSelectingTarget(false);
    setLoading(true);
    trackEvent("game_started", {
      characterId: char.id,
      messageNumber: 0,
      characterName: char.name,
      arcTemplateId: template.id,
    });
    const prompt = customPrompt || t("dm.startPrompt");
    try {
      // stateRef still mirrors the PREVIOUS game state at this microtask;
      // pass the freshly-built arc explicitly via callDM so the very first
      // scene already sees the arc context.
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
      await processAndSetMessages(char, char.hp, startInv, [], [], reply, []);
    } catch {
      const errText = t("dm.connectionError");
      setMessages([{ role: "assistant", content: errText, parsed: parseDMResponse(errText) }]);
    }
    setLoading(false);
  }

  // Start a fresh arc for the SAME hero — used by the ArcCompletedScreen.
  async function handleStartNewArc() {
    const ch = stateRef.current.character;
    if (!ch) return;
    setArcCompletedDismissed(true);
    await startGame(ch);
  }

  // ── Choice handling ───────────────────────────────────────────
  async function handleChoice(choiceText: string) {
    if (loading) return;
    const { character: c, hp: h, inventory: inv, effects: eff, enemies: en, messages: msgs } = stateRef.current;
    if (!c) return;
    setFreeInput(false);
    setFreeText("");
    setPendingRoll(null);
    setPendingInitiative(false);
    const newMsgs: ChatMessage[] = [...msgs, { role: "user", content: choiceText }];
    setMessages(newMsgs);
    setLoading(true);
    // After EVERY player action in combat — append a system rule so enemies
    // are forced to attack in this same DM response.
    // Exception: the "[Initiative won: ...]" message itself — enemies don't
    // act there; we wait for the player's first action.
    const isInitiativeWin = /Initiative won/i.test(choiceText);
    // The "player defeated, narrative continues" message ends the fight —
    // no enemy turn should follow.
    const isNarrativeDefeat = /Player defeated/i.test(choiceText);
    // If a potion was drunk as a bonus action — attach it to the main action
    // in ONE request so the DM describes both the potion and the attack
    // before enemies retaliate.
    const potionInfo = pendingPotionInfoRef.current;
    pendingPotionInfoRef.current = null;
    const choiceWithPotion = potionInfo ? `${potionInfo}\n${choiceText}` : choiceText;
    // Surprise round: this player action is "free" — enemies do NOT retaliate.
    // Send a different system reminder and clear the flag immediately.
    const surpriseActive = stateRef.current.surpriseAdvantage === "player";
    if (surpriseActive) setSurpriseAdvantage(null);
    const apiMessage = surpriseActive
      ? `${choiceWithPotion}\n\n${i18n.t("system.surpriseRoundReminder")}`
      : (inCombat || en.length > 0) && !isInitiativeWin && !isNarrativeDefeat
        ? `${choiceWithPotion}\n\n${i18n.t("system.combatTurnReminder")}`
        : choiceWithPotion;
    try {
      const reply = await callAPI(c, h, inv, eff, msgs, apiMessage);
      await processAndSetMessages(c, h, inv, eff, en, reply, newMsgs);
    } catch {
      const lostText = t("dm.connectionLost");
      setMessages([...newMsgs, { role: "assistant", content: lostText, parsed: parseDMResponse(lostText) }]);
    }
    setLoading(false);
  }

  // ── Roll result ───────────────────────────────────────────────
  async function handleRollResult(rollRes: RollResult) {
    const r = pendingRoll;
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

  function handleUseItem(_item: string, idx: number) {
    const { hp: h, character: c } = stateRef.current;
    if (!c) return;
    // In combat, a potion can ONLY be drunk on your turn and ONLY before the main action.
    // "Your turn" conditions: no pending request (loading), no pending roll, no pending initiative.
    if (inCombat && (loading || pendingRoll || pendingInitiative)) return;
    // Cannot drink a second potion on top of an unspent bonus action.
    if (inCombat && pendingPotionInfoRef.current) return;
    const heal = rollDice(6) + 2;
    const newHp = Math.min(c.maxHp, h + heal);
    setHp(newHp);
    setInventory(prev => prev.filter((_, i) => i !== idx));
    
    if (inCombat) {
      // Bonus action: do NOT call the DM now, otherwise enemies attack right after the potion.
      // Apply the effect locally, show a grey system message, and the potion info is
      // attached to the next main player action (attack/dodge/special).
      pendingPotionInfoRef.current = i18n.t("system.potionBonusAction", { heal, hp: newHp, max: c.maxHp });
      const narrativeText = t("combat.potionUsed", { heal, hp: newHp, max: c.maxHp });
      const parsedText = t("combat.potionUsedNarrative", { heal, hp: newHp, max: c.maxHp });
      setMessages(prev => [...prev, {
        role: "assistant",
        content: narrativeText,
        parsed: parseDMResponse(parsedText),
      }]);
      return;
    }
    const narrativeText = t("combat.potionOutOfCombat", { heal, hp: newHp, max: c.maxHp });
    const parsedText = t("combat.potionOutOfCombatNarrative", { heal, hp: newHp, max: c.maxHp });
    setMessages(prev => [...prev, {
      role: "assistant",
      content: narrativeText,
      parsed: parseDMResponse(parsedText),
    }]);
  }

  // Use a potion on the defeated screen — heals and continues the fight
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
      role: "assistant",
      content: text,
      parsed: parseDMResponse(text),
    }]);
  }

  // Continue the story after defeat: ask the DM to narrate what happens
  // next (capture, rescue, awakening) and to restore HP via [PLAYER_HP: N].
  // Closes the defeat overlay and ends combat — control returns to the
  // narrative flow.
  async function handleContinueStory() {
    setShowDefeated(false);
    setDefeatPending(false);
    setDefeatDismissed(true);
    setSelectingTarget(false);
    setPendingAction(null);
    setShowSpellMini(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    // Clear the active combat — the player is down, the fight is over
    // narratively. The DM will write the aftermath.
    setEnemies([]);
    setAllies([]);
    setInCombat(false);
    await handleChoice(i18n.t("system.playerDefeatedNarrative"));
  }
  function handleDefeatedRetry() {
    const snap = combatStartSnapshotRef.current;
    const { character: c } = stateRef.current;
    if (!snap || !c) {
      setShowDefeated(false);
      setDefeatPending(false);
      setDefeatDismissed(false);
      return;
    }
    // UI flags first…
    setShowDefeated(false);
    setDefeatPending(false);
    setDefeatDismissed(false);
    setSelectingTarget(false);
    setShowSpellMini(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    // …then atomic snapshot restore (hp, enemies, allies, inCombat=true,
    // and combat-flag reset all in one reducer transition — no double-up).
    dispatch({
      type: "RESTORE_SNAPSHOT",
      hp: snap.hp,
      enemies: snap.enemies.map(e => ({ ...e, hp: e.maxHp })),
      allies: snap.allies ? snap.allies.map(a => ({ ...a })) : [],
    });
    void handleChoice(i18n.t("system.retryCombat"));
  }

  function handleShortRest() {
    const { character: c, hp: h } = stateRef.current;
    if (!c || inCombat) return;
    const heal = rollDice(6);
    const newHp = Math.min(c.maxHp, h + heal);
    setHp(newHp);
    
    const text = t("combat.shortRestNarrative", { heal, hp: newHp, max: c.maxHp });
    setMessages(prev => [...prev, {
      role: "assistant",
      content: text,
      parsed: parseDMResponse(text),
    }]);
  }

  function handleLongRest() {
    const { character: c } = stateRef.current;
    if (!c || inCombat) return;
    // Atomic: hp=max, refill spell slots, reset berserk counters.
    dispatch({
      type: "LONG_REST",
      hp: c.maxHp,
      spellSlots: c.spellSlots ? { current: c.spellSlots.max, max: c.spellSlots.max } : null,
    });
    
    const text = t("combat.longRestNarrative");
    setMessages(prev => [...prev, {
      role: "assistant",
      content: text,
      parsed: parseDMResponse(text),
    }]);
  }

  // ── Combat actions ────────────────────────────────────────────
  async function handleAttack(targetName?: string) {
    const { character: ch, enemies: en, berserkChargesLeft: bcl } = stateRef.current;
    if (!ch) return;
    setSelectingTarget(false);
    setPendingAction(null);
    setDidDodgeLastTurn(false);
    let mod = ch.stats[ch.weapon.stat] || 0;
    if (bcl > 0) {
      mod += 2;
      dispatch({ type: "DECREMENT_BERSERK_CHARGE" });
    }
    if (stateRef.current.defensiveStance) {
      setDefensiveStance(false);
    }
    const target = targetName
      ? en.find(e => e.hp > 0 && e.name === targetName)
      : en.find(e => e.hp > 0);
    const ac = target?.ac ?? 12;
    await executeAttackRoll({ weapon: ch.weapon.name, dice: ch.weapon.dice, mod, ac, targetName: target?.name });
  }

  async function handleBerserk() {
    // Atomic: charges=2, used=true, defensive=false, didDodge=false.
    dispatch({ type: "ACTIVATE_BERSERK" });
    setEffects(prev => [...prev, t("combat.berserkEffect")]);
    await handleChoice(i18n.t("system.berserkActivated"));
  }

  async function handleDefend() {
    setDefensiveStance(true);
    setDidDodgeLastTurn(false);
    await handleChoice(i18n.t("system.defendStance"));
  }

  async function handleDodge() {
    setDidDodgeLastTurn(true);
    await handleChoice(i18n.t("system.dodge"));
  }

  // Sneak attack — same target picker flow as a regular attack (rogue only).
  async function handleSneak(targetName?: string) {
    setSelectingTarget(false);
    setPendingAction(null);
    // Sneak is implemented as a normal attack; bonus damage is applied
    // narratively by the DM (it sees the system message context).
    await handleAttack(targetName);
  }

  // ── Negotiation outcomes ─────────────────────────────────────
  // "Accept surrender" / "Let them go" both end the fight client-side
  // BEFORE we ask the DM to narrate the aftermath. This prevents the
  // negotiation panel from re-appearing while the DM's reply is still
  // in flight (or if the DM forgets to write [END_COMBAT]).
  async function handleAcceptSurrender(name: string) {
    setEnemies([]);
    setAllies([]);
    setInCombat(false);
    setSelectingTarget(false);
    setPendingAction(null);
    setShowSpellMini(false);
    setNegotiationDeclined(true);
    pendingPotionInfoRef.current = null;
    await handleChoice(i18n.t("system.acceptSurrender", { name }));
  }

  async function handleLetThemGo(name: string) {
    setEnemies([]);
    setAllies([]);
    setInCombat(false);
    setSelectingTarget(false);
    setPendingAction(null);
    setShowSpellMini(false);
    setNegotiationDeclined(true);
    pendingPotionInfoRef.current = null;
    await handleChoice(i18n.t("system.letThemGo", { name }));
  }

  async function handleSpell(s: Spell, targetName?: string) {
    const slots = stateRef.current.spellSlots;
    if (!slots || slots.current <= 0) return;
    const { character: ch, enemies: en } = stateRef.current;
    if (!ch) return;
    setShowSpells(false);
    setShowSpellMini(false);
    setSelectingTarget(false);
    setPendingAction(null);
    setSpellSlots({ current: slots.current - 1, max: slots.max });
    setDidDodgeLastTurn(false);

    if (s.type === "attack") {
      // Fire Bolt — slot-based attack, auto-roll on a chosen target
      const statKey: Stat = s.stat ?? "int";
      const mod = ch.stats[statKey] || 0;
      const target = targetName
        ? en.find(e => e.hp > 0 && e.name === targetName)
        : en.find(e => e.hp > 0);
      const ac = target?.ac ?? 12;
      await executeAttackRoll({ weapon: s.name, dice: s.dice ?? "d10", mod, ac, targetName: target?.name });
      return;
    }
    if (s.type === "defense") {
      await handleChoice(i18n.t("system.shieldCast"));
      return;
    }
    if (s.type === "control" && s.id === "sleep") {
      // Pool mechanic: 5d8. The DM distributes across enemies from weakest to strongest.
      const pool = rollDice(8) + rollDice(8) + rollDice(8) + rollDice(8) + rollDice(8);
      await handleChoice(i18n.t("system.sleepCast", { pool }));
      return;
    }
    if (s.type === "control") {
      await handleChoice(i18n.t("system.controlSpellCast", { name: s.name }));
      return;
    }
    await handleChoice(i18n.t("system.spellCast", { name: s.name }));
  }

  function exitToMenu() {
    const { character: c, hp: h, inventory: inv, effects: eff, messages: msgs } = stateRef.current;
    if (c) doSave(c, h, inv, eff, msgs);
    // Single atomic reset of game state (character, hp, inventory, enemies,
    // allies, inCombat, effects, spellSlots, berserk*, dodge, defensive,
    // messages all wiped to initial values).
    dispatch({ type: "RESET_TO_MENU" });
    setScreen("select");
    setPendingRoll(null);
    setPendingInitiative(false);
  }

  function handleDevTap() {
    devTaps.current += 1;
    if (devTaps.current >= 5) {
      devTaps.current = 0;
      const { character: c, hp: h, inventory: inv, effects: eff, messages: msgs } = stateRef.current;
      if (c) doSave(c, h, inv, eff, msgs);
      setShowDev(true);
    }
  }

  async function jumpToScene(prompt: string) {
    const { character: c, hp: h, inventory: inv, effects: eff } = stateRef.current;
    if (!c) return;
    setMessages([]);
    setEnemies([]);
    setAllies([]);
    setInCombat(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    setLoading(true);
    try {
      const reply = await callAPI(c, h, inv, eff, [], prompt);
      await processAndSetMessages(c, h, inv, eff, [], reply, []);
    } catch {
      const text = t("dm.genericError");
      setMessages([{ role: "assistant", content: text, parsed: parseDMResponse(text) }]);
    }
    setLoading(false);
  }

  // Language switch confirmation: only intercept if the user is in a game
  // session (we have a character + at least one DM message), otherwise let
  // the switch happen immediately.
  function handleLanguageBeforeChange(_next: "en" | "ru"): Promise<boolean> {
    const inSession = stateRef.current.character !== null && stateRef.current.messages.length > 0;
    if (!inSession) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setPendingLanguageSwitch({ next: _next, resolve });
    });
  }

  function resolveLanguageSwitch(ok: boolean) {
    if (!pendingLanguageSwitch) return;
    pendingLanguageSwitch.resolve(ok);
    setPendingLanguageSwitch(null);
  }

  // ─────────────────────────────────────────────────────────────
  // SELECT SCREEN
  // ─────────────────────────────────────────────────────────────
  if (screen === "select") {
    return (
      <div className="min-h-screen flex flex-col relative" style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>
        <div className="absolute top-3 right-3 z-10">
          <LanguageSwitcher />
        </div>
        <div className="text-center pt-12 pb-6 px-6">
          <div className="text-amber-600 text-xs tracking-[0.4em] uppercase mb-2">{t("menu.tagline")}</div>
          <h1 className="text-4xl font-bold text-amber-100 leading-tight mb-2 whitespace-pre-line">{t("menu.title")}</h1>
          <p className="text-stone-500 text-sm">{t("menu.subtitle")}</p>
          <div className="mt-4 w-16 h-px bg-amber-700/50 mx-auto" />
        </div>
        <div className="px-4 pb-8 flex flex-col gap-3 max-w-md mx-auto w-full">
          <p className="text-stone-500 text-xs text-center mb-1 tracking-wide uppercase">{t("menu.chooseHero")}</p>
          {characters.map(char => (
            <CharacterCard key={char.id} char={char} selected={selectedChar?.id === char.id} onSelect={setSelectedChar} />
          ))}
          <button
            onClick={() => selectedChar && startGame(selectedChar)}
            disabled={!selectedChar}
            className="mt-2 w-full py-4 rounded-2xl font-bold text-lg transition-all duration-300 active:scale-95"
            style={{
              background: selectedChar ? "linear-gradient(135deg,#d97706 0%,#92400e 100%)" : "#292524",
              color: selectedChar ? "#0c0a09" : "#57534e",
              boxShadow: selectedChar ? "0 4px 24px rgba(217,119,6,0.3)" : "none",
              letterSpacing: "0.05em",
            }}>
            {selectedChar ? t("menu.startAs", { name: selectedChar.name }) : t("menu.selectCharacter")}
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // GAME SCREEN
  // ─────────────────────────────────────────────────────────────
  const lastMsg = messages[messages.length - 1];
  // `parsed` is what the bottom action area binds to. Out-of-combat client-only
  // events (drank a potion, took a short rest) append a synthetic assistant
  // message with no choices — if we used that as `parsed`, the player would
  // be stranded without buttons (softlock). Walk back to the most recent
  // assistant message that actually carries choices, so the previous DM
  // choices stay live until the DM speaks again.
  let parsed = lastMsg?.parsed;
  if (lastMsg?.role === "assistant" && (!parsed?.choices || parsed.choices.length === 0)) {
    for (let i = messages.length - 2; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      if (m.parsed?.choices && m.parsed.choices.length > 0) {
        parsed = m.parsed;
        break;
      }
    }
  }
  // Defeat is registered (HP=0). When the defeat screen is closed, we show
  // "Retry / Menu" instead of combat buttons so the player can re-read the
  // journal or continue.
  const hasPotion = inventory.some(isPotion);
  const showDefeatActions = defeatPending && !showDefeated && !loading;

  // ── Behavior shift / negotiation moment ──────────────────────
  // Pick the leader: the enemy with the highest maxHp (matches how the prompt
  // declares ONE leader per encounter via [ENEMY:]). When that leader drops
  // below 40% HP AND the enemy side has lost its tactical advantage, the DM
  // is instructed to pause and let the player choose surrender/continue/let go.
  // We surface those choices as dedicated UI.
  const liveEnemies = enemies.filter(e => e.hp > 0);
  const leader = liveEnemies.length
    ? [...liveEnemies].sort((a, b) => b.maxHp - a.maxHp)[0]
    : null;
  // Enemy side has tactical advantage when they outnumber player+allies.
  // Player counts as 1; allies count as living allies.
  const liveAllies = allies.filter(a => a.hp > 0).length;
  const enemyHasAdvantage = liveEnemies.length > 1 + liveAllies;
  const leaderInShift = !!(
    leader && leader.hp / leader.maxHp < 0.4 && leader.hp > 0 && !enemyHasAdvantage
  );
  // Explicit DM signal beats client-side heuristic — surrender/flee always
  // opens negotiation; escalate explicitly suppresses it.
  const dmShift = parsed?.behaviorShift ?? null;
  const negotiationActive =
    dmShift === "surrender" || dmShift === "flee"
      ? true
      : dmShift === "escalate"
        ? false
        : leaderInShift;
  const showNegotiation =
    !loading && !freeInput && !pendingRoll && !pendingInitiative &&
    !showDefeated && !defeatPending && inCombat && negotiationActive &&
    !negotiationDeclined && !!character;

  function openTargetPickerOr(
    action: { type: "attack" } | { type: "sneak" } | { type: "spell"; spell: Spell },
    fallback: () => void,
  ) {
    const live = stateRef.current.enemies.filter(e => e.hp > 0);
    if (live.length > 1) {
      setPendingAction(action);
      setSelectingTarget(true);
    } else {
      fallback();
    }
  }

  const showCombatButtons = !loading && !freeInput && !pendingRoll && !pendingInitiative && !showDefeated && !defeatPending && inCombat && !!character;
  const showChoices = !loading && !freeInput && !pendingRoll && !pendingInitiative && !showDefeated && !defeatPending && !inCombat && (parsed?.choices?.length ?? 0) > 0;
  const showFreeArea = freeInput && !loading && !defeatPending;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>

      {showSpells && character && spellSlots && (
        <SpellPanel
          character={character}
          spellSlots={spellSlots}
          onSpell={handleSpell}
          onClose={() => setShowSpells(false)}
        />
      )}
      {showDev && <DevPanel scenes={devScenes} onJump={jumpToScene} onClose={() => setShowDev(false)} />}
      {showDefeated && (
        <DefeatedScreen
          hasPotion={inventory.some(isPotion)}
          onContinueStory={() => void handleContinueStory()}
          onUsePotion={handleDefeatedUsePotion}
          onRetry={handleDefeatedRetry}
          onMenu={() => { setShowDefeated(false); setDefeatPending(false); setDefeatDismissed(false); exitToMenu(); }}
          onClose={() => { setShowDefeated(false); setDefeatDismissed(true); }}
        />
      )}
      {arc?.completed && !arcCompletedDismissed && !preparingArc && (
        <ArcCompletedScreen
          arc={arc}
          onStartNewArc={() => void handleStartNewArc()}
          onMenu={() => { setArcCompletedDismissed(true); exitToMenu(); }}
        />
      )}
      {preparingArc && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center px-6" style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)" }}>
          <div className="text-amber-600 text-xs tracking-[0.4em] uppercase mb-3">{t("arc.preparing.tagline")}</div>
          <div className="text-amber-200 text-xl font-bold text-center mb-4 max-w-sm leading-relaxed" style={{ fontFamily: "serif" }}>
            {t("arc.preparing.title")}
          </div>
          <div className="flex gap-1.5 items-center">
            {[0, 1, 2].map(i => (
              <span key={i} className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
          <div className="text-stone-500 text-xs mt-6 max-w-sm text-center leading-relaxed">
            {t("arc.preparing.subtitle")}
          </div>
        </div>
      )}

      {pendingLanguageSwitch && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.85)" }}>
          <div className="max-w-sm w-full bg-stone-900 border border-stone-700 rounded-2xl p-6">
            <div className="text-amber-200 font-bold text-lg mb-2" style={{ fontFamily: "serif" }}>
              {t("language.switchDuringGame.title")}
            </div>
            <div className="text-stone-400 text-sm leading-relaxed mb-5">
              {t("language.switchDuringGame.body")}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => resolveLanguageSwitch(false)}
                className="flex-1 py-2.5 rounded-xl border border-stone-700 bg-stone-800 text-stone-300 text-sm font-bold transition-colors hover:text-stone-100"
                style={{ fontFamily: "serif" }}
              >
                {t("language.switchDuringGame.cancel")}
              </button>
              <button
                onClick={() => resolveLanguageSwitch(true)}
                className="flex-[2] py-2.5 rounded-xl font-bold text-sm text-stone-900 transition-transform active:scale-95"
                style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}
              >
                {t("language.switchDuringGame.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-20 border-b border-stone-800/60 backdrop-blur" style={{ background: "rgba(12,10,9,0.93)" }}>
        <div className="flex items-center justify-between px-4 py-2.5 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={exitToMenu} className="text-stone-500 text-sm hover:text-stone-300 transition-colors whitespace-nowrap">← {t("common.menu")}</button>
            <LanguageSwitcher onBeforeChange={handleLanguageBeforeChange} />
          </div>

          <div className="text-center cursor-pointer select-none" onClick={handleDevTap}>
            <div className="text-amber-200 text-sm font-bold">{character?.emoji} {character?.name}</div>
          </div>

          <div className="flex items-center gap-2 min-w-[60px] justify-end">
            <div className="flex items-center gap-1.5">
              <div className="text-xs text-stone-500">{t("stats.hp")}</div>
              <div className="font-bold text-sm" style={{ color: character && hp / character.maxHp > 0.5 ? "#4ade80" : character && hp / character.maxHp > 0.25 ? "#fbbf24" : "#ef4444" }}>{hp}</div>
              <div className="text-stone-600 text-xs">/{character?.maxHp}</div>
            </div>
            <div className="flex items-center gap-1 text-amber-400 text-sm font-bold" title={t("inventory.wallet")}>
              🪙<span>{gold}</span>
            </div>
          </div>
        </div>

        {activeTab === "story" && inCombat && enemies.filter(e => e.hp > 0).length > 0 && (
          <div className="px-4 pb-2 space-y-1 border-t border-stone-800/40 pt-2">
            {surpriseAdvantage === "player" && (
              <div className="text-amber-400 text-[10px] uppercase tracking-widest font-bold mb-1">
                ⚡ {t("combat.surpriseRound", { defaultValue: "Surprise round" })}
              </div>
            )}
            {enemies.filter(e => e.hp > 0).map((en, i) => (
              <EnemyHP
                key={i}
                name={en.name}
                hp={en.hp}
                maxHp={en.maxHp}
                isLeader={!!leader && en.name === leader.name && enemies.filter(e => e.hp > 0).length > 1}
              />
            ))}
          </div>
        )}
        {activeTab === "story" && inCombat && allies.filter(a => a.hp > 0).length > 0 && (
          <div className="px-4 pb-2 space-y-1">
            {allies.filter(a => a.hp > 0).map((ally, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-green-400 text-xs truncate max-w-[100px]">⚔ {ally.name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-stone-800 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.round(ally.hp / ally.maxHp * 100)}%`, background: "#4ade80" }} />
                </div>
                <span className="text-xs text-green-400 font-bold">{ally.hp}/{ally.maxHp}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeTab === "character" && character && (
        <CharacterTab
          character={character}
          hp={hp}
          spellSlots={spellSlots}
          effects={effects}
        />
      )}
      {activeTab === "inventory" && (
        <InventoryTab
          inventory={inventory}
          effects={effects}
          gold={gold}
          inCombat={inCombat}
          canUsePotion={showCombatButtons && !pendingPotionInfoRef.current}
          filter={invFilter}
          onFilterChange={setInvFilter}
          onUseItem={handleUseItem}
          onShortRest={handleShortRest}
          onLongRest={handleLongRest}
        />
      )}
      {activeTab === "journal" && <JournalTab arc={arc} />}

      {activeTab === "story" && (<>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ paddingBottom: "320px" }}>
        {messages.map((msg, i) => {
          if (msg.role === "user") {
            const isSystem = msg.content.startsWith("[");
            return (
              <div key={i} className="flex justify-end">
                <div className={`max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed ${
                  isSystem
                    ? "bg-stone-950 border border-stone-800 text-stone-500 text-xs font-mono"
                    : "bg-stone-800 text-stone-300"
                }`}>
                  {isSystem ? msg.content.replace(/^\[/, "").replace(/\]$/, "") : msg.content}
                </div>
              </div>
            );
          }
          const p = msg.parsed || parseDMResponse(msg.content);
          const isLast = i === messages.length - 1;
          return (
            <div key={i} className="space-y-2">
              <div className="bg-stone-900/60 rounded-2xl rounded-tl-sm px-4 py-4 border border-stone-800/40 max-w-full overflow-hidden">
                <p className="text-amber-100/90 text-sm leading-relaxed whitespace-pre-line" style={{ fontFamily: "serif", overflowWrap: "break-word", wordBreak: "break-word" }}>
                  {p.narrative}
                </p>
                {p.newItem && <div className="mt-2 text-xs text-amber-500">✦ {t("dm.receivedItem", { item: p.newItem })}</div>}
              </div>
              {p.damage ? (
                <div className="flex justify-end">
                  <div className="rounded-xl border border-red-900/40 bg-stone-950/80 px-3 py-1.5 text-xs text-red-400 font-mono">
                    ⚡ {t("combat.damageToPlayer", { amount: p.damage })}
                  </div>
                </div>
              ) : null}
              {isLast && pendingInitiative && <InitiativeBlock dexMod={character?.stats.dex ?? 0} onResult={handleInitiativeResult} />}
              {isLast && pendingRoll && !pendingInitiative && (
                <RollBlock type={pendingRoll.type} request={pendingRoll.request} onResult={handleRollResult} />
              )}
            </div>
          );
        })}

        {loading && (
          <div className="bg-stone-900/60 rounded-2xl rounded-tl-sm px-4 py-4 border border-stone-800/40">
            <div className="flex gap-1.5 items-center">
              <div className="text-amber-600 text-xs tracking-widest">{t("dm.thinking")}</div>
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1 h-1 bg-amber-600 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="fixed left-0 right-0 z-10" style={{ bottom: "56px", background: "linear-gradient(0deg,#0c0a09 60%,transparent 100%)" }}>
        <div className="px-4 pb-4 pt-3 max-w-md mx-auto space-y-2">
          {showDefeatActions && (
            <>
              <div className="text-center text-xs text-stone-500 pb-1" style={{ fontFamily: "serif" }}>
                {t("defeated.footer")}
              </div>
              <button onClick={() => void handleContinueStory()}
                className="w-full py-3 rounded-xl font-bold text-stone-900 active:scale-95 transition-transform"
                style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}>
                📖 {t("defeated.continueStory")}
              </button>
              {hasPotion && (
                <button onClick={handleDefeatedUsePotion}
                  className="w-full py-3 rounded-xl border border-amber-900/60 bg-stone-900 text-amber-200 font-bold">
                  🧪 {t("defeated.drinkPotion")}
                </button>
              )}
              <button onClick={handleDefeatedRetry}
                className="w-full py-3 rounded-xl border border-stone-700 bg-stone-900 text-stone-300 text-sm font-bold"
                style={{ fontFamily: "serif" }}>
                ⚔️ {t("defeated.retry")}
              </button>
              <button onClick={() => { setDefeatPending(false); setDefeatDismissed(false); exitToMenu(); }}
                className="w-full py-3 rounded-xl border border-stone-800 bg-stone-950 text-stone-500 text-sm"
                style={{ fontFamily: "serif" }}>
                ← {t("defeated.returnToMenu")}
              </button>
            </>
          )}
          {showNegotiation && leader && (
            <div className="space-y-2">
              <div className="text-center text-xs text-amber-500/80 pb-1" style={{ fontFamily: "serif" }}>
                {t("negotiation.prompt", { name: leader.name })}
              </div>
              <button
                onClick={() => void handleAcceptSurrender(leader.name)}
                className="w-full py-3 rounded-xl font-bold text-stone-900 active:scale-95 transition-transform"
                style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}>
                🤝 {t("negotiation.accept")}
              </button>
              <button
                onClick={() => { setNegotiationDeclined(true); void handleChoice(i18n.t("system.keepAttacking", { name: leader.name })); }}
                className="w-full py-3 rounded-xl border border-red-900/60 bg-stone-900 text-red-300 font-bold active:scale-95 transition-transform"
                style={{ fontFamily: "serif" }}>
                ⚔️ {t("negotiation.keepAttacking")}
              </button>
              <button
                onClick={() => void handleLetThemGo(leader.name)}
                className="w-full py-3 rounded-xl border border-stone-700 bg-stone-900 text-stone-300 font-bold active:scale-95 transition-transform"
                style={{ fontFamily: "serif" }}>
                🚪 {t("negotiation.letGo")}
              </button>
              <button
                onClick={() => setFreeInput(true)}
                className="w-full text-center px-3 py-2 text-xs text-stone-500 hover:text-stone-300 transition-colors">
                ✍ {t("negotiation.freeAction")}
              </button>
            </div>
          )}
          {showCombatButtons && character && !showNegotiation && (
            <>
              <CombatPanel
                character={character}
                berserkUsedThisCombat={berserkUsedThisCombat}
                didDodgeLastTurn={didDodgeLastTurn}
                spellSlots={spellSlots}
                showSpellMini={showSpellMini}
                spells={character.spells}
                onAttackClick={() => openTargetPickerOr({ type: "attack" }, () => void handleAttack())}
                onSpecial={() => {
                  if (character.id === "warrior") void handleBerserk();
                  else if (character.id === "rogue") {
                    // Sneak attack — pick a target like a regular attack.
                    openTargetPickerOr({ type: "sneak" }, () => void handleSneak());
                  }
                  else if (character.id === "mage") setShowSpellMini(v => !v);
                }}
                onDefend={() => {
                  if (character.id === "warrior") void handleDefend();
                  else void handleDodge();
                }}
                onToggleSpells={() => setShowSpellMini(v => !v)}
                onCastSpell={(s) => {
                  // Attacking spells (Fire Bolt) go through the same target picker.
                  if (s.type === "attack") {
                    openTargetPickerOr({ type: "spell", spell: s }, () => void handleSpell(s));
                  } else {
                    void handleSpell(s);
                  }
                }}
                onFreeInput={() => {
                  trackEvent("free_input_used", { characterId: character.id, messageNumber: messages.length, inCombat: true });
                  setFreeInput(true);
                }}
              />
              {selectingTarget && pendingAction && (
                <div className="space-y-1 pl-2 border-l-2 border-amber-900/60">
                  <div className="text-xs text-stone-500 px-2">{t("combat.selectTarget")}</div>
                  {enemies.filter(e => e.hp > 0).map((en, i) => (
                    <button key={i}
                      onClick={() => {
                        const action = pendingAction;
                        setSelectingTarget(false);
                        setPendingAction(null);
                        if (action.type === "attack") void handleAttack(en.name);
                        else if (action.type === "sneak") void handleSneak(en.name);
                        else if (action.type === "spell") void handleSpell(action.spell, en.name);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg bg-stone-900 border border-stone-700 hover:border-amber-700 text-amber-100 text-sm transition-colors"
                      style={{ fontFamily: "serif" }}>
                      {en.name}
                      <span className="text-stone-500 text-xs ml-2">{en.hp}/{en.maxHp} HP</span>
                    </button>
                  ))}
                  <button onClick={() => { setSelectingTarget(false); setPendingAction(null); }}
                    className="w-full text-center px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors">
                    {t("common.cancel")}
                  </button>
                </div>
              )}
            </>
          )}

          {showChoices && parsed && (
            <>
              {parsed.choices
                .filter(choice => !/free\s*(choice|action)|свой\s*вариант/i.test(choice.text))
                .map((choice, i) => (
                <button key={i} onClick={() => handleChoice(choice.text)} disabled={loading}
                  className="w-full text-left px-4 py-3 rounded-xl border border-stone-700 bg-stone-900/95 text-amber-100 text-sm leading-snug transition-all active:scale-[0.98] hover:border-amber-700/50 hover:bg-stone-800"
                  style={{ fontFamily: "serif", overflowWrap: "break-word", wordBreak: "break-word" }}>
                  <span className="text-amber-600 font-bold mr-2">{choice.num}.</span>{choice.text}
                </button>
              ))}
              <button disabled={loading} onClick={() => {
                trackEvent("free_input_used", {
                  characterId: stateRef.current.character?.id,
                  messageNumber: stateRef.current.messages.length,
                });
                setFreeInput(true);
              }}
                className="w-full text-left px-4 py-3 rounded-xl border border-stone-800 bg-stone-950/90 text-stone-400 text-sm transition-all active:scale-[0.98] hover:border-stone-600 hover:text-stone-300"
                style={{ fontFamily: "serif" }}>
                <span className="text-stone-600 mr-2">✍</span>{t("dm.freeChoiceLabel")}
              </button>
            </>
          )}

          {showFreeArea && (
            <>
              <textarea autoFocus value={freeText} onChange={e => setFreeText(e.target.value)}
                placeholder={freeInputPlaceholder}
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-stone-600 bg-stone-900 text-amber-100 text-sm leading-relaxed resize-none outline-none focus:border-amber-700 transition-colors"
                style={{ fontFamily: "serif" }} />
              <div className="flex gap-2">
                <button disabled={loading} onClick={() => { setFreeInput(false); setFreeText(""); }}
                  className="flex-1 py-2.5 rounded-xl border border-stone-700 bg-stone-900 text-stone-400 text-sm hover:text-stone-300 transition-colors">
                  {t("common.cancel")}
                </button>
                <button onClick={() => freeText.trim() && handleChoice(freeText.trim())}
                  disabled={!freeText.trim()}
                  className="flex-[2] py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
                  style={{
                    background: freeText.trim() ? "linear-gradient(135deg,#d97706,#92400e)" : "#292524",
                    color: freeText.trim() ? "#0c0a09" : "#57534e"
                  }}>
                  {t("common.act")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      </>)}

      <BottomNav active={activeTab} onChange={setActiveTab} t={t} />
    </div>
  );
}

