// ─────────────────────────────────────────────────────────────────
// AuthContext — Supabase session + profile + saved game.
// Loads on mount, listens for auth changes, exposes refresh/signOut.
// ─────────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export type Profile = { id: string; spirit_name: string; created_at: string };
export type GameSave = {
  id: string;
  user_id: string;
  class_id: string;
  gender: string | null;
  // game_state is the full GameState snapshot (see src/game/state.ts).
  // Typed loosely here on purpose — restoration happens in SoloDnD.
  game_state: Record<string, unknown>;
  updated_at: string;
};

type AuthCtx = {
  loading: boolean;
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  save: GameSave | null;
  isPreview: boolean;
  refreshProfile: () => Promise<void>;
  refreshSave: () => Promise<void>;
  signInGoogle: () => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [save, setSave] = useState<GameSave | null>(null);

  const isPreview =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview_onboarding") === "true";

  const loadProfile = useCallback(async (uid: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    setProfile((data as Profile | null) ?? null);
  }, []);

  const loadSave = useCallback(async (uid: string) => {
    const { data } = await supabase.from("game_saves").select("*").eq("user_id", uid).maybeSingle();
    setSave((data as GameSave | null) ?? null);
  }, []);

  // Auth listener FIRST, then session check (avoids race conditions).
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        // Defer DB calls so we don't deadlock the auth callback.
        setTimeout(() => {
          void loadProfile(sess.user.id);
          void loadSave(sess.user.id);
        }, 0);
      } else {
        setProfile(null);
        setSave(null);
      }
    });

    void supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        await Promise.all([loadProfile(data.session.user.id), loadSave(data.session.user.id)]);
      }
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, [loadProfile, loadSave]);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  const refreshSave = useCallback(async () => {
    if (user) await loadSave(user.id);
  }, [user, loadSave]);

  const signInGoogle = useCallback(async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) return { error: result.error.message ?? "Sign-in failed" };
    return {};
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const resetOnboarding = useCallback(async () => {
    if (!user) return;
    await supabase.from("game_saves").delete().eq("user_id", user.id);
    await supabase.from("profiles").delete().eq("id", user.id);
    await supabase.auth.signOut();
    if (typeof window !== "undefined") window.location.reload();
  }, [user]);

  return (
    <Ctx.Provider
      value={{
        loading, user, session, profile, save, isPreview,
        refreshProfile, refreshSave, signInGoogle, signOut, resetOnboarding,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
