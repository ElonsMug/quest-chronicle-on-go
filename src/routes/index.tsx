import { createFileRoute } from "@tanstack/react-router";
import SoloDnD from "@/components/SoloDnD";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Тени & Легенды — Соло D&D" },
      { name: "description", content: "Соло текстовая RPG в мире Серого Берега. Один игрок, один мастер-ИИ, бесконечные истории." },
    ],
  }),
});

function Index() {
  return <SoloDnD />;
}
