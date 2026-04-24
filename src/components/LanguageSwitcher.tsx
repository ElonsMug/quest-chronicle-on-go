import { useTranslation } from "react-i18next";
import { setLocale, type Locale, SUPPORTED_LOCALES } from "@/i18n";

/**
 * Compact two-button language switcher. Renders inline pill buttons
 * "EN | RU" — used in screens where space is tight (header, menu corner).
 *
 * The optional `onBeforeChange` hook lets a parent intercept the click
 * (e.g. show a confirmation dialog when a game is in progress). Returning
 * `false` cancels the switch.
 */
export function LanguageSwitcher({
  className = "",
  onBeforeChange,
}: {
  className?: string;
  onBeforeChange?: (next: Locale) => boolean | Promise<boolean>;
}) {
  const { i18n, t } = useTranslation();
  const current = (i18n.language === "ru" ? "ru" : "en") as Locale;

  async function handle(next: Locale) {
    if (next === current) return;
    if (onBeforeChange) {
      const ok = await onBeforeChange(next);
      if (!ok) return;
    }
    setLocale(next);
  }

  const labels: Record<Locale, string> = {
    en: "EN",
    ru: "RU",
  };

  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className={`inline-flex items-center rounded-full border border-stone-700 bg-stone-900/80 p-0.5 text-xs ${className}`}
    >
      {SUPPORTED_LOCALES.map((loc) => {
        const active = loc === current;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => void handle(loc)}
            aria-pressed={active}
            title={loc === "en" ? t("language.english") : t("language.russian")}
            className={`px-2.5 py-1 rounded-full font-bold transition-colors ${
              active
                ? "bg-amber-700/80 text-stone-950"
                : "text-stone-400 hover:text-amber-200"
            }`}
            style={{ fontFamily: "serif", letterSpacing: "0.05em" }}
          >
            {labels[loc]}
          </button>
        );
      })}
    </div>
  );
}
