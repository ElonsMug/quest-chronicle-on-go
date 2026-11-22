// ─────────────────────────────────────────────────────────────────
// DM RESPONSE PARSER
// ─────────────────────────────────────────────────────────────────
// Extracts structured game events from the raw text returned by the LLM.
// Tags are part of an internal contract — they are ALWAYS English even
// when the narrative is written in another language.
// ─────────────────────────────────────────────────────────────────

import type { ClueFallback, Enemy } from "./types";
import { limitStoryChoices, parseAbilityCheck, type StoryChoice } from "./abilityChecks.ts";
import { isScoutKit, type Vendor } from "./vendor.ts";
import { isCombatLootItem } from "./combatLoot.ts";

function parseClueFallback(text: string): ClueFallback | undefined {
  const fallback = text.match(/\[CLUE_FALLBACK:[ \t]*([^|\[\]\r\n]+)\|([^|\[\]\r\n]+)\]/i);
  const lead = fallback?.[1].trim();
  const fact = fallback?.[2].trim();
  return lead && fact ? { lead, fact } : undefined;
}

export function parseDMResponse(text: string) {
  const choices: StoryChoice[] = [];
  const narrativeLines: string[] = [];
  let attackRequest: { weapon: string; dice: string; mod: number; ac: number } | null = null;
  let damage: number | null = null;
  let newItem: string | null = null;
  const newItems: string[] = [];
  const upgrades: { from: string; to: string }[] = [];
  const newEnemies: Enemy[] = [];
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
  const TAG = /\[(ATTACK|ROLL|CLUE_FALLBACK|CLUE_FOUND|DAMAGE|ITEM|UPGRADE|ENEMY|ENEMY_DAMAGE|ENEMY_ATTACK|ENEMY_WITHDRAWAL|MIDBOSS_BYPASSED|EPILOGUE|ALLY|ALLY_DAMAGE|EFFECT|INITIATIVE|END_COMBAT|PLAYER_HP|BEHAVIOR_SHIFT|SURPRISE|GOLD_OFFER|GOLD|ARTIFACT|VENDOR)[^\]]*\]/gi;

  const atk = text.match(/\[ATTACK:\s*([^,\]]+),\s*([^,\]]+),\s*([^,\]]+),\s*AC(\d+)\]/i);
  if (atk) attackRequest = { weapon: atk[1].trim(), dice: atk[2].trim(), mod: parseInt(atk[3]) || 0, ac: parseInt(atk[4]) };

  const rol = text.match(/^\s*\[ROLL:\s*([^,\]\r\n]+)(?:,\s*DC[=:]?\s*(\d+))?(?:,\s*(SOCIAL|STRENGTH))?\s*\]\s*$/im);
  const rollRequest = rol ? parseAbilityCheck(rol[1], Number(rol[2] ?? 15), rol[3]) : null;

  const clueFallback = text.split(/\r?\n/).filter(line => !/^\s*\*{0,2}\d+\./.test(line))
    .map(parseClueFallback).find(Boolean);

  const discoveredClue = text.match(/^\s*\[CLUE_FOUND:[ \t]*([^\]\r\n]+)\]\s*$/im)?.[1].trim();

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

  const offers = [...text.matchAll(/^\s*\[GOLD_OFFER:\s*([+-]\d+)\s*,\s*([^\]\r\n]+)\]\s*$/gim)];
  const amount = Number(offers[0]?.[1]);
  const reason = offers[0]?.[2].trim();
  const goldOffer = offers.length === 1 && Number.isSafeInteger(amount) && amount !== 0 && reason
    ? { amount, reason } : null;
  const vendors = [...text.matchAll(/^\s*\[VENDOR:\s*(innkeeper|merchant|informant)[ \t]*\|[ \t]*([^\[\]\r\n]{1,300})\][ \t]*$/gim)];
  const tip = vendors[0]?.[2].trim();
  const vendor: Vendor | null = vendors.length === 1 && tip
    ? { role: vendors[0][1].toLowerCase() as Vendor["role"], tip } : null;

  const itemRe = /\[ITEM:\s*([^\]]+)\]/gi;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(text)) !== null) {
    const name = im[1].trim();
    const looseGold = /^\d+\s*(?:gp|gold(?: (?:coins?|pieces?))?|зм|золот(?:ых(?: монет)?|ые монеты|ая монета|о))$/iu.test(name)
      || /^(?:золото(?:\s+[^\d]+)?|(?:кошель|мешок|кошел[её]к|сумка) (?:с )?(?:золота|золотом|монет|монетами)|(?:bag|pouch|purse) of (?:gold|coins)|(?:stolen|merchant[’']s) gold)$/iu.test(name);
    if (name && !looseGold && !isScoutKit(name) && !isCombatLootItem(name)) {
      newItems.push(name);
      if (newItem === null) newItem = name;
    }
  }

  const upgradeRe = /\[UPGRADE:\s*([^\]]+?)\s*->\s*([^\]]+?)\]/gi;
  let um: RegExpExecArray | null;
  while ((um = upgradeRe.exec(text)) !== null) {
    const from = um[1].trim();
    const to = um[2].trim();
    if (!isScoutKit(from) && !isScoutKit(to) && !isCombatLootItem(from) && !isCombatLootItem(to)) {
      upgrades.push({ from, to });
    }
  }

  // Stat fields and flags may appear in any order. MOTIVE is narrative metadata.
  const enemyRe = /\[ENEMY:\s*([^,\]]+),\s*([^\]]+)\]/gi;
  for (const match of text.matchAll(enemyRe)) {
    const name = match[1].trim();
    const fields = match[2].split(",").map(field => field.trim());
    const stats = new Map<string, string>();
    const flags = new Set<string>();
    for (const field of fields) {
      const separator = field.indexOf(":");
      if (separator < 0) flags.add(field.toUpperCase());
      else stats.set(field.slice(0, separator).trim().toUpperCase(), field.slice(separator + 1).trim());
    }
    const number = (key: string, fallback: number) => {
      const value = stats.get(key) ?? "";
      return /^[+-]?\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : fallback;
    };
    const hp = number("HP", 0);
    if (!name || hp <= 0) continue;
    newEnemies.push({
      name, hp, maxHp: hp,
      ac: number("AC", 12),
      attackBonus: number("ATK", 3),
      damage: stats.get("DMG") || "d6+1",
      wisBonus: number("WIS", 0),
      isUndead: flags.has("UNDEAD"),
      isBoss: flags.has("BOSS"),
      isMidBoss: flags.has("MIDBOSS"),
    });
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

  const enemyAttacks: string[] = [];
  const enemyAttackRe = /\[ENEMY_ATTACK:\s*([^\]]+)\]/gi;
  let ea: RegExpExecArray | null;
  while ((ea = enemyAttackRe.exec(text)) !== null) {
    enemyAttacks.push(ea[1].trim());
  }

  const artifactMatch = text.match(/\[ARTIFACT:\s*([+-]?\d+)\]/i);
  const artifactBonus = artifactMatch ? parseInt(artifactMatch[1]) : null;
  // Build the narrative line-by-line:
  //  - numbered "1. ..." lines become choices and are pulled out
  //  - any [TAG: ...] occurrences inside a line are stripped INLINE
  //    (not the whole line!) so prose mixed on the same line as a tag
  //    survives and reaches the player. Empty leftover lines are dropped.
  for (const rawLine of text.trim().split(/\r?\n/)) {
    const line = rawLine.replace(/\r/g, "");
    const choiceMatch = line.trim().match(/^\*{0,2}(\d+)\.\s+(.+?)\*{0,2}$/);
    if (choiceMatch) {
      const [, num, rawChoice] = choiceMatch;
      const checkTag = rawChoice.match(/\[CHECK:\s*([^,\]]+),\s*DC[=:]?\s*(\d+)(?:,\s*(STRENGTH))?\s*\]/i);
      const noCheck = /\[NO_CHECK\]/i.test(rawChoice);
      const clueRoute = /\[CLUE_ROUTE\]/i.test(rawChoice);
      const choiceText = rawChoice.replace(/\[(?:CHECK:|CLUE_FALLBACK:|NO_CHECK\b|CLUE_ROUTE\b)[^\]]*\]/gi, "").trim();
      const check = checkTag ? parseAbilityCheck(checkTag[1], Number(checkTag[2]), checkTag[3]) : noCheck ? null : undefined;
      const preparedClue = check?.social ? parseClueFallback(rawChoice) : undefined;
      if (choiceText && (!checkTag || check)) choices.push({
        num, text: choiceText,
        ...(check !== undefined ? { check } : {}),
        ...(preparedClue ? { clueFallback: preparedClue } : {}),
        ...(clueRoute ? { clueRoute: true } : {}),
      });
      continue;
    }
    const stripped = line.replace(TAG, "").trim();
    TAG.lastIndex = 0;
    if (stripped.length === 0) continue;
    narrativeLines.push(stripped);
  }

  return {
    narrative: narrativeLines.join("\n").trim(),
    choices: limitStoryChoices(choices),
    attackRequest,
    rollRequest,
    clueFallback,
    discoveredClue,
    damage,
    newItem,
    newItems,
    upgrades,
    newEnemies,
    newAllies,
    allyDamages,
    enemyDamages,
    enemyWithdrawals: [...text.matchAll(/\[ENEMY_WITHDRAWAL:\s*([^\]\r\n]+)\]/gi)].map(match => match[1].trim()),
    epilogue: text.match(/^\s*\[EPILOGUE:[ \t]*([^\]\r\n]{12,1200})\][ \t]*$/im)?.[1]?.trim(),
    midBossBypassed: /\[MIDBOSS_BYPASSED\]/i.test(text),
    newEffects,
    initiativeTrigger,
    combatEnd,
    combatEndType,
    playerHpRestore,
    behaviorShift,
    surprise,
    goldChange,
    goldOffer,
    vendor,
    enemyAttacks,
    artifactBonus,
  };
}
