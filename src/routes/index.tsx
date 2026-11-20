import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import SoloDnD from "@/components/SoloDnD";
import { AuthProvider } from "@/auth/AuthContext";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";

export const Route = createFileRoute("/")({
  component: Index,
  validateSearch: (search: Record<string, unknown>): { playtest?: "lighthouse" | "full" } => {
    const { playtest } = search;
    return import.meta.env.DEV && (playtest === "lighthouse" || playtest === "full")
      ? { playtest }
      : {};
  },
  head: () => ({
    meta: [
      { title: "Shadows & Legends — Solo D&D" },
      { name: "description", content: "A solo text RPG set in the world of Grey Shore. One player, one AI Dungeon Master, endless stories." },
    ],
  }),
});

function Index() {
  const { playtest } = Route.useSearch();
  const [localPlaytest, setLocalPlaytest] = useState<boolean | null>(null);
  useEffect(() => {
    if (playtest) {
      setLocalPlaytest(["localhost", "127.0.0.1"].includes(window.location.hostname));
    }
  }, [playtest]);

  if (playtest && localPlaytest !== false) {
    return localPlaytest
      ? <AuthProvider localPlaytest><SoloDnD lighthouseOnly={playtest === "lighthouse"} /></AuthProvider>
      : <div className="min-h-screen bg-stone-950" />;
  }

  return (
    <AuthProvider>
      <OnboardingShell />
    </AuthProvider>
  );
}
