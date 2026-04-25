// ─────────────────────────────────────────────────────────────────
// LANGUAGE LEAK DETECTOR
// ─────────────────────────────────────────────────────────────────
// When the active UI language is Russian, the DM narrative MUST be Cyrillic.
// English may appear ONLY inside [SQUARE_BRACKET_TAGS] (technical contract
// with the parser). This helper scans cleaned narrative text for stray Latin
// words and reports leaks to the dev console — making prompt regressions
// easy to spot without instrumenting every call site.
//
// We intentionally do NOT auto-correct or block rendering. The goal is
// observability: every leak shows up as a single grouped warning with the
// offending words and the message context. If leaks become rare, we can
// flip this into a hard guard later (auto-regenerate via system message).
// ─────────────────────────────────────────────────────────────────

// Words allowed to appear in Latin even inside Russian narrative — proper
// nouns we intentionally keep as-is, mechanical D&D abbreviations the player
// is expected to read in English, and the system message brackets.
const LATIN_ALLOWLIST = new Set([
  "d&d", "hp", "ac", "dc", "dmg", "xp", "str", "dex", "int", "wis", "cha", "con",
  "d4", "d6", "d8", "d10", "d12", "d20", "d100",
  "npc", "ai", "dm",
]);

// Strip everything that's a legitimate place to find Latin:
//   - [bracketed tags]
//   - inline numbers / dice notation already covered by allowlist
function stripBracketedTags(text: string): string {
  return text.replace(/\[[^\]]*\]/g, " ");
}

/**
 * Returns the list of Latin "words" (≥3 chars) found in narrative that should
 * have been Cyrillic. Empty array means clean.
 */
export function findLatinLeaks(narrative: string): string[] {
  const cleaned = stripBracketedTags(narrative);
  // Match runs of latin letters (with optional inner apostrophe/hyphen).
  // Length ≥3 filters out noise like "a", "in", roman numerals etc.
  const re = /[A-Za-z][A-Za-z'\-]{2,}/g;
  const leaks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const w = m[0];
    if (LATIN_ALLOWLIST.has(w.toLowerCase())) continue;
    leaks.push(w);
  }
  return leaks;
}

/**
 * Dev-time leak reporter. Runs only when the UI language is Russian.
 * Logs once per DM message; production is silent (logs cost nothing — the
 * scan is O(n) over short narratives — but they help us tighten prompts).
 */
export function reportLanguageLeaks(
  narrative: string,
  language: "en" | "ru",
  context?: string,
): void {
  if (language !== "ru" || !narrative) return;
  const leaks = findLatinLeaks(narrative);
  if (leaks.length === 0) return;
  // Deduplicate while preserving order — easier to scan in console.
  const unique = Array.from(new Set(leaks));
  // eslint-disable-next-line no-console
  console.warn(
    `[lang-leak] RU narrative contains Latin word(s): ${unique.join(", ")}`,
    context ? `\n  context: "${context.slice(0, 120)}${context.length > 120 ? "…" : ""}"` : "",
  );
}
