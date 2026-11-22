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
import { OneShotAdventure } from "@/components/game/OneShotAdventure";
import { LighthouseAdventure } from "@/components/game/LighthouseAdventure";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { captureCombatCheckpoint, readCombatCheckpoint, type CombatCheckpoint } from "@/game/combatCheckpoint";
import { combatReference } from "@/game/combatReferences";
import { midBossArtifactBonus, readCombatLoot } from "@/game/combatLoot";
import type { Arc } from "@/game/arcs";
import { stripEnemyAttackRolls } from "@/game/combatTurn";
import { readPendingTurn, type PendingTurn } from "@/game/pendingTurn";
import i18n from "@/i18n";
import { useAuth, type GameSave } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ─── Pure game logic ─────────────────────────────────────────────
import type {
  Spell,
  Character,
  ChatMessage,
  Enemy,
  Ally,
  PendingRoll,
} from "@/game/types";
import { buildCharacters } from "@/game/characters";
import { buildDevScenes } from "@/game/devScenes";
import { parseDMResponse } from "@/game/parser";
import { callDM } from "@/game/api";
import { canSettleGold, currentSceneMessageIndex, storyChoices } from "@/game/sceneMessages";
import { isScoutKit, vendorPrice } from "@/game/vendor";
import { isDrinkPotionAction, isPotion } from "@/game/inventory";
import { downloadSessionReport } from "@/game/sessionReport";
import { gameReducer } from "@/game/reducer";
import { initialGameState } from "@/game/state";
import { ArcCompletedScreen } from "@/components/game/ArcCompletedScreen";
import { ArcProgressBar } from "@/components/game/ArcProgressBar";

