import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import ru from "./locales/ru.json";

// ─────────────────────────────────────────────────────────────────
// i18next setup
// ─────────────────────────────────────────────────────────────────
// English is the canonical (source) language. Russian is a translation
// layered on top. Adding a new language = create another JSON file and
// register it in the resources block below.
//
// Locale persistence: we read the saved locale from localStorage at boot
// (browser-only) and save it back via setLocale().
// ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "tsl.locale";

export type Locale = "en" | "ru";
export const SUPPORTED_LOCALES: Locale[] = ["en", "ru"];
export const DEFAULT_LOCALE: Locale = "en";

export function readSavedLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ru") return saved;
  } catch {
    // ignore — private mode / disabled storage
  }
  return DEFAULT_LOCALE;
}

if (!i18n.isInitialized) {
  // CRITICAL: initialize with DEFAULT_LOCALE so SSR and the first client
  // render produce identical HTML. The saved locale is applied AFTER
  // hydration via the useHydratedLocale() hook below — applying it here
  // (even via queueMicrotask) runs before React's first commit on the
  // client and causes hydration mismatches.
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export function setLocale(locale: Locale) {
  void i18n.changeLanguage(locale);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }
}

export function getLocale(): Locale {
  const cur = i18n.language;
  return cur === "ru" ? "ru" : "en";
}

export default i18n;
