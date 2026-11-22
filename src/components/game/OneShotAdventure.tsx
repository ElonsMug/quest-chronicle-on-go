import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { requestDmResult } from "@/game/api";
import {
  advanceOneShot, chooseRecipe, oneShotChoices, oneShotFoe, oneShotPlanSchema,
  oneShotScene, startOneShot, type OneShotChoice, type OneShotEvent, type OneShotPlan, type Recipe,
} from "@/game/oneShot";
import { oneShotIntentRequest, oneShotSetupRequest, type OneShotLanguage } from "@/game/oneShotMaster";
import { downloadJson } from "@/game/sessionReport";
import type { Character } from "@/game/types";

const button = "rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-left text-amber-100 hover:border-amber-500 disabled:opacity-50";
const intentSchema = z.object({ id: z.string().nullable(), message: z.string().max(650) });
const emptyUsage = { requests: 0, input: 0, output: 0, unreported: 0, model: "" };
const recentKey = "tsl.oneshot.recent-missions";
type Entry = { action: string; input?: string; scene: string; events: OneShotEvent[]; from: string; to: string };

function nextRecipe() {
  let recent: string[] = [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    if (Array.isArray(stored)) recent = stored.filter((value): value is string => typeof value === "string").slice(-3);
  } catch {
    // Fixed-length recent history is optional.
  }
  return chooseRecipe(recent);
}