// ─── Extracted hooks ─────────────────────────────────────────────
import type { GameDeps, PendingAction } from "@/hooks/useGameDeps";
import { useNarrative } from "@/hooks/useNarrative";
import { useCombat } from "@/hooks/useCombat";
import { useGameSession } from "@/hooks/useGameSession";

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
export default function SoloDnD({ restoreSave, lighthouseOnly = false, oneShotOnly = false }: {
  restoreSave?: GameSave | null;
  lighthouseOnly?: boolean;
  oneShotOnly?: boolean;
} = {}) {
  const { t, i18n: i18nInstance } = useTranslation();
  const language: "en" | "ru" = i18nInstance.language === "ru" ? "ru" : "en";
  const { user, profile, resetOnboarding } = useAuth();
  const [pendingGenderChar, setPendingGenderChar] = useState<Character | null>(null);
  const [chosenGender, setChosenGender] = useState<string | null>(null);
  const restoreDoneRef = useRef(false);

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
  const [oneShotHero, setOneShotHero] = useState<{ hero: Character; language: "en" | "ru" } | null>(null);
  const [lighthouseHero, setLighthouseHero] = useState<Character | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
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
    adventureFinds,
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
    combatLoot,
  } = game;
  const useHeroicSurge = () => dispatch({ type: "USE_HEROIC_SURGE" });

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

  const combatCheckpointRef = useRef<CombatCheckpoint | null>(null);
  const needsCombatCheckpointRef = useRef(false);
  const turnRequestInFlight = useRef(false);
  // Bonus action "potion drunk" — accumulated here and attached to the next
  // main player action.
  const pendingPotionInfoRef = useRef<string | null>(null);
  const devTaps = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const actionPanelRef = useRef<HTMLDivElement>(null);
  const [actionPanelHeight, setActionPanelHeight] = useState(320);
  const inlineStoryActions = !inCombat && !defeatPending;

  // Mirror of `game` for closures captured by async DM callbacks.
  // The reducer is the source of truth; this ref just makes the latest
  // snapshot reachable without re-reading hooks inside async functions.
  const stateRef = useRef(game);
  stateRef.current = game;

  useEffect(() => { initAnalytics(); }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, pendingRoll, pendingInitiative, inlineStoryActions]);

  useEffect(() => {
    if (!needsCombatCheckpointRef.current || loading || !game.inCombat || game.hp <= 0
      || !game.enemies.some(enemy => enemy.hp > 0)) return;
    combatCheckpointRef.current = captureCombatCheckpoint(game, pendingInitiative, pendingRoll);
    needsCombatCheckpointRef.current = false;
  }, [game, loading, pendingInitiative, pendingRoll]);

  // ── Restore from save ─────────────────────────────────────────
  useEffect(() => {
    if (!restoreSave || restoreDoneRef.current) return;
    const gs = restoreSave.game_state as Record<string, unknown>;
    const charSnap = gs.character as Character | null;
    if (!charSnap) return;
    const fresh = characters.find(c => c.id === charSnap.id);
    const ch = fresh ?? charSnap;
    restoreDoneRef.current = true;
    const savedArc = (gs.arc as Arc | undefined) ?? null;
    const savedLoot = readCombatLoot(gs.combatLoot, savedArc);
    const savedInventory = Array.isArray(gs.inventory) ? gs.inventory as string[] : [];
    const restoredFinds = Array.isArray(gs.adventureFinds) ? gs.adventureFinds.filter((item): item is string => typeof item === "string")
      : savedInventory.filter(item => !ch.startItems.includes(item));
    dispatch({ type: "START_GAME", character: ch, startInventory: savedInventory, arc: savedArc, restoredFinds });
    if (typeof gs.hp === "number") {
      dispatch({ type: "SET_HP", hp: gs.hp });
      if (gs.hp <= 0) setDefeatPending(true);
    }
    if (Array.isArray(gs.inventory)) dispatch({ type: "SET_INVENTORY", inventory: gs.inventory as string[] });
    if (Array.isArray(gs.effects)) dispatch({ type: "SET_EFFECTS", effects: gs.effects as string[] });
    if (Array.isArray(gs.enemies)) dispatch({ type: "SET_ENEMIES", enemies: gs.enemies as Enemy[] });
    if (Array.isArray(gs.allies)) dispatch({ type: "SET_ALLIES", allies: gs.allies as Ally[] });
    if (Array.isArray(gs.messages)) {
      const savedMessages = gs.messages as ChatMessage[];
      const savedEnemies = Array.isArray(gs.enemies) ? gs.enemies as Enemy[] : [];
      dispatch({ type: "SET_MESSAGES", messages: savedMessages });
      setPendingTurn(readPendingTurn(gs.pendingTurn ?? gs.pendingCombatTurn, savedMessages, savedEnemies));
      if (gs.inCombat) {
        combatCheckpointRef.current = readCombatCheckpoint(gs.combatCheckpoint, ch.id, savedMessages.length);
        if (gs.pendingInitiative === true) setPendingInitiative(true);
        if (gs.pendingRoll && typeof gs.pendingRoll === "object") setPendingRoll(gs.pendingRoll as PendingRoll);
      }
    }
    if (gs.spellSlots) dispatch({ type: "SET_SPELL_SLOTS", slots: gs.spellSlots as { current: number; max: number } });
    if (typeof gs.inCombat === "boolean") dispatch({ type: "SET_IN_COMBAT", value: gs.inCombat });
    if (typeof gs.gold === "number") dispatch({ type: "SET_GOLD", gold: gs.gold });
    dispatch({
      type: "RESTORE_COMBAT_LOOT",
      loot: savedLoot,
      artifactBonus: savedLoot.midBossClaimed && typeof gs.artifactBonus === "number" && gs.artifactBonus > 0 ? midBossArtifactBonus : 0,
    });
    setScreen("game");
  }, [restoreSave, characters]);

  // ── Auto-save (debounced) on any state change while a session is active.
  useEffect(() => {
    if (!user || !character || screen !== "game") return;
    const timer = setTimeout(() => {
      const gameState = {
        character, hp, inventory, adventureFinds, effects, enemies, allies, inCombat,
        spellSlots, messages, arc, gold, surpriseAdvantage,
        heroicSurgeUsed, artifactBonus, combatLoot, berserkChargesLeft,
        berserkUsedThisCombat, didDodgeLastTurn, defensiveStance,
        combatCheckpoint: inCombat ? combatCheckpointRef.current : null,
        pendingInitiative, pendingRoll, pendingTurn,
      };
      void supabase.from("game_saves").upsert(
        {
          user_id: user.id,
          class_id: character.id,
          gender: chosenGender,
          game_state: gameState as never,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [user, character, hp, inventory, effects, enemies, allies, inCombat,
      spellSlots, messages, arc, gold, surpriseAdvantage, heroicSurgeUsed, adventureFinds,
      artifactBonus, combatLoot, berserkChargesLeft, berserkUsedThisCombat,
      didDodgeLastTurn, defensiveStance, chosenGender, screen, pendingInitiative, pendingRoll, pendingTurn]);

  useEffect(() => {
    const panel = actionPanelRef.current;
    if (!panel || inlineStoryActions) return;
    const observer = new ResizeObserver(() => setActionPanelHeight(panel.offsetHeight));
    observer.observe(panel);
    return () => observer.disconnect();
  }, [screen, activeTab, inlineStoryActions]);

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
    if (hp > 0 || !defeatPending || loading || showDefeated || defeatDismissed) return;
    const timer = setTimeout(() => setShowDefeated(true), 2200);
    return () => clearTimeout(timer);
  }, [hp, defeatPending, loading, showDefeated, defeatDismissed, messages]);

  // ── Cross-hook function refs (wired below after hook init) ─────
  // These break the circular dependencies between useNarrative,
  // useCombat and useGameSession (handleChoice ↔ processAndSetMessages
  // ↔ executeAttackRoll ↔ doSave ↔ executeEnemyAttacks).
  const handleChoiceRef = useRef<GameDeps["handleChoiceRef"]["current"]>(async () => {});
  const processAndSetMessagesRef = useRef<GameDeps["processAndSetMessagesRef"]["current"]>(
    async () => [],
  );
  const executeAttackRollRef = useRef<GameDeps["executeAttackRollRef"]["current"]>(
    async () => {},
  );
  const executeEnemyAttacksRef = useRef<GameDeps["executeEnemyAttacksRef"]["current"]>(
    (_attackers, _enemies, _ac, hp) => ({ log: "", hp }),
  );
  const applyParsedRef = useRef<GameDeps["applyParsedRef"]["current"]>(
    () => ({ newHp: 0, newInv: [], newEff: [], newEnemies: [] }),
  );
  const doSaveRef = useRef<GameDeps["doSaveRef"]["current"]>(() => {});

  const deps: GameDeps = {
    t, language,
    stateRef, dispatch,
    setHp, setInventory, setEffects, setEnemies, setAllies, setMessages,
    setSpellSlots, setInCombat, setBerserkChargesLeft, setBerserkUsedThisCombat,
    setDidDodgeLastTurn, setDefensiveStance, setSurpriseAdvantage,
    setLoading, setPendingRoll, setPendingInitiative, setPendingTurn,
    setFreeInput, setFreeText,
    setSelectingTarget, setPendingAction: setPendingAction as React.Dispatch<React.SetStateAction<PendingAction>>,
    setShowSpellMini, setShowSpells,
    setDefeatPending, setDefeatDismissed, setShowDefeated,
    setNegotiationDeclined, setScreen, setPreparingArc, setArcCompletedDismissed,
    combatCheckpointRef, needsCombatCheckpointRef, pendingPotionInfoRef, turnRequestInFlight,
    inCombat, loading, pendingRoll, pendingInitiative, pendingTurn,
    handleChoiceRef, processAndSetMessagesRef, executeAttackRollRef,
    executeEnemyAttacksRef, applyParsedRef, doSaveRef,
  };

  const narrative = useNarrative(deps);
  const combat = useCombat(deps);
  const session = useGameSession(deps);

  // Wire up cross-hook refs every render so closures see latest state.
  handleChoiceRef.current = narrative.handleChoice;
  processAndSetMessagesRef.current = narrative.processAndSetMessages;
  applyParsedRef.current = narrative.applyParsed;
  executeAttackRollRef.current = combat.executeAttackRoll;
  executeEnemyAttacksRef.current = combat.executeEnemyAttacks;
  doSaveRef.current = session.doSave;

  const {
    handleChoice, handleRollResult, handleInitiativeResult, retryTurn,
  } = narrative;
  const {
    handleAttack, handleBerserk, handleDefend, handleDodge, handleSneak,
    handleSpell, handleAcceptSurrender, handleLetThemGo,
  } = combat;
  const {
    startGame, exitToMenu, retryOpening,
    handleShortRest, handleLongRest, handleUseItem,
    handleContinueStory, handleDefeatedRetry, handleDefeatedUsePotion,
  } = session;

  // ── API: request to the Dungeon Master (used by jumpToScene) ─
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

  function handleDevTap() {
    devTaps.current += 1;
    if (devTaps.current >= 5) {
      devTaps.current = 0;
      const { character: c, hp: h, inventory: inv, effects: eff, messages: msgs } = stateRef.current;
      if (c) session.doSave(c, h, inv, eff, msgs);
      setShowDev(true);
    }
  }

  async function jumpToScene(prompt: string) {
    if (turnRequestInFlight.current) return;
    const { character: c, hp: h, inventory: inv, effects: eff } = stateRef.current;
    if (!c) return;
    combatCheckpointRef.current = null;
    needsCombatCheckpointRef.current = false;
    setPendingTurn(null);
    setMessages([]);
    setEnemies([]);
    setAllies([]);
    setInCombat(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    setLoading(true);
    try {
      const reply = await callAPI(c, h, inv, eff, [], prompt);
      await narrative.processAndSetMessages(c, h, inv, eff, [], reply, []);
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

  if (oneShotHero) {
    return <OneShotAdventure {...oneShotHero} onExit={() => setOneShotHero(null)} />;
  }

  if (lighthouseHero) {
    return <LighthouseAdventure hero={lighthouseHero} playerId={user?.id} onExit={() => setLighthouseHero(null)} />;
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
          {profile && (
            <>
              <div className="text-amber-600 text-[10px] tracking-[0.4em] uppercase mt-5 mb-1">
                {t("onboarding.select_subheading")}
              </div>
              <div className="text-2xl text-amber-100" style={{ fontFamily: "serif" }}>
                {profile.spirit_name}
              </div>
            </>
          )}
        </div>
        <div className="px-4 pb-8 flex flex-col gap-3 max-w-md mx-auto w-full">
          <p className="text-stone-500 text-xs text-center mb-1 tracking-wide uppercase">{t("menu.chooseHero")}</p>
          {characters.map(char => (
            <CharacterCard key={char.id} char={char} selected={selectedChar?.id === char.id} onSelect={setSelectedChar} />
          ))}
          {!lighthouseOnly && <button
            onClick={() => {
              const hero = characters.find(char => char.id === selectedChar?.id);
              if (!hero) return;
              if (oneShotOnly) setOneShotHero({ hero, language });
              else if (user) setPendingGenderChar(hero);
              else void startGame(hero);
            }}
            disabled={!selectedChar}
            className="mt-2 w-full py-4 rounded-2xl font-bold text-lg transition-all duration-300 active:scale-95"
            style={{
              background: selectedChar ? "linear-gradient(135deg,#d97706 0%,#92400e 100%)" : "#292524",
              color: selectedChar ? "#0c0a09" : "#57534e",
              boxShadow: selectedChar ? "0 4px 24px rgba(217,119,6,0.3)" : "none",
              letterSpacing: "0.05em",
            }}>
            {selectedChar ? t(oneShotOnly ? "oneshot.startAs" : "menu.startAs", { name: characters.find(char => char.id === selectedChar.id)?.name }) : t("menu.selectCharacter")}
          </button>}
          {import.meta.env.DEV && !oneShotOnly && <button
            onClick={() => selectedChar && setLighthouseHero(selectedChar)}
            disabled={!selectedChar}
            className="w-full rounded-2xl border border-amber-800/70 px-4 py-3 font-semibold text-amber-200 hover:bg-stone-900 disabled:opacity-50"
          >
            {t("lighthouse.entry")}
          </button>}
        </div>
        {pendingGenderChar && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.85)" }}>
            <div className="max-w-sm w-full bg-stone-900 border border-amber-900/50 rounded-2xl p-6 space-y-3" style={{ fontFamily: "serif" }}>
              <p className="text-amber-100/90 text-base leading-relaxed">{t("onboarding.gender_prompt")}</p>
              {([
                ["male", t("onboarding.gender_male")],
                ["female", t("onboarding.gender_female")],
                ["other", t("onboarding.gender_other")],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setChosenGender(key)}
                  className={`w-full py-3 rounded-xl border text-amber-100 font-bold transition-colors ${
                    chosenGender === key ? "border-amber-500 bg-stone-800" : "border-stone-700 bg-stone-950 hover:border-amber-700"
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                disabled={!chosenGender}
                onClick={() => {
                  const ch = pendingGenderChar;
                  setPendingGenderChar(null);
                  if (ch) void startGame(ch);
                }}
                className="w-full py-3 rounded-xl bg-amber-700 text-stone-950 font-bold disabled:opacity-50"
              >
                {t("onboarding.gender_confirm")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // GAME SCREEN
  // ─────────────────────────────────────────────────────────────
  const choiceSourceMessageIndex = currentSceneMessageIndex(messages);
  const parsed = messages[choiceSourceMessageIndex]?.parsed;
  // Defeat is registered (HP=0). When the defeat screen is closed, we show
  // "Retry / Menu" instead of combat buttons so the player can re-read the
  // journal or continue.
  const hasPotion = inventory.some(isPotion);
  const showDefeatActions = hp <= 0 && defeatPending && !showDefeated && !loading;
  const canRetryCombat = inCombat && !!combatCheckpointRef.current;

  function retryCombat() {
    setActiveTab("story");
    handleDefeatedRetry();
  }

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
    !loading && !pendingTurn && !freeInput && !pendingRoll && !pendingInitiative &&
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

  const showCombatButtons = !loading && !pendingTurn && !freeInput && !pendingRoll && !pendingInitiative && !showDefeated && !defeatPending && inCombat && !!character;
  const showStoryActions = !!character && !arc?.completed && !arc?.finale && !retryOpening && !loading && !pendingTurn && !freeInput && !pendingRoll
    && !pendingInitiative && !showDefeated && !defeatPending && !inCombat;
  const goldOffer = showStoryActions ? parsed?.goldOffer : null;
  const vendor = showStoryActions ? parsed?.vendor : null;
  const vendorTipAvailable = vendor && !isScoutKit(vendor.tip) && !messages.some(message => message.vendorTip === vendor.tip);
  const vendorKitAvailable = vendor && !inventory.some(isScoutKit);
  const choiceMessage = messages[choiceSourceMessageIndex];
  const sceneChoices = parsed?.choices.some(choice => /\[(?:CHECK:|CLUE_FALLBACK:)/i.test(choice.text))
    ? parseDMResponse(choiceMessage.content).choices : parsed?.choices ?? [];
  const showFreeArea = freeInput && !arc?.finale && !arc?.completed && !loading && !pendingTurn && !defeatPending;
  function drinkFromStory(action: string) {
    if (!isDrinkPotionAction(action)) return false;
    const index = inventory.findIndex(isPotion);
    if (index >= 0) handleUseItem(inventory[index], index);
    else {
      const content = t("combat.noPotion");
      setMessages(previous => [...previous, { role: "assistant", source: "client", content, parsed: parseDMResponse(content) }]);
    }
    setFreeInput(false);
    setFreeText("");
    return true;
  }

  const displayedChoices = showStoryActions
    ? storyChoices(sceneChoices.filter(choice => !/free\s*(choice|action)|свой\s*вариант/i.test(choice.text)
      && (hasPotion || !isDrinkPotionAction(choice.text))), choiceMessage?.socialFailure)
    : [];

  function exportSession() {
    downloadSessionReport(game, {
      language, activeTab, loading, pendingRoll, pendingInitiative, showCombatButtons,
      showNegotiation, selectingTarget, freeInputOpen: freeInput, freeChoiceAvailable: showStoryActions,
      defeatPending, choiceSourceMessageIndex: displayedChoices.length > 0 ? choiceSourceMessageIndex : null,
      displayedChoices, pendingTurn,
    });
  }


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
      {showDev && <DevPanel scenes={devScenes} onJump={jumpToScene} onClose={() => setShowDev(false)} onResetOnboarding={user ? () => void resetOnboarding() : undefined} />}
      {showDefeated && hp <= 0 && (
        <DefeatedScreen
          hasPotion={inventory.some(isPotion)}
          onContinueStory={() => void handleContinueStory()}
          onUsePotion={handleDefeatedUsePotion}
          onRetry={canRetryCombat ? retryCombat : undefined}
          onMenu={() => { setShowDefeated(false); setDefeatPending(false); setDefeatDismissed(false); exitToMenu(); }}
          onClose={() => { setShowDefeated(false); setDefeatDismissed(true); }}
        />
      )}
      {arc?.completed && !arcCompletedDismissed && !preparingArc && (
        <ArcCompletedScreen
          arc={arc}
          finds={adventureFinds}
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
            <button onClick={exitToMenu} disabled={loading} className="text-stone-500 text-sm hover:text-stone-300 transition-colors whitespace-nowrap disabled:opacity-50">← {t("common.menu")}</button>
            <LanguageSwitcher disabled={loading || preparingArc || !!pendingTurn} onBeforeChange={handleLanguageBeforeChange} />
          </div>

          <div className="flex flex-col items-center text-center">
            <div className="cursor-pointer select-none text-sm font-bold text-amber-200" onClick={handleDevTap}>
              {character?.emoji} {character?.name}
            </div>
            <button
              type="button"
              onClick={exportSession}
              title={t("sessionReport.description")}
              className="text-xs text-stone-400 underline decoration-stone-700 underline-offset-2 hover:text-amber-200 focus-visible:outline-amber-500"
            >
              {t("sessionReport.save")}
            </button>
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
            {enemies.map((en, i) => en.hp > 0 && (
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
          turnLocked={loading || !!pendingTurn}
          filter={invFilter}
          onFilterChange={setInvFilter}
          onUseItem={handleUseItem}
          onShortRest={handleShortRest}
          onLongRest={handleLongRest}
        />
      )}
      {activeTab === "journal" && <JournalTab arc={arc} />}

      {activeTab === "story" && (<>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={inlineStoryActions ? undefined : { paddingBottom: actionPanelHeight + 72 }}>
        {messages.map((msg, i) => {
          if (msg.role === "user") {
            if (msg.abilityRoll) {
              const { action, skill, stat, result } = msg.abilityRoll;
              const label = skill ? t(`checks.skills.${skill}`) : t(`stats.${stat}`);
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-stone-800 px-4 py-2.5 text-sm text-stone-300">
                    {action && <p>{action}</p>}
                    <p className="mt-1 text-xs text-amber-200">
                      {label} · d20 ({result.hitRoll}) {result.mod < 0 ? "−" : "+"} {Math.abs(result.mod)} = {result.total}
                      {" · "}{t("checks.difficulty", { dc: result.dc })}
                      {" · "}{t(result.success ? "combat.success" : "combat.fail")}
                    </p>
                  </div>
                </div>
              );
            }
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
                  {msg.source === "client" ? p.narrative : stripEnemyAttackRolls(p.narrative)}
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
        {!inlineStoryActions && <div ref={bottomRef} />}
      </div>

      <div ref={actionPanelRef} className={inlineStoryActions ? "mb-14" : "fixed bottom-14 left-0 right-0 z-10 bg-stone-950"}>
        <div className="px-4 pb-4 pt-3 max-w-md mx-auto space-y-2">
          {arc?.finale && arc.finalePlan && !arc.completed && !loading && !pendingTurn && !inCombat && activeTab === "story" && (
            <div className="space-y-2">
              {arc.finale.stage === "objective" && arc.finalePlan.objective && (
                <button onClick={() => narrative.chooseFinaleAction("objective")}
                  className="w-full rounded-xl border border-amber-800 bg-stone-900 px-4 py-3 text-left font-bold text-amber-200">
                  {arc.finalePlan.objective.action}
                </button>
              )}
              {arc.finale.stage === "recognition" && (
                <>
                  {arc.finalePlan.recognition && (
                    <button onClick={() => narrative.chooseFinaleAction("report")}
                      className="w-full rounded-xl border border-amber-800 bg-stone-900 px-4 py-3 text-left font-bold text-amber-200">
                      {t("arcCompleted.reportBack", { recipient: arc.finalePlan.recognition.recipient })}
                    </button>
                  )}
                  <button onClick={() => narrative.chooseFinaleAction("finish")}
                    className="w-full rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-left text-stone-300">
                    {t("arcCompleted.continueToEnding")}
                  </button>
                </>
              )}
            </div>
          )}
          {arc?.completed && arcCompletedDismissed && (
            <button onClick={() => setArcCompletedDismissed(false)}
              className="w-full rounded-xl border border-amber-800 bg-stone-900 px-4 py-3 font-bold text-amber-200">
              {t("arcCompleted.showEnding")}
            </button>
          )}
          {retryOpening && !loading && (
            <button onClick={() => void retryOpening()}
              className="w-full rounded-xl border border-amber-800 bg-stone-900 px-4 py-3 font-bold text-amber-200">
              {t("dm.retryOpening")}
            </button>
          )}
          {pendingTurn && !loading && (
            <button onClick={() => void retryTurn()}
              className="w-full rounded-xl border border-amber-800 bg-stone-900 px-4 py-3 font-bold text-amber-200">
              {t("dm.retryTurn")}
            </button>
          )}
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
              {canRetryCombat && (
                <button onClick={retryCombat}
                  className="w-full py-3 rounded-xl border border-stone-700 bg-stone-900 text-stone-300 text-sm font-bold"
                  style={{ fontFamily: "serif" }}>
                  ⚔️ {t("defeated.retry")}
                </button>
              )}
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
                  {enemies.map((en, i) => en.hp > 0 && (
                    <button key={i}
                      onClick={() => {
                        const action = pendingAction;
                        setSelectingTarget(false);
                        setPendingAction(null);
                        const reference = combatReference("enemy", i);
                        if (action.type === "attack") void handleAttack(reference);
                        else if (action.type === "sneak") void handleSneak(reference);
                        else if (action.type === "spell") void handleSpell(action.spell, reference);
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
              {character && !heroicSurgeUsed && enemies.some(e => e.isBoss) && hp < (character.maxHp * 0.5) && (
                <button
                  onClick={async () => {
                    useHeroicSurge();
                    const bossIndex = stateRef.current.enemies.findIndex(enemy => enemy.isBoss && enemy.hp > 0);
                    if (bossIndex >= 0) await handleAttack(combatReference("enemy", bossIndex), { extraAttack: true });
                  }}
                  className="w-full py-3 rounded-xl font-bold active:scale-95 transition-transform"
                  style={{
                    background: "linear-gradient(135deg,#7c3aed,#4c1d95)",
                    fontFamily: "serif",
                    color: "#faf5ff",
                  }}
                >
                  ⚡ {t("combat_log.heroicSurge")}
                </button>
              )}
              {character && heroicSurgeUsed && enemies.some(e => e.isBoss) && (
                <div className="text-center text-xs text-stone-600 py-1">
                  ⚡ {t("combat_log.heroicSurgeUsed")}
                </div>
              )}
            </>
          )}

          {goldOffer && (<>
            <button
              type="button"
              disabled={!canSettleGold(gold, goldOffer.amount)}
              onClick={() => void narrative.confirmGoldOffer(choiceSourceMessageIndex)}
              className="w-full rounded-xl border border-amber-800 bg-stone-900 px-4 py-3 text-left text-amber-100 disabled:opacity-50"
            >
              <span className="block font-bold">
                {t(goldOffer.amount > 0 ? "goldOffer.receive" : "goldOffer.pay", { amount: Math.abs(goldOffer.amount) })}
              </span>
              <span className="block text-sm text-stone-300">{goldOffer.reason}</span>
            </button>
            {goldOffer.amount < 0 && (
              <button onClick={() => void narrative.declinePaidOffer(choiceSourceMessageIndex)}
                className="w-full rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-left text-sm text-amber-100">
                {t("goldOffer.decline")}
              </button>
            )}
          </>)}

          {vendor && (vendorTipAvailable || vendorKitAvailable) && (
            <div className="space-y-2 rounded-xl border border-amber-900/70 bg-stone-900 p-3">
              <h3 className="text-sm font-semibold text-amber-200">{t(`vendor.roles.${vendor.role}`)}</h3>
              {vendorTipAvailable && (
                <button type="button" disabled={gold < vendorPrice}
                  onClick={() => void narrative.buyFromVendor(choiceSourceMessageIndex, "tip")}
                  className="block w-full rounded-lg border border-amber-800 px-3 py-2 text-left text-sm text-amber-100 disabled:opacity-50">
                  {t("vendor.buyTip", { price: vendorPrice })}
                </button>
              )}
              {vendorKitAvailable && (
                <button type="button" disabled={gold < vendorPrice}
                  onClick={() => void narrative.buyFromVendor(choiceSourceMessageIndex, "kit")}
                  className="block w-full rounded-lg border border-amber-800 px-3 py-2 text-left text-sm text-amber-100 disabled:opacity-50">
                  <span className="block">{t("vendor.buyKit", { price: vendorPrice })}</span>
                  <span className="text-xs text-stone-300">{t("vendor.kitEffect")}</span>
                </button>
              )}
            </div>
          )}
          {vendor && displayedChoices.length === 0 && (
            <button type="button"
              onClick={() => narrative.chooseStoryAction({ num: "", text: t("vendor.leave"), check: null })}
              className="w-full rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-left text-sm text-amber-100">
              {t("vendor.leave")}
            </button>
          )}

          {showStoryActions && (
            <>
              {displayedChoices.map((choice, i) => (
                <button key={i} onClick={() => { if (!drinkFromStory(choice.text)) narrative.chooseStoryAction(choice); }} disabled={loading}
                  className="w-full text-left px-4 py-3 rounded-xl border border-stone-700 bg-stone-900/95 text-amber-100 text-sm leading-snug transition-all active:scale-[0.98] hover:border-amber-700/50 hover:bg-stone-800"
                  style={{ fontFamily: "serif", overflowWrap: "break-word", wordBreak: "break-word" }}>
                  <span className="text-amber-600 font-bold mr-2">{choice.num}.</span>{choice.text}
                  {choice.check && (
                    <span className="mt-1 block text-xs text-amber-500">
                      {t("checks.choiceLabel", {
                        skill: choice.check.skill ? t(`checks.skills.${choice.check.skill}`) : t(`stats.${choice.check.stat}`),
                        dc: choice.check.dc,
                      })}
                    </span>
                  )}
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
                <button onClick={() => { const action = freeText.trim(); if (action && !drinkFromStory(action)) void handleChoice(action); }}
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
        {inlineStoryActions && <div ref={bottomRef} className="scroll-mb-14" />}
      </div>
      </>)}

      <BottomNav active={activeTab} onChange={setActiveTab} t={t} />
    </div>
  );
}

