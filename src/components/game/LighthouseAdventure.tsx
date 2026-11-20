import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { requestDmResult } from "@/game/api";
import {
  advanceLighthouse,
  lighthouseActions,
  lighthouseEnemy,
  startLighthouse,
  type LighthouseAction,
  type LighthouseEvent,
  type LighthouseState,
} from "@/game/lighthouseAdventure";
import type { Character } from "@/game/types";

type Turn = {
  state: LighthouseState;
  events: LighthouseEvent[];
  action?: LighthouseAction;
};

type Usage = { requests: number; unreported: number; input: number; output: number; model?: string };

type Run = {
  state: LighthouseState;
  narrative: string;
  events: LighthouseEvent[];
  pending: Turn | null;
  usage: Usage;
};

function newRun(hero: Character): Run {
  return {
    state: startLighthouse(hero),
    narrative: "",
    events: [],
    pending: null,
    usage: { requests: 0, unreported: 0, input: 0, output: 0 },
  };
}

function restoreRun(key: string, hero: Character): Run {
  try {
    const saved = window.sessionStorage.getItem(key);
    if (saved) {
      const run = JSON.parse(saved) as Partial<Run> | null;
      if (run?.state && run.usage && typeof run.narrative === "string" && Array.isArray(run.events)) {
        return { ...run, state: run.state, usage: run.usage, narrative: run.narrative, events: run.events, pending: run.pending ?? null };
      }
    }
  } catch {
    // A blocked or invalid browser store still allows a fresh run.
  }
  return newRun(hero);
}

const button = "w-full rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-left text-amber-100 hover:border-amber-500 disabled:opacity-50";

