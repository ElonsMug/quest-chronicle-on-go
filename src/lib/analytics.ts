import posthog from "posthog-js";

// ⚠️ Замени на свой PostHog Project API Key (начинается с phc_)
const POSTHOG_KEY = "phc_mYgFZnxYooWPSy6K5dm7wZJJ7XxqThLTY7zRtovNH8zk";
const POSTHOG_HOST = "https://app.posthog.com";

let initialized = false;

export function initAnalytics() {
  if (initialized) return;
  if (typeof window === "undefined") return;
  if (!POSTHOG_KEY || POSTHOG_KEY === "phc_YOUR_KEY_HERE") {
    // Ключ не задан — тихо отключаемся, чтобы не ронять прод.
    return;
  }
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    person_profiles: "identified_only",
  });
  initialized = true;
}

export type AnalyticsEvent =
  | "game_started"
  | "scene_completed"
  | "combat_started"
  | "combat_ended"
  | "free_input_used"
  | "session_saved";

export function trackEvent(
  event: AnalyticsEvent,
  props: { characterId?: string | null; messageNumber?: number } & Record<string, unknown> = {}
) {
  if (!initialized) return;
  const { characterId, messageNumber, ...rest } = props;
  posthog.capture(event, {
    character_id: characterId ?? null,
    message_number: messageNumber ?? null,
    ...rest,
  });
}
