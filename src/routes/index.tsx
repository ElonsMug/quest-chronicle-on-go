import { createFileRoute } from "@tanstack/react-router";
import SoloDnD from "@/components/SoloDnD";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Shadows & Legends — Solo D&D" },
      { name: "description", content: "A solo text RPG set in the world of Grey Shore. One player, one AI Dungeon Master, endless stories." },
    ],
  }),
});

function Index() {
  return <SoloDnD />;
}