export function LighthouseAdventure({ hero, playerId, onExit }: {
  hero: Character;
  playerId?: string;
  onExit: () => void;
}) {
  const { t, i18n } = useTranslation();
  const storageKey = `tsl.lighthouse.v1.${playerId ?? "local"}.${hero.id}`;
  const [run, setRun] = useState(() => restoreRun(storageKey, hero));
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const { state, narrative, events, pending, usage } = run;
  const started = narrative !== "";

  function saveRun(next: Run) {
    setRun(next);
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // The run can continue in memory.
    }
  }

  const eventText = ({ key, values }: LighthouseEvent) => t(`lighthouse.event.${key}`, values);
  const enemy = lighthouseEnemy(state.scene);

  async function narrate(turn: Turn) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    const attempt: Run = {
      ...run,
      pending: turn,
      usage: { ...usage, requests: usage.requests + 1, unreported: usage.unreported + 1 },
    };
    saveRun(attempt);
    const next = turn.state;
    const activeEnemy = lighthouseEnemy(next.scene);
    try {
      const reply = await requestDmResult({
        purpose: "lighthouse",
        system: [
          "You are the Dungeon Master for a short solo adventure in Grey Shore.",
          i18n.language === "ru" ? "Write entirely in Russian Cyrillic. Address the hero as ты." : "Write entirely in English.",
          "Write 2–4 brief atmospheric sentences in second person, plain prose only.",
          "The game engine controls facts, checks, combat, and outcomes. Narrate only the supplied facts and resolved events.",
          "Do not invent clues, enemy reinforcements, rolls, damage, choices or outcomes. Do not reveal a clue before it is discovered.",
        ].join(" "),
        messages: [{
          role: "user",
          content: JSON.stringify({
            premise: t("lighthouse.premise"),
            hero: hero.name,
            heroHp: next.hp,
            scene: t(`lighthouse.scene.${next.scene}`),
            previousScene: turn.action ? t(`lighthouse.scene.${state.scene}`) : undefined,
            action: turn.action ? t(`lighthouse.action.${turn.action}`) : null,
            clues: next.clues.map(key => eventText({ key })),
            events: turn.events.map(eventText),
            opponent: activeEnemy ? { name: t(`lighthouse.enemy.${activeEnemy.name}`), hp: next.enemyHp } : null,
          }),
        }],
      });
      const text = reply.text?.trim();
      if (!text) throw new Error("Empty Master reply");
      const { input, output } = reply.usage ?? {};
      saveRun({
        state: next,
        narrative: text,
        events: turn.events,
        pending: null,
        usage: {
          ...attempt.usage,
          input: usage.input + (input ?? 0),
          output: usage.output + (output ?? 0),
          unreported: usage.unreported + (input === undefined || output === undefined ? 1 : 0),
          model: reply.model ?? usage.model,
        },
      });
    } catch {
      // Keep the same turn and dice results available for retry.
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  function choose(action: LighthouseAction) {
    if (inFlight.current || pending) return;
    const turn = advanceLighthouse(state, action, hero);
    if (turn) void narrate({ ...turn, action });
  }

  return (
    <main className="min-h-screen bg-stone-950 px-4 py-8 text-amber-100">
      <div className="mx-auto max-w-lg space-y-6">
        <header>
          <p className="mb-1 text-sm text-amber-500">{t("menu.tagline")}</p>
          <h1 className="text-3xl font-bold">{t("lighthouse.title")}</h1>
          <p className="mt-2 text-sm text-stone-400">{hero.name} · {state.hp}/{hero.maxHp} HP</p>
        </header>

        {!started && <p className="leading-relaxed">{t("lighthouse.premise")}</p>}
        {narrative && (
          <section className="rounded-2xl border border-stone-800 bg-stone-900 p-4">
            <p className="whitespace-pre-line leading-relaxed">{narrative}</p>
            {events.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-stone-700 pt-3 text-sm text-stone-300">
                {events.map((event, index) => <li key={index}>{eventText(event)}</li>)}
              </ul>
            )}
          </section>
        )}
        {started && state.clues.length > 0 && (
          <details className="rounded-xl border border-stone-800 p-3">
            <summary className="cursor-pointer font-medium">{t("lighthouse.clues")}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-300">
              {state.clues.map(key => <li key={key}>{eventText({ key })}</li>)}
            </ul>
          </details>
        )}
        {enemy && (
          <p className="text-sm text-amber-400">
            {t("lighthouse.enemyHp", { enemy: t(`lighthouse.enemy.${enemy.name}`), hp: state.enemyHp })} · {t("lighthouse.round", { round: state.round })}
          </p>
        )}
        {loading && <p role="status" className="text-amber-400">{t("dm.thinking")}</p>}
        {pending && !loading && (
          <section className="space-y-2">
            <p role="alert" className="text-sm text-amber-400">{t("lighthouse.unavailable")}</p>
            <button className={button} disabled={loading} onClick={() => void narrate(pending)}>{t("lighthouse.retry")}</button>
          </section>
        )}
        {!started && !pending && (
          <button className={button} disabled={loading} onClick={() => void narrate({ state, events: [] })}>
            {t("lighthouse.start")}
          </button>
        )}
        {started && !state.outcome && !pending && (
          <section className="space-y-2">
            <h2 className="font-semibold">{t("lighthouse.choices")}</h2>
            {lighthouseActions(state).map(action => (
              <button key={action} className={button} disabled={loading} onClick={() => choose(action)}>
                {t(`lighthouse.action.${action}`)}
              </button>
            ))}
          </section>
        )}
        {state.outcome && (
          <section className="space-y-3 rounded-2xl border border-amber-900 bg-stone-900 p-4">
            <h2 className="text-xl font-semibold">{t(`lighthouse.outcome.${state.outcome}`)}</h2>
            <h3 className="font-medium">{t("lighthouse.report")}</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-2 text-sm">
              {usage.model && <><dt>{t("lighthouse.model")}</dt><dd>{usage.model}</dd></>}
              <dt>{t("lighthouse.requests")}</dt><dd>{usage.requests.toLocaleString(i18n.language)}</dd>
              <dt>{t("lighthouse.input")}</dt><dd>{usage.input.toLocaleString(i18n.language)}</dd>
              <dt>{t("lighthouse.output")}</dt><dd>{usage.output.toLocaleString(i18n.language)}</dd>
              <dt>{t("lighthouse.total")}</dt><dd>{(usage.input + usage.output).toLocaleString(i18n.language)}</dd>
            </dl>
            {usage.unreported > 0 && <p className="text-sm text-stone-300">{t("lighthouse.partial", { count: usage.unreported })}</p>}
          </section>
        )}
        {state.outcome && (
          <button className={button} onClick={() => saveRun(newRun(hero))}>{t("lighthouse.restart")}</button>
        )}
        <button disabled={loading} onClick={onExit} className="py-2 text-sm text-stone-400 hover:text-amber-100 disabled:opacity-50">
          {t("lighthouse.return")}
        </button>
      </div>
    </main>
  );
}
