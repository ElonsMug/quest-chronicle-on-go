// ─────────────────────────────────────────────────────────────────
// OnboardingShell — orchestrates screens 1..4 then hands control to SoloDnD.
// In preview mode (?preview_onboarding=true) the flow runs without
// writing to the backend, then redirects back to the normal app.
// ─────────────────────────────────────────────────────────────────

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import SoloDnD from "@/components/SoloDnD";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const SPIRIT_NAMES = [
  "Kaelar","Thorn","Elidis","Varen","Sable","Mira",
  "Dusk","Oryn","Fael","Cinder","Wren","Aldric",
];

type Stage = "screen1" | "screen2" | "screen3" | "screen4" | "app";

export function OnboardingShell() {
  const { t } = useTranslation();
  const { loading, user, profile, save, isPreview, signInGoogle, refreshProfile } = useAuth();
  const [previewStage, setPreviewStage] = useState<Stage>("screen1");
  const [continued, setContinued] = useState(false);
  const [returningChoice, setReturningChoice] = useState<"continue" | "new" | null>(null);
  const [screen1Continued, setScreen1Continued] = useState(false);
  // True only when the profile was just created in this session.
  // Returning users (profile already in DB on load) skip the watcher lecture.
  const [justCreatedProfile, setJustCreatedProfile] = useState(false);
  const [spiritDraft, setSpiritDraft] = useState(
    () => SPIRIT_NAMES[Math.floor(Math.random() * SPIRIT_NAMES.length)],
  );
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [screen4Continued, setScreen4Continued] = useState(false);

  const watcherLines1to6 = useMemo(
    () => [1, 2, 3, 4, 5, 6].map(n => t(`onboarding.screen1_line${n}`)),
    [t],
  );

  if (loading) return <div className="min-h-screen bg-stone-950" />;

  // PREVIEW MODE: synthetic flow, no DB writes.
  if (isPreview) {
    return (
      <PreviewLayer label={t("onboarding.dev_preview_label")}>
        {previewStage === "screen1" && (
          <Screen1
            lines={watcherLines1to6}
            onContinue={() => setPreviewStage("screen2")}
            continueLabel={t("onboarding.screen1_continue")}
          />
        )}
        {previewStage === "screen2" && (
          <Screen2
            t={t}
            onSignIn={() => setPreviewStage("screen3")}
            error={null}
          />
        )}
        {previewStage === "screen3" && (
          <Screen3
            t={t}
            value={spiritDraft}
            onChange={setSpiritDraft}
            onConfirm={() => setPreviewStage("screen4")}
            saving={false}
          />
        )}
        {previewStage === "screen4" && !screen4Continued && (
          <Screen4Watcher t={t} onContinue={() => setScreen4Continued(true)} />
        )}
        {previewStage === "screen4" && screen4Continued && (
          <button
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.delete("preview_onboarding");
              window.location.replace(url.toString());
            }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-xl bg-amber-700 text-stone-900 font-bold"
          >
            ← End preview
          </button>
        )}
      </PreviewLayer>
    );
  }

  // Real flow.
  if (!user) {
    if (!screen1Continued) {
      return (
        <Screen1
          lines={watcherLines1to6}
          onContinue={() => setScreen1Continued(true)}
          continueLabel={t("onboarding.screen1_continue")}
        />
      );
    }
    return (
      <Screen2
        t={t}
        error={authError}
        onSignIn={async () => {
          setAuthError(null);
          const r = await signInGoogle();
          if (r.error) setAuthError(r.error);
        }}
      />
    );
  }

  if (!profile) {
    return (
      <Screen3
        t={t}
        value={spiritDraft}
        onChange={setSpiritDraft}
        saving={creatingProfile}
        onConfirm={async () => {
          if (!spiritDraft.trim() || creatingProfile) return;
          setCreatingProfile(true);
          const { error } = await supabase
            .from("profiles")
            .insert({ id: user.id, spirit_name: spiritDraft.trim() });
          if (!error) await refreshProfile();
          setCreatingProfile(false);
        }}
      />
    );
  }

  // Returning user with an active save: offer continue / restart.
  if (save && returningChoice === null) {
    return (
      <ReturningChoice
        t={t}
        spiritName={profile.spirit_name}
        onContinue={() => setReturningChoice("continue")}
        onNew={() => setReturningChoice("new")}
      />
    );
  }

  // Watcher lecture before the class select. Skip when continuing a save.
  if (!continued && !(save && returningChoice === "continue")) {
    return <Screen4Watcher t={t} onContinue={() => setContinued(true)} />;
  }

  return <SoloDnD restoreSave={returningChoice === "continue" ? save : null} />;
}

// ─── Screen components ──────────────────────────────────────────

function PreviewLayer({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed top-3 right-3 z-[100] text-amber-500 text-xs font-mono">{label}</div>
      {children}
    </>
  );
}