export function OneShotAdventure({ hero, language, onExit }: {
  hero: Character;
  language: OneShotLanguage;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const [recipe, setRecipe] = useState(nextRecipe);
  const [state, setState] = useState(() => startOneShot(hero));
  const [plan, setPlan] = useState<OneShotPlan | null>(null);
  const [history, setHistory] = useState<Entry[]>([]);
  const [usage, setUsage] = useState(emptyUsage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState("");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);

  const request = useCallback(async (payload: Parameters<typeof requestDmResult>[0]) => {
    setUsage(previous => ({ ...previous, requests: previous.requests + 1 }));
    try {
      const reply = await requestDmResult(payload);
      const { input, output } = reply.usage ?? {};
      setUsage(previous => ({
        ...previous, model: reply.model ?? previous.model,
        input: previous.input + (input ?? 0), output: previous.output + (output ?? 0),
        unreported: previous.unreported + (input === undefined || output === undefined ? 1 : 0),
      }));
      return JSON.parse(reply.text ?? "") as unknown;
    } catch (error) {
      // Request failures have no usage report. Invalid JSON can still have reported usage.
      if (!(error instanceof SyntaxError)) {
        setUsage(previous => ({ ...previous, unreported: previous.unreported + 1 }));
      }
      throw error;
    }
  }, []);

  const prepare = useCallback(async (currentRecipe: Recipe) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(false);
    try {
      // Repair a malformed plan once, keeping the same mission and hero.
      const payload = oneShotSetupRequest(hero, currentRecipe, language);
      let raw: unknown;
      try {
        raw = await request(payload);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      const parsed = oneShotPlanSchema.safeParse(raw);
      if (parsed.success) setPlan(parsed.data);
      else {
        const repair = {
          ...payload,
          system: `${payload.system}\nThe previous draft did not satisfy the required structure. Check all required fields, distinct labels, skills and nullable objects, and regenerate.`,
        };
        setPlan(oneShotPlanSchema.parse(await request(repair)));
      }
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [hero, language, request]);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
      const recent = Array.isArray(stored) ? stored.filter(value => typeof value === "string") : [];
      if (recent.at(-1) !== recipe.mission) {
        localStorage.setItem(recentKey, JSON.stringify([...recent, recipe.mission].slice(-3)));
      }
    } catch {
      // The adventure can continue without recording recent missions.
    }
    void prepare(recipe);
  }, [prepare, recipe]);

  const latest = history.at(-1);
  const foe = plan && oneShotFoe(state, plan);
  const choices = plan
    ? oneShotChoices(state, plan, hero).map(choice => {
      const label = choice.id === "challenge" ? t("oneshot.challenge", { opponent:
        state.stage === "obstacle" ? plan.obstacle.name : state.stage === "rival" ? plan.rival?.name : plan.finale.fight?.name,
      }) : choice.id === "tip" || choice.id === "buyPotion"
        ? t(`oneshot.action.${choice.id}`, { vendor: plan.vendor?.name })
        : choice.label || t(`oneshot.action.${choice.id}`);
      return { ...choice, label };
    })
    : [];

  function apply(choice: OneShotChoice, customInput?: string) {
    if (!plan) return;
    const turn = advanceOneShot(state, choice.id, plan, hero);
    if (!turn) return;
    setState(turn.state);
    setHistory(previous => [...previous, {
      action: choice.label, input: customInput, scene: oneShotScene(state, plan), events: turn.events,
      from: state.stage, to: turn.state.ending ?? turn.state.stage,
    }]);
    setInput("");
    setPending(null);
    setNotice("");
  }

  async function sendIntent(value: string) {
    if (!plan || busy.current || !value.trim() || !choices.length) return;
    const action = value.trim();
    busy.current = true;
    setLoading(true);
    setPending(action);
    setError(false);
    setNotice("");
    try {
      const currentScene = [
        oneShotScene(state, plan),
        state.clue ? plan.clue : null,
        ...((latest?.events ?? []).flatMap(event => event.kind === "story" ? [event.text] : [])),
      ].filter(Boolean).join("\n");
      const result = intentSchema.parse(await request(oneShotIntentRequest(language, hero, currentScene, choices, action)));
      const match = choices.find(choice => choice.id === result.id);
      if (match) apply(match, action);
      else {
        setNotice(result.message.trim() || t("oneshot.noMatch"));
        setPending(null);
      }
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  function startAgain() {
    setPlan(null);
    setState(startOneShot(hero));
    setHistory([]);
    setUsage(emptyUsage);
    setInput("");
    setPending(null);
    setNotice("");
    setError(false);
    setLoading(true);
    setRecipe(nextRecipe());
  }

  function saveReport() {
    downloadJson({
      format: "solo-dnd-one-shot-report", version: 1, exportedAt: new Date().toISOString(),
      hero: hero.id, language, recipe, plan, state, history, usage, pending, error,
    }, `solo-dnd-one-shot-${recipe.id}.json`);
  }

  function eventText(event: OneShotEvent) {
    if (event.kind === "story") return event.text;
    if (event.kind === "check") {
      return t(`oneshot.${event.success ? "checkPass" : "checkFail"}`, {
        ...event, modifier: event.modifier >= 0 ? `+${event.modifier}` : event.modifier,
        skill: t(`checks.skills.${event.skill}`),
      });
    }
    if (event.kind === "attack") return t(`oneshot.${event.enemy ? "enemyAttack" : "yourAttack"}`, event);
    if (event.kind === "healing") return t("oneshot.healed", event);
    if (event.kind === "loot") return t("oneshot.loot", event);
    return t(`oneshot.${event.kind}`);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) void sendIntent(input);
  }

  return (
    <main className="min-h-screen bg-stone-950 px-5 py-8 text-stone-200" style={{ fontFamily: "serif" }}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-stone-400">
          <button className="underline hover:text-amber-100" onClick={onExit}>{t("oneshot.exit")}</button>
          <button className="underline hover:text-amber-100" onClick={saveReport}>{t("oneshot.report")}</button>
        </div>
        <header className="space-y-2 border-b border-stone-800 pb-5">
          <p className="text-sm text-amber-400">{hero.emoji} {hero.name}</p>
          <h1 className="text-3xl font-bold text-amber-100 md:text-4xl">{plan?.title ?? t("oneshot.title")}</h1>
          {plan && <p className="text-lg text-stone-300">{plan.goal}</p>}
          {plan && <p className="text-sm text-stone-400">
            {t("oneshot.resources", { hp: state.hp, max: hero.maxHp, gold: state.gold, potions: state.potions })}
            {hero.spellSlots && ` · ${t("oneshot.spellSlots", { count: state.spellSlots })}`}
          </p>}
        </header>

        <div aria-live="polite" className="space-y-3">
          {plan && !state.fight && latest && latest.from === latest.to &&
            <p className="whitespace-pre-line leading-relaxed text-amber-50">{oneShotScene(state, plan)}</p>}
          {latest && <div className="space-y-2">
            <p className="text-sm text-amber-200">{latest.input ?? latest.action}</p>
            {latest.events.map((event, index) => (
              <p key={index} className={event.kind === "story" ? "leading-relaxed" : "font-mono text-sm text-stone-400"}>
                {eventText(event)}
              </p>
            ))}
          </div>}
          {plan && !state.fight && (!latest || latest.from !== latest.to) &&
            <p className="whitespace-pre-line leading-relaxed text-amber-50">{oneShotScene(state, plan)}</p>}
          {plan && history.length === 0 && <p className="text-sm text-stone-400">{plan.stakes}</p>}
          {state.fight && <p className="text-amber-200">{t("oneshot.fight", { foe, hp: state.fight.hp, round: state.fight.round })}</p>}
          {notice && <p className="leading-relaxed">{notice}</p>}
          {loading && <p role="status" className="text-sm text-amber-300">{t(plan ? "oneshot.listening" : "oneshot.preparing")}</p>}
          {error && <p role="alert" className="text-sm text-amber-400">{t("oneshot.error")}</p>}
        </div>

        {error && !plan && <button className={button} onClick={() => void prepare(recipe)}>{t("oneshot.retrySetup")}</button>}
        {plan && !state.ending && (
          <>
            <div className="grid gap-2">
              {choices.map(choice => (
                <button key={choice.id} className={button} disabled={loading || pending !== null} onClick={() => {
                  if (!busy.current && pending === null) apply(choice);
                }}>
                  {choice.label}
                  {(choice.skill || choice.cost !== undefined) && <span className="mt-1 block text-xs text-amber-400">
                    {choice.skill ? t("oneshot.check", { skill: t(`checks.skills.${choice.skill}`), dc: choice.dc })
                      : t("oneshot.price", { gold: choice.cost })}
                  </span>}
                </button>
              ))}
            </div>
            {pending !== null && !loading ? (
              <div className="flex flex-wrap gap-2">
                <button className={button} disabled={loading} onClick={() => void sendIntent(pending)}>{t("oneshot.retryTurn")}</button>
                <button className={button} disabled={loading} onClick={() => { setPending(null); setError(false); }}>{t("oneshot.edit")}</button>
              </div>
            ) : !loading && (
              <form onSubmit={submit} className="flex gap-2">
                <input aria-label={t("oneshot.freeAction")} placeholder={t("oneshot.freeAction")} value={input}
                  maxLength={500} onChange={event => setInput(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-stone-700 bg-stone-900 px-3 py-2" />
                <button className={button} disabled={loading || !input.trim()}>{t("oneshot.send")}</button>
              </form>
            )}
          </>
        )}
        {plan && state.clue && <details className="text-sm text-stone-400">
          <summary className="cursor-pointer">{t("oneshot.clue")}</summary>
          <p className="mt-2">{plan.clue}</p>
        </details>}
        {history.length > 0 && <details className="text-sm text-stone-400">
          <summary className="cursor-pointer">{t("oneshot.journal")}</summary>
          <ol className="mt-2 space-y-3">
            {history.map((entry, index) => <li key={index}>
              {(index === 0 || history[index - 1].from !== entry.from) && <p className="whitespace-pre-line">{entry.scene}</p>}
              <p className="mt-1 text-amber-200">{entry.input ?? entry.action}</p>
              {entry.events.map((event, eventIndex) => <p key={eventIndex}>{eventText(event)}</p>)}
            </li>)}
          </ol>
        </details>}
        {state.ending && <div className="space-y-3 border-t border-stone-800 pt-4">
          <p className="text-sm text-stone-400">{t("oneshot.usage", { ...usage, total: usage.input + usage.output })}</p>
          {usage.unreported > 0 && <p className="text-sm text-stone-400">{t("oneshot.unreported", { count: usage.unreported })}</p>}
          <button className={button} onClick={startAgain}>{t("oneshot.restart")}</button>
        </div>}
      </div>
    </main>
  );
}
