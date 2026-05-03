// ─────────────────────────────────────────────────────────────────
// DM RESPONSE PARSER
// ─────────────────────────────────────────────────────────────────
// Extracts structured game events from the raw text returned by the LLM.
// Tags are part of an internal contract — they are ALWAYS English even
// when the narrative is written in another language.
// ─────────────────────────────────────────────────────────────────

import type { Stat } from "./types";

function mapStatToKey(s: string): Stat {
  const l = s.toLowerCase();
  if (l.includes("str") || l.includes("сил") || l.includes("strength")) return "str";
  if (l.includes("dex") || l.includes("лов") || l.includes("dexterity")) return "dex";
  if (l.includes("con") || l.includes("вын") || l.includes("constitution")) return "con";
  if (l.includes("wis") || l.includes("мдр") || l.includes("wisdom")) return "wis";
  if (l.includes("cha") || l.includes("хар") || l.includes("charisma")) return "cha";
  return "int";
}

export function parseDMResponse(text: string) {
  const choices: { num: string; text: string }[] = [];
  const narrativeLines: string[] = [];
  let attackRequest: { weapon: string; dice: string; mod: number; ac: number } | null = null;
  let rollRequest: { stat: string; dc: number } | null = null;
  let damage: number | null = null;
  let newItem: string | null = null;
  const newItems: string[] = [];
  const upgrades: { from: string; to: string }[] = [];
  const newEnemies: { name: string; maxHp: number; hp: number; ac: number; damage: string; isUndead?: boolean; isBoss?: boolean }[] = [];
  const newAllies: { name: string; maxHp: number; hp: number }[] = [];
  const allyDamages: { name: string; damage: number }[] = [];
  const enemyDamages: { name: string; damage: number }[] = [];
  const newEffects: { name: string; duration: string }[] = [];
  let initiativeTrigger = false;
  let combatEnd = false;
  let combatEndType: "victory" | "surrender" | "retreat" | "narrative" | null = null;
  let playerHpRestore: number | null = null;
  let behaviorShift: "surrender" | "flee" | "escalate" | null = null;
  // [SURPRISE: player] — DM grants the player a free attack round before
  // [INITIATIVE]. During this round enemies do NOT retaliate.
  let surprise: "player" | "enemies" | null = null;

  // English-tag parser. Tags are part of an internal contract between the DM
  // and the parser — they do not get translated when the UI language changes.
  // The character class `[^\]]*` is intentionally permissive so a malformed
  // tag (extra space, trailing text inside brackets) still gets stripped from
  // the visible narrative even if its dedicated extractor regex doesn't fire.
  const TAG = /\[(ATTACK|ROLL|DAMAGE|ITEM|UPGRADE|ENEMY|ENEMY_DAMAGE|ALLY|ALLY_DAMAGE|EFFECT|INITIATIVE|END_COMBAT|PLAYER_HP|BEHAVIOR_SHIFT|SURPRISE|GOLD)[^\]]*\]/gi;

  const atk = text.match(/\[ATTACK:\s*([^,\]]+),\s*([^,\]]+),\s*([^,\]]+),\s*AC(\d+)\]/i);
  if (atk) attackRequest = { weapon: atk[1].trim(), dice: atk[2].trim(), mod: parseInt(atk[3]) || 0, ac: parseInt(atk[4]) };

  const rol = text.match(/\[ROLL:\s*([^,\]]+)(?:,\s*DC(\d+))?\]/i);
  if (rol) rollRequest = { stat: rol[1].trim(), dc: parseInt(rol[2] || "15") };

  // Sum every [DAMAGE: X] in the response
  const dmgRe = /\[DAMAGE:\s*(\d+)\]/gi;
  let totalDamage = 0;
  let dmgMatch: RegExpExecArray | null;
  while ((dmgMatch = dmgRe.exec(text)) !== null) {
    totalDamage += parseInt(dmgMatch[1]);
  }
  if (totalDamage > 0) damage = totalDamage;

  let goldChange: number | null = null;
  const goldMatch = text.match(/\[GOLD:\s*([+-]?\d+)\]/i);
  if (goldMatch) goldChange = parseInt(goldMatch[1]);

  const itemRe = /\[ITEM:\s*([^\]]+)\]/gi;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(text)) !== null) {
    const name = im[1].trim();
    if (name) {
      newItems.push(name);
      if (newItem === null) newItem = name;
    }
  }

  const upgradeRe = /\[UPGRADE:\s*([^\]]+?)\s*->\s*([^\]]+?)\]/gi;
  let um: RegExpExecArray | null;
  while ((um = upgradeRe.exec(text)) !== null) {
    upgrades.push({ from: um[1].trim(), to: um[2].trim() });
  }

  // Extended [ENEMY: Name, HP:N, AC:N, DMG:dX+Y, UNDEAD, BOSS]
  // UNDEAD and BOSS are optional flags and may appear in any order at the tail.
  const enemyRe = /\[ENEMY:\s*([^,\]]+),\s*HP:(\d+)(?:,\s*AC:(\d+))?(?:,\s*DMG:([^\],]+))?((?:,\s*(?:UNDEAD|BOSS))*)\s*\]/gi;
  let em: RegExpExecArray | null;
  while ((em = enemyRe.exec(text)) !== null) {
    const hp = parseInt(em[2]);
    const flags = (em[5] || "").toUpperCase();
    const isUndead = /\bUNDEAD\b/.test(flags);
    // Explicit BOSS flag from the DM, OR heuristic: a single solo enemy with
    // HP > 20 (per the EPIC encounter cap) is treated as a boss as a safety
    // net in case the DM forgets the tag.
    const explicitBoss = /\bBOSS\b/.test(flags);
    newEnemies.push({
      name: em[1].trim(),
      maxHp: hp,
      hp,
      ac: em[3] ? parseInt(em[3]) : 12,
      damage: em[4] ? em[4].trim() : "d4+1",
      isUndead,
      isBoss: explicitBoss,
    });
  }
  // Heuristic boss promotion: if exactly one enemy was declared in this
  // response and its HP exceeds the leader cap (20), mark it as a boss so the
  // anti-oneshot guard correctly steps aside.
  if (newEnemies.length === 1 && newEnemies[0].maxHp > 20) {
    newEnemies[0].isBoss = true;
  }

  const allyRe = /\[ALLY:\s*([^,\]]+),\s*HP:(\d+)\]/gi;
  let am: RegExpExecArray | null;
  while ((am = allyRe.exec(text)) !== null) {
    const hp = parseInt(am[2]);
    newAllies.push({ name: am[1].trim(), maxHp: hp, hp });
  }

  const allyDmgRe = /\[ALLY_DAMAGE:\s*([^,\]]+),\s*(\d+)\]/gi;
  let adm: RegExpExecArray | null;
  while ((adm = allyDmgRe.exec(text)) !== null) {
    allyDamages.push({ name: adm[1].trim(), damage: parseInt(adm[2]) });
  }

  const edRe = /\[ENEMY_DAMAGE:\s*([^,\]]+),\s*(\d+)\]/gi;
  let ed: RegExpExecArray | null;
  while ((ed = edRe.exec(text)) !== null) enemyDamages.push({ name: ed[1].trim(), damage: parseInt(ed[2]) });

  const effRe = /\[EFFECT:\s*([^,\]]+)(?:,\s*([^\]]+))?\]/gi;
  let efm: RegExpExecArray | null;
  while ((efm = effRe.exec(text)) !== null) {
    const name = efm[1].trim();
    const duration = (efm[2] || "").trim();
    if (name) newEffects.push({ name, duration });
  }

  if (/\[INITIATIVE\]/i.test(text)) initiativeTrigger = true;
  // [END_COMBAT] — bare or typed: [END_COMBAT: victory|surrender|retreat|narrative]
  const endMatch = text.match(/\[END_COMBAT(?::\s*(victory|surrender|retreat|narrative))?\]/i);
  if (endMatch) {
    combatEnd = true;
    const t = endMatch[1]?.toLowerCase();
    combatEndType =
      t === "surrender" || t === "retreat" || t === "narrative" ? t : "victory";
  }
  // [PLAYER_HP: N] — narrative HP restore after defeat.
  // Forgiving regex: accepts variants like [PLAYER_HP:8], [PLAYER_HP: 2/8],
  // [PLAYER_HP: 5 HP] — we only need the first integer after the tag name.
  // Without this, a stray `/8` or trailing word from the LLM would silently
  // skip the HP restore and softlock the player at 0 HP.
  const hpRestore = text.match(/\[PLAYER_HP[\s:=]+(\d+)/i);
  if (hpRestore) playerHpRestore = parseInt(hpRestore[1]);
  // [BEHAVIOR_SHIFT: surrender|flee|escalate] — DM signals a narrative beat where
  // the leader's behavior changes. The UI uses this to switch from combat
  // buttons to negotiation choices (for surrender/flee), independent of HP %.
  const shiftMatch = text.match(/\[BEHAVIOR_SHIFT:\s*(surrender|flee|escalate)\]/i);
  if (shiftMatch) {
    const s = shiftMatch[1].toLowerCase();
    if (s === "surrender" || s === "flee" || s === "escalate") behaviorShift = s;
  }
  const surpriseMatch = text.match(/\[SURPRISE:\s*(player|enemies)\]/i);
  if (surpriseMatch) {
    const s = surpriseMatch[1].toLowerCase();
    if (s === "player" || s === "enemies") surprise = s;
  }

  // Build the narrative line-by-line:
  //  - numbered "1. ..." lines become choices and are pulled out
  //  - any [TAG: ...] occurrences inside a line are stripped INLINE
  //    (not the whole line!) so prose mixed on the same line as a tag
  //    survives and reaches the player. Empty leftover lines are dropped.
  for (const rawLine of text.trim().split(/\r?\n/)) {
    const line = rawLine.replace(/\r/g, "");
    const choiceMatch = line.trim().match(/^\*{0,2}(\d+)\.\s+(.+?)\*{0,2}$/);
    if (choiceMatch) { choices.push({ num: choiceMatch[1], text: choiceMatch[2].trim() }); continue; }
    const stripped = line.replace(TAG, "").trim();
    TAG.lastIndex = 0;
    if (stripped.length === 0) continue;
    narrativeLines.push(stripped);
  }

  return {
    narrative: narrativeLines.join("\n").trim(),
    choices,
    attackRequest,
    rollRequest,
    damage,
    newItem,
    newItems,
    upgrades,
    newEnemies,
    newAllies,
    allyDamages,
    enemyDamages,
    newEffects,
    initiativeTrigger,
    combatEnd,
    combatEndType,
    playerHpRestore,
    behaviorShift,
    surprise,
    goldChange,
  };
}