function Screen1({ lines, onContinue, continueLabel }: {
  lines: string[]; onContinue: () => void; continueLabel: string;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-12 relative"
      style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>
      <LanguageSwitcher className="absolute top-4 right-4" />
      <div className="max-w-md w-full space-y-5 text-amber-100/90 text-center text-lg leading-relaxed">
        {lines.map((line, i) => (
          <p
            key={i}
            className="opacity-0 animate-[fadein_900ms_ease-out_forwards]"
            style={{ animationDelay: `${i * 700}ms` }}
          >
            {line}
          </p>
        ))}
      </div>
      <button
        onClick={onContinue}
        className="mt-12 opacity-0 animate-[fadein_900ms_ease-out_forwards] px-8 py-3 rounded-xl border border-amber-800 bg-stone-900 text-amber-200 font-bold tracking-wide transition-colors hover:border-amber-600"
        style={{ animationDelay: `${lines.length * 700 + 300}ms`, fontFamily: "serif" }}
      >
        {continueLabel}
      </button>
      <style>{`@keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}

function Screen2({
  t, onSignIn, error,
}: { t: (k: string) => string; onSignIn: () => void; error: string | null }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-12"
      style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>
      <div className="max-w-md w-full space-y-4 text-amber-100/90 text-lg leading-relaxed">
        <p>{t("onboarding.screen2_watcher1")}</p>
        <p>{t("onboarding.screen2_watcher2")}</p>
      </div>
      <button
        onClick={onSignIn}
        className="mt-10 max-w-md w-full px-6 py-4 rounded-xl border border-amber-800 bg-stone-900 text-amber-200 font-bold transition-colors hover:border-amber-600"
        style={{ fontFamily: "serif" }}
      >
        {t("onboarding.screen2_auth_button")}
      </button>
      {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
    </div>
  );
}

function Screen3({
  t, value, onChange, onConfirm, saving,
}: {
  t: (k: string) => string;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-12"
      style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>
      <div className="max-w-md w-full space-y-6">
        <p className="text-amber-100/90 text-lg leading-relaxed">{t("onboarding.screen3_watcher")}</p>
        <input
          autoFocus
          value={value}
          onChange={e => onChange(e.target.value)}
          maxLength={32}
          placeholder={t("onboarding.screen3_placeholder")}
          className="w-full px-4 py-3 rounded-xl border border-stone-700 bg-stone-900 text-amber-100 text-2xl text-center outline-none focus:border-amber-600 transition-colors"
          style={{ fontFamily: "serif" }}
        />
        <button
          onClick={onConfirm}
          disabled={saving || !value.trim()}
          className="w-full px-6 py-4 rounded-xl bg-amber-700 text-stone-950 font-bold disabled:opacity-50"
          style={{ fontFamily: "serif" }}
        >
          {t("onboarding.screen3_confirm")}
        </button>
      </div>
    </div>
  );
}

function Screen4Watcher({
  t, onContinue,
}: { t: (k: string) => string; onContinue: () => void }) {
  const lines = [1, 2, 3, 4, 5, 6].map(n => t(`onboarding.screen4_watcher${n}`));
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-12"
      style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>
      <div className="max-w-md w-full space-y-4 text-amber-100/90 text-base leading-relaxed">
        {lines.map((line, i) => (
          <p
            key={i}
            className="opacity-0 animate-[fadein_700ms_ease-out_forwards]"
            style={{ animationDelay: `${i * 600}ms` }}
          >
            {line}
          </p>
        ))}
      </div>
      <button
        onClick={onContinue}
        className="mt-10 px-8 py-3 rounded-xl border border-amber-800 bg-stone-900 text-amber-200 font-bold opacity-0 animate-[fadein_700ms_ease-out_forwards]"
        style={{ animationDelay: `${lines.length * 600 + 300}ms`, fontFamily: "serif" }}
      >
        {t("onboarding.screen1_continue")}
      </button>
      <style>{`@keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}

function ReturningChoice({
  t, spiritName, onContinue, onNew,
}: { t: (k: string, opts?: Record<string, unknown>) => string; spiritName: string; onContinue: () => void; onNew: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-12"
      style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>
      <div className="text-amber-600 text-xs tracking-[0.4em] uppercase mb-2">
        {t("onboarding.select_subheading")}
      </div>
      <div className="text-4xl text-amber-100 mb-12" style={{ fontFamily: "serif" }}>{spiritName}</div>
      <div className="max-w-md w-full space-y-3">
        <button
          onClick={onContinue}
          className="w-full px-6 py-4 rounded-xl bg-amber-700 text-stone-950 font-bold"
          style={{ fontFamily: "serif" }}
        >
          {t("onboarding.returning_continue", { name: spiritName })}
        </button>
        <button
          onClick={onNew}
          className="w-full px-6 py-4 rounded-xl border border-stone-700 bg-stone-900 text-stone-300 font-bold"
          style={{ fontFamily: "serif" }}
        >
          {t("onboarding.returning_new")}
        </button>
      </div>
    </div>
  );
}
