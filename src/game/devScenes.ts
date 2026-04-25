// ─────────────────────────────────────────────────────────────────
// DEV SCENES
// ─────────────────────────────────────────────────────────────────
// Quick-jump test scenarios for the hidden dev panel. Labels and prompts
// come from i18n so the DM speaks the user's active language.
// ─────────────────────────────────────────────────────────────────

import type { DevScene } from "./types";

export function buildDevScenes(t: (k: string) => string): DevScene[] {
  return [
    { id: "tavern", label: t("dev.scenes.tavern"), prompt: t("dm.scenes.tavern") },
    { id: "combat", label: t("dev.scenes.combat"), prompt: t("dm.scenes.combat") },
    { id: "social", label: t("dev.scenes.social"), prompt: t("dm.scenes.social") },
    { id: "mystery", label: t("dev.scenes.mystery"), prompt: t("dm.scenes.mystery") },
    { id: "magic", label: t("dev.scenes.magic"), prompt: t("dm.scenes.magic") },
    { id: "boss", label: t("dev.scenes.boss"), prompt: t("dm.scenes.boss") },
  ];
}
