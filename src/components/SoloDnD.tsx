import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { initAnalytics, trackEvent } from "@/lib/analytics";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import i18n from "@/i18n";

// ─────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────
type Stat = "str" | "dex" | "int";
type SpellType = "attack" | "defense" | "control";
type SpellId = "fireBolt" | "shield" | "sleep";
type CharacterId = "warrior" | "rogue" | "mage";

type Spell = {
  id: SpellId;
  name: string;
  cost: number;
  type: SpellType;
  dice?: string;
  stat?: Stat;
  description: string;
};

type ClassAbility = { name: string; type: "berserk" | "sneak" };

type Character = {
  id: CharacterId;
  name: string;
  emoji: string;
  subtitle: string;
  hp: number;
  maxHp: number;
  stats: Record<Stat, number>;
  ability: string;
  abilityDesc: string;
  weapon: { name: string; dice: string; stat: Stat };
  color: string;
  backstory: string;
  startItems: string[];
  spellSlots?: { current: number; max: number };
  spellSaveDC?: number;
  spells?: Spell[];
  classAbility?: ClassAbility;
};

// ─────────────────────────────────────────────────────────────────
// CHARACTER FACTORY
// ─────────────────────────────────────────────────────────────────
// Stable IDs are decoupled from display names. All player-visible strings
// (name/subtitle/ability/weapon/items/spells) are pulled from i18n at the
// moment a character is built, so language switches before "Begin as ..."
// pick the right localized labels.
// ─────────────────────────────────────────────────────────────────
function buildCharacters(t: (k: string) => string): Character[] {
  return [
    {
      id: "warrior",
      name: t("characters.warrior.name"),
      emoji: "⚔️",
      subtitle: t("characters.warrior.subtitle"),
      hp: 14,
      maxHp: 14,
      stats: { str: 3, dex: 1, int: -1 },
      ability: t("characters.warrior.ability"),
      abilityDesc: t("characters.warrior.abilityDesc"),
      weapon: { name: t("characters.warrior.weapon"), dice: "d8", stat: "str" },
      color: "#C0392B",
      backstory: t("characters.warrior.backstory"),
      startItems: [
        t("characters.warrior.items.shortSword"),
        t("characters.warrior.items.leatherArmor"),
        t("characters.warrior.items.healingPotion"),
      ],
      classAbility: { name: t("characters.warrior.ability"), type: "berserk" },
    },
    {
      id: "rogue",
      name: t("characters.rogue.name"),
      emoji: "🗡️",
      subtitle: t("characters.rogue.subtitle"),
      hp: 10,
      maxHp: 10,
      stats: { str: 0, dex: 3, int: 1 },
      ability: t("characters.rogue.ability"),
      abilityDesc: t("characters.rogue.abilityDesc"),
      weapon: { name: t("characters.rogue.weapon"), dice: "d6", stat: "dex" },
      color: "#8E44AD",
      backstory: t("characters.rogue.backstory"),
      startItems: [
        t("characters.rogue.items.dagger"),
        t("characters.rogue.items.lockpicks"),
        t("characters.rogue.items.healingPotion"),
      ],
      classAbility: { name: t("characters.rogue.ability"), type: "sneak" },
    },
    {
      id: "mage",
      name: t("characters.mage.name"),
      emoji: "🔮",
      subtitle: t("characters.mage.subtitle"),
      hp: 8,
      maxHp: 8,
      stats: { str: -1, dex: 0, int: 4 },
      ability: t("characters.mage.ability"),
      abilityDesc: t("characters.mage.abilityDesc"),
      weapon: { name: t("characters.mage.weapon"), dice: "d6", stat: "int" },
      color: "#2980B9",
      backstory: t("characters.mage.backstory"),
      startItems: [
        t("characters.mage.items.staff"),
        t("characters.mage.items.healingPotion"),
        t("characters.mage.items.fireBoltScroll"),
      ],
      spellSlots: { current: 3, max: 3 },
      spellSaveDC: 14,
      spells: [
        {
          id: "fireBolt",
          name: t("characters.mage.spells.fireBolt.name"),
          cost: 1,
          dice: "d10",
          stat: "int",
          type: "attack",
          description: t("characters.mage.spells.fireBolt.description"),
        },
        {
          id: "shield",
          name: t("characters.mage.spells.shield.name"),
          cost: 1,
          type: "defense",
          description: t("characters.mage.spells.shield.description"),
        },
        {
          id: "sleep",
          name: t("characters.mage.spells.sleep.name"),
          cost: 1,
          type: "control",
          description: t("characters.mage.spells.sleep.description"),
        },
      ],
    },
  ];
}

// Dev scenes — labels and prompts come from i18n (DM speaks the user's language).
function buildDevScenes(t: (k: string) => string) {
  return [
    { id: "tavern", label: t("dev.scenes.tavern"), prompt: t("dm.scenes.tavern") },
    { id: "combat", label: t("dev.scenes.combat"), prompt: t("dm.scenes.combat") },
    { id: "social", label: t("dev.scenes.social"), prompt: t("dm.scenes.social") },
    { id: "mystery", label: t("dev.scenes.mystery"), prompt: t("dm.scenes.mystery") },
    { id: "magic", label: t("dev.scenes.magic"), prompt: t("dm.scenes.magic") },
    { id: "boss", label: t("dev.scenes.boss"), prompt: t("dm.scenes.boss") },
  ];
}

// ─────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────
// CRITICAL CONTRACT: Tags ([ENEMY:], [ATTACK:], [DAMAGE:], [ROLL:], [ITEM:],
// [UPGRADE:], [ENEMY_DAMAGE:], [ALLY:], [ALLY_DAMAGE:], [EFFECT:],
// [INITIATIVE], [END_COMBAT], [UNDEAD]) are ALWAYS English regardless of UI
// language. The narrative is localized — ask the DM to write the story in the
// active UI language (English by default, Russian when the user switches).
// The parser only knows the English tags, so they must never be translated.
// ─────────────────────────────────────────────────────────────────
function buildSystemPrompt(
  character: Character,
  hp: number,
  inventory: string[],
  effects: string[],
  spellSlots: { current: number; max: number } | null,
  language: "en" | "ru",
) {
  const inv = inventory.length ? inventory.join(", ") : language === "ru" ? "пусто" : "empty";
  const eff = effects.length ? effects.join(", ") : language === "ru" ? "нет" : "none";
  const s = (n: number) => (n >= 0 ? "+" : "") + n;
  const spellsBlock = character.id === "mage" && spellSlots
    ? `Spell slots: ${spellSlots.current}/${spellSlots.max}\n`
    : "";

  const mageRules = character.id === "mage" ? `

MAGE SPELLS:
- Spells (Fire Bolt, Shield, Sleep) cost 1 slot each.
- Current slots: ${spellSlots?.current ?? 0}/${spellSlots?.max ?? 0}
- When the player casts a spell through the UI, the system has ALREADY deducted the slot — do not deduct again.
- The DM describes the spell's effect vividly in the narrative.
- Fire Bolt — the system rolls d10+INT vs AC; the DM describes hit or miss.
- For Shield: add a player effect [EFFECT: Shield, 1 round].

MAGE SPELL SAVE DC: 14 (= 8 + proficiency(2) + INT(4)).
When an enemy resists a control spell, they roll a Wisdom saving throw vs DC 14.
Typical enemy WIS modifiers:
  - Common bandit / thug: WIS +0 (hard to resist)
  - Guard / soldier: WIS +2
  - Cultist / fanatic: WIS +1
  - Undead / construct / demon: immune to Sleep (do not fall asleep)

SLEEP — HP POOL MECHANIC:
When the player casts Sleep, the system writes "[Sleep: pool X HP. ...]" with the pool already calculated.
YOU MUST:
1. Sort living enemies by ascending HP.
2. Walk from the lowest-HP enemy. If their current HP ≤ remaining pool — they fall asleep, subtract their HP from the pool, move to the next. Otherwise — stop.
3. Undead, constructs, demons — DO NOT fall asleep (skip them, do not spend pool HP).
4. For each sleeping enemy write: [EFFECT: <Enemy_name>_asleep, 2 rounds]
5. A sleeping enemy is NOT considered defeated — they are unconscious, lying helpless.
6. After describing — ask the player what to do with the sleepers: finish, bind, interrogate, search.
   Offer this as choices 1-2-3 (not combat buttons — this is no longer active combat with sleepers).
7. If awake enemies remain after Sleep — continue the fight as usual with them.
8. [END_COMBAT] is set only when ALL enemies are either dead or permanently neutralized
   (bound, finished). Sleepers alone do not end combat.
` : "";

  const langInstruction = language === "ru"
    ? "ЯЗЫК НАРРАТИВА: пиши весь нарратив, описания и варианты на русском языке. Теги в квадратных скобках ВСЕГДА на английском."
    : "NARRATIVE LANGUAGE: write all narrative, descriptions and choices in English. Tags in square brackets are ALWAYS in English.";

  return `You are the Dungeon Master of a solo text RPG (simplified D&D 5e). One player.

${langInstruction}

CHARACTER:
Class: ${character.name} | HP: ${hp}/${character.maxHp}
Strength ${s(character.stats.str)} | Dexterity ${s(character.stats.dex)} | Intelligence ${s(character.stats.int)}
Weapon: ${character.weapon.name} (${character.weapon.dice}+${s(character.stats[character.weapon.stat])})
${spellsBlock}Inventory: ${inv} | Effects: ${eff}

RESPONSE FORMAT:
- 3–5 sentences of second-person narrative.
- Exactly 3 numbered choices at the end: "1. ...\n2. ...\n3. ..."
- DO NOT write a 4th choice — the UI provides a "Free choice" button.
- ⚠️ CRITICAL: choices ALWAYS in plain numbered format without markdown:
    1. Choice text
    2. Choice text
    3. Choice text
  NEVER use **1. Text**, *1. Text*, backticks, ### headers or any other
  formatting around the numbers and choice text. Only plain "N. Text" lines —
  otherwise the UI parser will not recognise the choices.

TAG MECHANICS (always on a separate line):
[ROLL: Stat, DC number] — any non-combat skill check.
[ATTACK: Weapon, damage_die, modifier, AC number] — player attack in combat.
   AC = enemy Armor Class (NOT DC!).
   The system itself rolls d20 + modifier + proficiency vs AC.
   The DM does NOT write the hit result in the text — the system returns the outcome.
   After receiving the result, the DM describes the outcome.
   On a hit, the DM writes [ENEMY_DAMAGE: Name, number] with the damage the system computed.
   Example: [ATTACK: Sword, d8, +3, AC13]
[DAMAGE: number] — damage to the player from an enemy. ONLY a number, no narrative inside.
   The DM NEVER writes "Your HP: X/Y" in the text — the UI shows HP itself.
[ITEM: name] — add an item to the inventory.
   ⚠️ CRITICAL: EVERY TIME the player gains an item by any means
   (finds, buys, steals, receives as reward, takes from an NPC, picks up from a corpse,
   gains gold/coins) — you MUST write the tag [ITEM: name] on its own line.
   No exceptions.
   Examples:
     Bought a potion → [ITEM: Healing Potion (d6+2 HP)]
     Found a rope → [ITEM: Rope]
     Reward → [ITEM: 10 gold]
     Looted from enemy → [ITEM: Bandit's Dagger]
   Several items = several tags, each on its own line.
[UPGRADE: old_name -> new_name] — when the player upgrades, repairs,
   enchants or modifies an existing item. The system finds the item with the
   old name in the inventory and replaces it with the new one.
   Examples:
     [UPGRADE: Dagger -> Sharpened Dagger]
     [UPGRADE: Sword -> Sword +1]
     [UPGRADE: Broken Shield -> Repaired Shield]
[ENEMY: Name, HP:number, AC:number, DMG:die] — declare an enemy with attributes.
   AC = Armor Class (typical values: bandit AC12, guard AC14, knight AC16, mage AC11).
   DMG = enemy damage die (bandit d6+1, guard d8+2, mage d4+3, goblin d4).
   Example: [ENEMY: Bald Bandit, HP:8, AC:12, DMG:d6+1]
   For undead add a flag: [ENEMY: Skeleton, HP:6, AC:13, DMG:d6, UNDEAD]
   If you omit AC and DMG — defaults are AC:12, DMG:d4+1.
[ENEMY_DAMAGE: Name, number] — deal damage to an enemy (the system tracks enemy HP).
   Use EXACTLY the same unique name as in [ENEMY:] — otherwise the damage will not apply.
[ALLY: Name, HP:number] — declare an ally NPC (attacks automatically in narrative).
[ALLY_DAMAGE: Name, number] — damage to an ally from an enemy.
[INITIATIVE] — at the start of EVERY combat; the system rolls d20 for both sides.
[END_COMBAT] — when all enemies are defeated.

FREEDOM OF ACTION (CRITICAL):
- If the player picks "Free choice" and describes a non-standard action — ALWAYS assign a roll.
  * Threatens? → [ROLL: Charisma/Intimidation, DC13]
  * Throws dust in face? → [ROLL: Dexterity, DC12]; on success the enemy is blinded for 1 round.
  * Tries to negotiate? → [ROLL: Persuasion, DC14]
  * Physical action? → [ROLL: Strength, DC12]
  Never refuse. Always find a mechanic.

[EFFECT: name, duration] — add a temporary effect (e.g. [EFFECT: Enemy_slowed, 1 round], [EFFECT: Shield, 1 round]).

COMBAT:
- ⚠️ CRITICAL: In the FIRST message of any combat scene you MUST declare ALL enemies
  with [ENEMY: Name, HP:number] tags — each on its own line — BEFORE any description of attacks,
  BEFORE narrative about strikes, BEFORE [INITIATIVE]. Without these tags the system does NOT show enemy HP bars.
  Example of a correct combat opening:
    [ENEMY: Cultist, HP:6]
    [ENEMY: Cultist, HP:6]
    [ENEMY: Cultist, HP:6]
    [INITIATIVE]
    (then narrative without choices — the system will show combat buttons)
- If you forgot to declare enemies in the first combat message — DO IT IN THE NEXT message,
  before any other actions or tags.
- Order: first [ENEMY: ...] for every enemy, then [INITIATIVE], then alternating turns.
- Show enemy HP in parentheses after the name: "Bandit (HP: 5/8)"
- When an enemy takes damage — update HP with [ENEMY_DAMAGE: Name, number].
- Damage from an attack on hit — calculate it yourself from the die and modifier, write [ENEMY_DAMAGE: Name, damage].
- On a miss — just describe the miss, do not use [ENEMY_DAMAGE].

COMBAT TURN ORDER (CRITICAL):
- ⚠️ When the system sends "[Initiative won: ...]" — the player acts first.
  YOU DO NOT ATTACK IN THIS RESPONSE. YOU DO NOT WRITE [ATTACK:]. YOU DO NOT WRITE [DAMAGE:].
  Only a brief scene description (1-2 sentences) — who stands where, what's in the air.
  Then wait — the system will show combat buttons to the player.
- ⚠️ When the system sends "[Initiative lost: ...]" — enemies attack FIRST.
  YOU MUST in the same response:
  1. Describe each living enemy's attack.
  2. For each hit write [DAMAGE: number] on its own line.
  3. Then a brief pause, wait for the player's turn (the system will show buttons).
- After EVERY player action in combat (attack, berserk, defend, dodge, spell, free action)
  you MUST in the same response:
  1. Describe the result of the player's action (1-2 sentences).
  2. Describe each living enemy's attack (1 sentence per enemy).
  3. For each hit write [DAMAGE: number] on its own line.
  4. DO NOT offer choices 1-2-3 — the system will show combat buttons itself.
- Enemies do not wait. Enemies do not skip turns. If the player did something strange and didn't attack —
  enemies still strike them in this same response.
- Exception: if the player chose [Dodge] — enemies attack at disadvantage (see below).
- Exception: if the player cast [Shield cast] — the player has +5 AC until next turn,
  enemy attacks are very likely to miss (factor that into d20 vs AC).

CLASS COMBAT BUTTONS:
In combat the player uses fixed class buttons, NOT DM choices.
The DM in combat does NOT offer choices 1-2-3 — only describes the result of the player's action and enemy attacks.
Exception: after combat ends [END_COMBAT] — offer 3 choices again.

Berserk: when you receive [Berserk activated] — the player's next 2 attacks deal +2 damage, enemies hit the player for +2 damage (lower AC).
Dodge (CRITICAL): when the player chose [Dodge] — each enemy rolls d20 TWICE and uses the LOWER result.
   This does NOT guarantee a miss — if both rolls are high, the enemy still hits. The DM MUST explicitly show BOTH rolls in the narrative.
   Examples:
     "The bandit swings — d20(14) and d20(7), takes the lower: 7. Miss, you slip under the blade."
     "The cultist strikes — d20(15) and d20(18), takes the lower: 15. The blow lands. [DAMAGE: 4]"
   Dodge does NOT guarantee avoiding damage — it only lowers the chance to be hit.
Sneak Attack: when you receive an attack after a dodge — add +d6 to the damage in your description.
Magic Missile: when you receive [Magic Missile: X damage] — write [ENEMY_DAMAGE: Name, X] for the first living enemy.

UNIQUE ENEMY NAMES (CRITICAL):
If a single fight has multiple enemies of the same type — you MUST give them unique descriptive names when declaring via [ENEMY:].
Never use identical names for different enemies in the same fight — the system will only apply damage to one of them.
Examples of good names:
   [ENEMY: Bald Bandit, HP:8]
   [ENEMY: Skinny Bandit, HP:8]
   [ENEMY: Scarred Bandit, HP:8]
Or ordinal: "First Bandit", "Second Bandit", "Third Bandit".
In the [ENEMY_DAMAGE: Name, X] tags use exactly the same unique names.

SETTING: a dark fantasy harbor city called "Grey Shore". Be concise — mobile, on the metro.${mageRules}`;
}

// ─────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────
type Parsed = ReturnType<typeof parseDMResponse>;

function parseDMResponse(text: string) {
  const choices: { num: string; text: string }[] = [];
  const narrativeLines: string[] = [];
  let attackRequest: { weapon: string; dice: string; mod: number; ac: number } | null = null;
  let rollRequest: { stat: string; dc: number } | null = null;
  let damage: number | null = null;
  let newItem: string | null = null;
  const newItems: string[] = [];
  const upgrades: { from: string; to: string }[] = [];
  const newEnemies: { name: string; maxHp: number; hp: number; ac: number; damage: string; isUndead?: boolean }[] = [];
  const newAllies: { name: string; maxHp: number; hp: number }[] = [];
  const allyDamages: { name: string; damage: number }[] = [];
  const enemyDamages: { name: string; damage: number }[] = [];
  const newEffects: { name: string; duration: string }[] = [];
  let initiativeTrigger = false;
  let combatEnd = false;

  // English-tag parser. Tags are part of an internal contract between the DM
  // and the parser — they do not get translated when the UI language changes.
  const TAG = /\[(ATTACK|ROLL|DAMAGE|ITEM|UPGRADE|ENEMY|ENEMY_DAMAGE|ALLY|ALLY_DAMAGE|EFFECT|INITIATIVE|END_COMBAT)[^\]]*\]/gi;

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

  // Extended [ENEMY: Name, HP:N, AC:N, DMG:dX+Y, UNDEAD]
  const enemyRe = /\[ENEMY:\s*([^,\]]+),\s*HP:(\d+)(?:,\s*AC:(\d+))?(?:,\s*DMG:([^\],]+))?(?:,\s*(UNDEAD))?\]/gi;
  let em: RegExpExecArray | null;
  while ((em = enemyRe.exec(text)) !== null) {
    const hp = parseInt(em[2]);
    newEnemies.push({
      name: em[1].trim(),
      maxHp: hp,
      hp,
      ac: em[3] ? parseInt(em[3]) : 12,
      damage: em[4] ? em[4].trim() : "d4+1",
      isUndead: !!em[5],
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
  if (/\[END_COMBAT\]/i.test(text)) combatEnd = true;

  for (const line of text.trim().split("\n")) {
    const choiceMatch = line.trim().match(/^\*{0,2}(\d+)\.\s+(.+?)\*{0,2}$/);
    if (choiceMatch) { choices.push({ num: choiceMatch[1], text: choiceMatch[2].trim() }); continue; }
    if (TAG.test(line)) { TAG.lastIndex = 0; continue; }
    TAG.lastIndex = 0;
    narrativeLines.push(line);
  }

  return { narrative: narrativeLines.join("\n").trim(), choices, attackRequest, rollRequest, damage, newItem, newItems, upgrades, newEnemies, newAllies, allyDamages, enemyDamages, newEffects, initiativeTrigger, combatEnd };
}

function rollDice(sides: number) { return Math.floor(Math.random() * sides) + 1; }
function parseDiceSides(s: string) { const m = s.match(/d(\d+)/i); return m ? parseInt(m[1]) : 20; }

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  parsed?: Parsed;
};

type Enemy = {
  name: string;
  hp: number;
  maxHp: number;
  ac: number;
  damage: string;
  isUndead?: boolean;
};
type Ally = { name: string; hp: number; maxHp: number };
type RollRequest = { stat?: string; weapon?: string; dice?: string; mod: number; dc?: number; ac?: number };
type PendingRoll = { type: "attack" | "roll"; request: RollRequest };

// ─────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────

function EnemyHP({ name, hp, maxHp }: { name: string; hp: number; maxHp: number }) {
  const pct = Math.max(0, Math.round((hp / maxHp) * 100));
  const color = pct > 60 ? "#4ade80" : pct > 30 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex items-center gap-2">
      <span className="text-stone-400 text-xs truncate max-w-[100px]">{name}</span>
      <div className="flex-1 h-2 rounded-full bg-stone-800 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-bold" style={{ color }}>{hp}/{maxHp}</span>
    </div>
  );
}

function InitiativeBlock({ dexMod, onResult }: { dexMod: number; onResult: (r: { player: number; enemy: number; playerWins: boolean }) => void }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const [res, setRes] = useState<{ playerRaw: number; player: number; enemy: number; playerWins: boolean } | null>(null);

  function roll() {
    const playerRaw = rollDice(20);
    const player = playerRaw + dexMod;
    const enemy = rollDice(20);
    const playerWins = player >= enemy;
    setRes({ playerRaw, player, enemy, playerWins });
  }

  function confirm() { if (res) { setDone(true); onResult({ player: res.player, enemy: res.enemy, playerWins: res.playerWins }); } }

  if (done && res) return (
    <div className="rounded-xl border border-stone-800 bg-stone-950/80 px-4 py-2 text-xs text-stone-500">
      ⚡ {t("combat.initiativeFooter", {
        player: res.player,
        enemy: res.enemy,
        result: res.playerWins ? t("combat.initiativeYouFirst") : t("combat.initiativeEnemyFirst"),
      })}
    </div>
  );

  const dexLabel = dexMod >= 0 ? `+${dexMod}` : `${dexMod}`;

  return (
    <div className="rounded-xl border border-amber-900/50 bg-stone-950/80 px-4 py-3 my-2">
      <div className="text-amber-500 text-xs uppercase tracking-widest mb-2">⚡ {t("combat.initiative")} (d20 {dexLabel} {t("stats.dex")})</div>
      {!res ? (
        <button onClick={roll} className="w-full py-2.5 rounded-lg text-sm font-bold text-stone-900 active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}>
          🎲 {t("combat.rollInitiative")}
        </button>
      ) : (
        <div>
          <div className="flex justify-around mb-3 text-center">
            <div>
              <div className="text-2xl font-bold" style={{ fontFamily: "serif", color: res.playerWins ? "#4ade80" : "#f87171" }}>{res.player}</div>
              <div className="text-xs text-stone-500">{t("combat.you")} ({res.playerRaw}{dexMod !== 0 ? ` ${dexLabel}` : ""})</div>
            </div>
            <div className="text-stone-600 self-center text-lg">{t("combat.vs")}</div>
            <div>
              <div className="text-2xl font-bold" style={{ fontFamily: "serif", color: !res.playerWins ? "#4ade80" : "#f87171" }}>{res.enemy}</div>
              <div className="text-xs text-stone-500">{t("combat.enemy")}</div>
            </div>
          </div>
          <div className={`text-center text-sm font-bold mb-3 ${res.playerWins ? "text-green-400" : "text-red-400"}`}>
            {res.playerWins ? t("combat.youAreFirst") : t("combat.enemyIsFirst")}
          </div>
          <button onClick={confirm} className="w-full py-2 rounded-lg text-sm font-bold bg-stone-700 hover:bg-stone-600 text-amber-100 transition-colors">
            {t("common.continue")}
          </button>
        </div>
      )}
    </div>
  );
}

type RollResult = {
  hitRoll: number;
  mod: number;
  prof: number;
  total: number;
  ac: number;
  dc: number;
  success: boolean;
  crit: boolean;
  autoMiss: boolean;
  damage: number;
};

const PROFICIENCY_BONUS = 2;

function RollBlock({ type, request, onResult }: { type: "attack" | "roll"; request: RollRequest; onResult: (r: RollResult) => void }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const [res, setRes] = useState<RollResult | null>(null);

  function execute() {
    if (done) return;
    const mod = request.mod || 0;

    if (type === "attack") {
      const ac = request.ac ?? 10;
      const hitRoll = rollDice(20);
      const proficiencyBonus = PROFICIENCY_BONUS;
      const total = hitRoll + mod + proficiencyBonus;
      const crit = hitRoll === 20;
      const autoMiss = hitRoll === 1;
      const hit = !autoMiss && (crit || total >= ac);

      let damage = 0;
      if (hit) {
        const dmgDice = parseDiceSides(request.dice || "d6");
        damage = crit
          ? rollDice(dmgDice) + rollDice(dmgDice) + mod
          : rollDice(dmgDice) + mod;
      }

      setRes({
        hitRoll, mod, prof: proficiencyBonus, total,
        ac, dc: ac, success: hit, crit, autoMiss, damage,
      });
    } else {
      const dc = request.dc ?? 15;
      const hitRoll = rollDice(20);
      const total = hitRoll + mod;
      const success = total >= dc;
      setRes({
        hitRoll, mod, prof: 0, total,
        ac: dc, dc, success, crit: false, autoMiss: false, damage: 0,
      });
    }
  }

  function confirm() { if (res) { setDone(true); onResult(res); } }

  const diceLabel = type === "attack" ? `${request.weapon} (${request.dice})` : `${request.stat} d20`;
  const modLabel = (request.mod || 0) >= 0 ? `+${request.mod || 0}` : `${request.mod}`;
  const targetLabel = type === "attack" ? `AC${request.ac ?? 10}` : `DC${request.dc ?? 15}`;

  if (done && res) {
    let summary: string;
    if (type === "attack") {
      if (res.autoMiss) {
        summary = `d20(1) ✦ ${t("combat.autoMiss")}`;
      } else if (res.crit) {
        summary = `d20(20) ✦ ${t("combat.crit")} → ${t("combat.damage")}: ${res.damage}`;
      } else if (res.success) {
        summary = `d20(${res.hitRoll}) + mod(${res.mod}) + prof(${res.prof}) = ${res.total} vs AC${res.ac} → ✦ ${t("combat.hit")} → ${t("combat.damage")}: ${res.damage}`;
      } else {
        summary = `d20(${res.hitRoll}) + mod(${res.mod}) + prof(${res.prof}) = ${res.total} vs AC${res.ac} → ✦ ${t("combat.miss")}`;
      }
    } else {
      summary = `🎲 ${diceLabel}: ${res.hitRoll}${res.mod !== 0 ? ` ${modLabel}` : ""} = ${res.total} vs DC${res.dc} → ${res.success ? `✦ ${t("combat.success")}` : `✦ ${t("combat.fail")}`}`;
    }
    return (
      <div className="rounded-xl border border-stone-800 bg-stone-950/80 px-4 py-2 text-xs text-stone-500">
        {type === "attack" ? "⚔️ " : ""}{summary}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-900/40 bg-stone-950/80 px-4 py-3 my-2">
      <div className="text-amber-600 text-xs uppercase tracking-widest mb-2">
        {type === "attack" ? `⚔️ ${t("combat.attackLabel")}` : `🎲 ${t("combat.rollLabel")}`}: {diceLabel} {modLabel} vs {targetLabel}
      </div>
      {!res ? (
        <button onClick={execute}
          className="w-full py-2.5 rounded-lg text-sm font-bold text-stone-900 active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}>
          🎲 {t("combat.rollDie")}
        </button>
      ) : (
        <div>
          {type === "attack" ? (
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="bg-stone-800 rounded-lg px-3 py-1 text-lg font-bold"
                style={{ fontFamily: "serif", color: res.crit ? "#fbbf24" : res.autoMiss ? "#ef4444" : res.success ? "#4ade80" : "#f87171" }}>
                {res.hitRoll}
              </span>
              {!res.crit && !res.autoMiss && (
                <>
                  <span className="text-stone-500 text-sm">+{res.mod}</span>
                  <span className="text-stone-500 text-sm">+{res.prof}</span>
                  <span className="text-stone-600">=</span>
                  <span className="text-amber-200 font-bold text-lg" style={{ fontFamily: "serif" }}>{res.total}</span>
                  <span className="text-stone-600 text-sm">vs AC{res.ac}</span>
                </>
              )}
              <span className={`font-bold text-sm ${res.crit ? "text-amber-300" : res.autoMiss ? "text-red-400" : res.success ? "text-green-400" : "text-red-400"}`}>
                {res.crit ? `✦ ${t("combat.crit")}` : res.autoMiss ? `✦ ${t("combat.autoMiss")}` : res.success ? `✦ ${t("combat.hit")}` : `✦ ${t("combat.miss")}`}
              </span>
              {res.success && <span className="text-amber-200 text-sm">→ {t("combat.damage")}: <b>{res.damage}</b></span>}
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="bg-stone-800 rounded-lg px-3 py-1 text-lg font-bold" style={{ fontFamily: "serif", color: res.success ? "#4ade80" : "#f87171" }}>{res.hitRoll}</span>
              {res.mod !== 0 && <><span className="text-stone-500 text-sm">{res.mod > 0 ? "+" : ""}{res.mod}</span><span className="text-stone-600">=</span></>}
              <span className="text-amber-200 font-bold text-lg" style={{ fontFamily: "serif" }}>{res.total}</span>
              <span className="text-stone-600 text-sm">vs DC{res.dc}</span>
              <span className={`font-bold text-sm ${res.success ? "text-green-400" : "text-red-400"}`}>{res.success ? `✦ ${t("combat.success")}` : `✦ ${t("combat.fail")}`}</span>
            </div>
          )}
          <button onClick={confirm} className="w-full py-2 rounded-lg text-xs font-bold bg-stone-700 hover:bg-stone-600 text-amber-100 transition-colors">
            {t("common.ok")}
          </button>
        </div>
      )}
    </div>
  );
}

// Heuristic: true if an inventory entry looks like a healing potion in any
// supported language. Used to decide whether to show the "Use" button.
function isPotion(item: string): boolean {
  const lc = item.toLowerCase();
  return lc.includes("potion") || lc.includes("зелье") || lc.includes("зелья");
}

function InventoryPanel({
  inventory, effects, onUseItem, onShortRest, onLongRest, inCombat, canUsePotion, onClose,
}: {
  inventory: string[];
  effects: string[];
  onUseItem: (item: string, idx: number) => void;
  onShortRest: () => void;
  onLongRest: () => void;
  inCombat: boolean;
  canUsePotion: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const restTitle = inCombat ? t("inventory.noRestInCombat") : "";
  const potionDisabledTitle = inCombat && !canUsePotion ? t("inventory.potionInCombatHint") : "";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div className="w-full max-w-md bg-stone-900 border border-stone-700 rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-amber-400 font-bold" style={{ fontFamily: "serif" }}>🎒 {t("inventory.title")}</div>
          <button onClick={onClose} className="text-stone-500 text-xl leading-none">✕</button>
        </div>
        {inventory.length === 0 ? (
          <div className="text-stone-600 text-sm text-center py-4">{t("inventory.empty")}</div>
        ) : (
          <div className="space-y-2">
            {inventory.map((item, i) => {
              const usable = isPotion(item);
              return (
                <div key={i} className="flex items-center justify-between bg-stone-800 rounded-xl px-4 py-3">
                  <span className="text-amber-100 text-sm">{item}</span>
                  {usable && (
                    <button
                      onClick={() => onUseItem(item, i)}
                      disabled={inCombat && !canUsePotion}
                      title={potionDisabledTitle}
                      className="text-xs px-3 py-1 rounded-lg font-bold text-stone-900 ml-2 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: inCombat && !canUsePotion ? "#57534e" : "linear-gradient(135deg,#d97706,#92400e)" }}>
                      {t("common.use")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {effects.length > 0 && (
          <div className="mt-4 pt-4 border-t border-stone-800">
            <div className="text-stone-500 text-xs uppercase tracking-widest mb-2">{t("inventory.activeEffects")}</div>
            {effects.map((e, i) => (
              <div key={i} className="text-amber-300 text-sm bg-stone-800 rounded-lg px-3 py-2 mb-1">{e}</div>
            ))}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-stone-800">
          <div className="text-stone-500 text-xs uppercase tracking-widest mb-2">{t("inventory.rest")}</div>
          <div className="space-y-2">
            <button
              onClick={onShortRest}
              disabled={inCombat}
              title={restTitle}
              className="w-full text-left px-4 py-3 rounded-xl border border-stone-700 bg-stone-800 text-amber-100 text-sm font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed hover:border-amber-700/50"
              style={{ fontFamily: "serif" }}>
              ☕ {t("inventory.shortRest")}
              <span className="text-xs font-normal text-stone-500 block mt-0.5">{t("inventory.shortRestSubtitle")}</span>
            </button>
            <button
              onClick={onLongRest}
              disabled={inCombat}
              title={restTitle}
              className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: inCombat ? "#292524" : "linear-gradient(135deg,#d97706,#92400e)", color: inCombat ? "#57534e" : "#0c0a09", fontFamily: "serif" }}>
              🌙 {t("inventory.longRest")}
              <span className="text-xs font-normal opacity-75 block mt-0.5">{t("inventory.longRestSubtitle")}</span>
            </button>
          </div>
          {inCombat && <div className="text-stone-600 text-xs mt-2 text-center">{t("inventory.noRestInCombat")}</div>}
        </div>
      </div>
    </div>
  );
}

function SpellPanel({
  character, spellSlots, onSpell, onClose,
}: {
  character: Character;
  spellSlots: { current: number; max: number };
  onSpell: (s: Spell) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const slots = Array.from({ length: spellSlots.max }, (_, i) => i < spellSlots.current);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div className="w-full max-w-md bg-stone-900 border border-stone-700 rounded-t-3xl p-6 pb-10 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-amber-400 font-bold" style={{ fontFamily: "serif" }}>✦ {t("spells.title")}</div>
          <button onClick={onClose} className="text-stone-500 text-xl leading-none">✕</button>
        </div>
        <div className="text-center text-2xl mb-4 tracking-widest" style={{ color: "#60a5fa" }}>
          {slots.map((on, i) => (<span key={i}>{on ? "✦" : "◇"}</span>))}
          <span className="text-stone-500 text-sm ml-2 align-middle">{spellSlots.current}/{spellSlots.max}</span>
        </div>
        {character.spells && character.spells.length > 0 && (
          <div>
            <div className="text-stone-500 text-xs uppercase tracking-widest mb-2">{t("spells.subhead")}</div>
            <div className="space-y-2">
              {character.spells.map((s, i) => {
                const hasSlots = spellSlots.current > 0;
                return (
                  <div key={i} className="bg-stone-800 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-amber-100 text-sm font-bold" style={{ fontFamily: "serif" }}>{s.name}</span>
                      <button
                        onClick={() => hasSlots && onSpell(s)}
                        disabled={!hasSlots}
                        className="text-xs px-3 py-1 rounded-lg font-bold flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: hasSlots ? "linear-gradient(135deg,#3b82f6,#1e40af)" : "#292524", color: hasSlots ? "#0c0a09" : "#57534e" }}>
                        {hasSlots ? t("spells.cast") : t("spells.noSlots")}
                      </button>
                    </div>
                    <div className="text-stone-400 text-xs">{s.description}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DevPanel({ scenes, onJump, onClose }: {
  scenes: { id: string; label: string; prompt: string }[];
  onJump: (prompt: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div className="w-full max-w-md bg-stone-900 border border-amber-900/50 rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-amber-500 font-bold text-sm" style={{ fontFamily: "serif" }}>🛠 {t("dev.title")}</div>
          <button onClick={onClose} className="text-stone-500 text-xl leading-none">✕</button>
        </div>
        <div className="text-stone-600 text-xs mb-4">{t("dev.subtitle")}</div>
        <div className="grid grid-cols-2 gap-2">
          {scenes.map(scene => (
            <button key={scene.id} onClick={() => { onJump(scene.prompt); onClose(); }}
              className="py-3 px-3 rounded-xl border border-stone-700 bg-stone-800 text-amber-100 text-sm text-left hover:border-amber-700 transition-colors active:scale-95">
              {scene.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DefeatedScreen({
  hasPotion, onUsePotion, onRetry, onMenu, onClose,
}: {
  hasPotion: boolean;
  onUsePotion: () => void;
  onRetry: () => void;
  onMenu: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.9)" }}>
      <div className="relative max-w-sm w-full mx-4 text-center">
        <button
          onClick={onClose}
          aria-label={t("defeated.closeAria")}
          title={t("defeated.closeTitle")}
          className="absolute -top-2 -right-2 w-9 h-9 rounded-full border border-stone-700 bg-stone-900 text-stone-400 hover:text-amber-200 hover:border-amber-700 transition-colors flex items-center justify-center text-lg"
          style={{ fontFamily: "serif" }}
        >
          ✕
        </button>
        <div className="text-6xl mb-4">💀</div>
        <div className="text-2xl font-bold text-red-400 mb-2" style={{ fontFamily: "serif" }}>{t("defeated.title")}</div>
        <div className="text-stone-400 text-sm mb-6">{t("defeated.subtitle")}</div>
        <div className="space-y-3">
          {hasPotion && (
            <button onClick={onUsePotion}
              className="w-full py-3 rounded-xl font-bold text-stone-900"
              style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}>
              🧪 {t("defeated.drinkPotion")}
            </button>
          )}
          <button onClick={onRetry}
            className="w-full py-3 rounded-xl border border-stone-600 bg-stone-800 text-amber-100 font-bold"
            style={{ fontFamily: "serif" }}>
            ⚔️ {t("defeated.retry")}
          </button>
          <button onClick={onMenu}
            className="w-full py-3 rounded-xl border border-stone-700 bg-stone-900 text-stone-400 text-sm"
            style={{ fontFamily: "serif" }}>
            ← {t("defeated.returnToMenu")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CharacterCard({ char, selected, onSelect }: { char: Character; selected: boolean; onSelect: (c: Character) => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={() => onSelect(char)}
      className={`relative w-full text-left rounded-2xl p-5 border transition-all duration-300 overflow-hidden ${selected ? "border-amber-400 shadow-lg shadow-amber-900/40 scale-[1.02]" : "border-stone-700 hover:border-stone-500"}`}
      style={{ background: "linear-gradient(135deg,#1c1917 0%,#0c0a09 100%)" }}>
      {selected && <div className="absolute inset-0 opacity-10" style={{ background: `radial-gradient(ellipse at center,${char.color} 0%,transparent 70%)` }} />}
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">{char.emoji}</span>
          <div>
            <div className="font-bold text-amber-100 text-lg leading-tight" style={{ fontFamily: "serif" }}>{char.name}</div>
            <div className="text-stone-400 text-xs">{char.subtitle}</div>
          </div>
          {selected && <div className="ml-auto text-amber-400 text-lg">✦</div>}
        </div>
        <p className="text-stone-400 text-xs leading-relaxed mb-3">{char.backstory}</p>
        <div className="flex gap-3 text-xs mb-2">
          {([[t("stats.str"), char.stats.str], [t("stats.dex"), char.stats.dex], [t("stats.int"), char.stats.int]] as const).map(([l, v]) => (
            <span key={l} className="text-stone-500">{l} <span className="text-amber-300">{v >= 0 ? "+" : ""}{v}</span></span>
          ))}
          <span className="text-stone-500">{t("stats.hp")} <span className="text-red-400">{char.hp}</span></span>
        </div>
        <div className="text-xs" style={{ color: char.color }}>✦ {char.ability}: <span className="text-stone-400">{char.abilityDesc}</span></div>
        <div className="text-xs text-stone-600 mt-1">🗡 {char.weapon.name} ({char.weapon.dice})</div>
      </div>
    </button>
  );
}

function CombatPanel({
  character, berserkUsedThisCombat, didDodgeLastTurn, spellSlots,
  showSpellMini, spells, onAttackClick, onSpecial, onDefend, onToggleSpells, onCastSpell, onFreeInput,
}: {
  character: Character;
  berserkUsedThisCombat: boolean;
  didDodgeLastTurn: boolean;
  spellSlots: { current: number; max: number } | null;
  showSpellMini: boolean;
  spells: Spell[] | undefined;
  onAttackClick: () => void;
  onSpecial: () => void;
  onDefend: () => void;
  onToggleSpells: () => void;
  onCastSpell: (s: Spell) => void;
  onFreeInput: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        <button onClick={onAttackClick}
          className="flex flex-col items-center py-3 rounded-xl text-stone-900 font-bold active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}>
          <span className="text-xl">⚔️</span>
          <span className="text-xs mt-0.5">{t("combat.attack")}</span>
        </button>

        {character.id === "warrior" && (
          <button onClick={berserkUsedThisCombat ? undefined : onSpecial}
            disabled={berserkUsedThisCombat}
            className="flex flex-col items-center py-3 rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-40"
            style={{
              background: berserkUsedThisCombat ? "#292524" : "linear-gradient(135deg,#dc2626,#7f1d1d)",
              color: berserkUsedThisCombat ? "#57534e" : "#0c0a09",
              fontFamily: "serif",
            }}>
            <span className="text-xl">🔥</span>
            <span className="text-xs mt-0.5">{t("combat.berserk")}</span>
          </button>
        )}
        {character.id === "rogue" && (
          <button onClick={didDodgeLastTurn ? onSpecial : undefined}
            disabled={!didDodgeLastTurn}
            className="flex flex-col items-center py-3 rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-40"
            style={{
              background: didDodgeLastTurn ? "linear-gradient(135deg,#dc2626,#7f1d1d)" : "#292524",
              color: didDodgeLastTurn ? "#0c0a09" : "#57534e",
              fontFamily: "serif",
            }}>
            <span className="text-xl">🎯</span>
            <span className="text-xs mt-0.5">{t("combat.sneak")}</span>
          </button>
        )}
        {character.id === "mage" && spellSlots && (
          <button onClick={spellSlots.current > 0 ? onToggleSpells : undefined}
            disabled={spellSlots.current === 0}
            className="flex flex-col items-center py-3 rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-40"
            style={{
              background: spellSlots.current > 0 ? "linear-gradient(135deg,#3b82f6,#1e40af)" : "#292524",
              color: spellSlots.current > 0 ? "#0c0a09" : "#57534e",
              fontFamily: "serif",
            }}>
            <span className="text-xl">✦</span>
            <span className="text-xs mt-0.5">{spellSlots.current}/{spellSlots.max}</span>
          </button>
        )}

        <button onClick={onDefend}
          className="flex flex-col items-center py-3 rounded-xl border border-stone-700 bg-stone-900 font-bold active:scale-95 transition-transform"
          style={{ color: "#fde68a", fontFamily: "serif" }}>
          <span className="text-xl">{character.id === "warrior" ? "🛡" : "💨"}</span>
          <span className="text-xs mt-0.5">{character.id === "warrior" ? t("combat.defend") : t("combat.dodge")}</span>
        </button>

        <button onClick={onFreeInput}
          className="flex flex-col items-center py-3 rounded-xl border border-stone-600 bg-stone-950 font-bold active:scale-95 transition-transform"
          style={{ color: "#78716c", fontFamily: "serif" }}>
          <span className="text-xl">✍</span>
          <span className="text-xs mt-0.5">{t("combat.freeAction")}</span>
        </button>
      </div>

      {showSpellMini && spells && spells.map((s, i) => (
        <button key={i} onClick={() => onCastSpell(s)}
          className="w-full text-left px-3 py-2 rounded-lg bg-stone-900 border border-blue-900/60 hover:border-blue-700 transition-colors"
          style={{ fontFamily: "serif" }}>
          <div className="text-amber-100 text-sm font-bold">{s.name}</div>
          <div className="text-stone-500 text-xs">{s.description}</div>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────
export default function SoloDnD() {
  const { t, i18n: i18nInstance } = useTranslation();
  const language: "en" | "ru" = i18nInstance.language === "ru" ? "ru" : "en";

  // CHARACTERS rebuilt whenever the active language changes so the menu
  // shows localized names/items immediately.
  const characters = useMemo(() => buildCharacters(t), [t, i18nInstance.language]);
  const devScenes = useMemo(() => buildDevScenes(t), [t, i18nInstance.language]);
  const freeInputPlaceholders = useMemo(() => {
    const list = i18nInstance.t("free.placeholders", { returnObjects: true }) as unknown;
    return Array.isArray(list) ? (list as string[]) : [];
  }, [i18nInstance, i18nInstance.language]);

  const [screen, setScreen] = useState<"select" | "game">("select");
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hp, setHp] = useState(14);
  const [inventory, setInventory] = useState<string[]>([]);
  const [effects, setEffects] = useState<string[]>([]);
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [allies, setAllies] = useState<Ally[]>([]);
  const [inCombat, setInCombat] = useState(false);
  const [pendingRoll, setPendingRoll] = useState<PendingRoll | null>(null);
  const [pendingInitiative, setPendingInitiative] = useState(false);
  const [freeInput, setFreeInput] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [showInventory, setShowInventory] = useState(false);
  const [showSpells, setShowSpells] = useState(false);
  const [spellSlots, setSpellSlots] = useState<{ current: number; max: number } | null>(null);
  const [berserkChargesLeft, setBerserkChargesLeft] = useState(0);
  const [berserkUsedThisCombat, setBerserkUsedThisCombat] = useState(false);
  const [didDodgeLastTurn, setDidDodgeLastTurn] = useState(false);
  const [defensiveStance, setDefensiveStance] = useState(false);
  const [showSpellMini, setShowSpellMini] = useState(false);
  const [selectingTarget, setSelectingTarget] = useState(false);
  const [freeInputPlaceholder, setFreeInputPlaceholder] = useState("");
  const [showDev, setShowDev] = useState(false);
  const [showDefeated, setShowDefeated] = useState(false);
  // Defeat is "deferred": HP=0, but we let the player read the DM's last
  // message before showing the screen. After the screen closes this flag
  // stays true — it controls showing "Retry / Menu" instead of combat buttons.
  const [defeatPending, setDefeatPending] = useState(false);
  // True once the player explicitly closed the defeat screen — prevents it
  // from reappearing on subsequent DM messages while defeatPending is still on.
  const [defeatDismissed, setDefeatDismissed] = useState(false);
  // Language-switch confirmation dialog (only shown if a session is active).
  const [pendingLanguageSwitch, setPendingLanguageSwitch] = useState<{
    next: "en" | "ru";
    resolve: (ok: boolean) => void;
  } | null>(null);
  const combatStartSnapshotRef = useRef<{ hp: number; enemies: Enemy[]; allies: Ally[] } | null>(null);
  // Bonus action "potion drunk" — accumulated here and attached to the next
  // main player action.
  const pendingPotionInfoRef = useRef<string | null>(null);
  const devTaps = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    character: Character | null;
    hp: number;
    inventory: string[];
    effects: string[];
    enemies: Enemy[];
    allies: Ally[];
    messages: ChatMessage[];
    spellSlots: { current: number; max: number } | null;
    berserkChargesLeft: number;
    didDodgeLastTurn: boolean;
    defensiveStance: boolean;
  }>({ character: null, hp: 0, inventory: [], effects: [], enemies: [], allies: [], messages: [], spellSlots: null, berserkChargesLeft: 0, didDodgeLastTurn: false, defensiveStance: false });
  stateRef.current = { character, hp, inventory, effects, enemies, allies, messages, spellSlots, berserkChargesLeft, didDodgeLastTurn, defensiveStance };

  useEffect(() => { initAnalytics(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, pendingRoll, pendingInitiative]);

  // Pick a fresh free-input placeholder when the placeholder list updates
  // (i.e. on first render and on every language change).
  useEffect(() => {
    if (freeInputPlaceholders.length === 0) {
      setFreeInputPlaceholder("");
      return;
    }
    const idx = Math.floor(Math.random() * freeInputPlaceholders.length);
    setFreeInputPlaceholder(freeInputPlaceholders[idx]);
  }, [freeInputPlaceholders]);

  // When defeat is "deferred" — wait until the DM is done speaking
  // (loading=false), and give the player ~2.2s to read the last message,
  // only then show the "You are defeated" screen.
  useEffect(() => {
    if (!defeatPending || loading || showDefeated || defeatDismissed) return;
    const timer = setTimeout(() => setShowDefeated(true), 2200);
    return () => clearTimeout(timer);
  }, [defeatPending, loading, showDefeated, defeatDismissed, messages]);

  // ── Save (localStorage, SSR-safe) ─────────────────────────────
  function doSave(char: Character, currentHp: number, currentInv: string[], currentEff: string[], msgs: ChatMessage[]) {
    if (typeof window === "undefined") return;
    const recent = msgs.filter(m => m.role === "assistant").slice(-3)
      .map(m => (m.parsed?.narrative || m.content).slice(0, 100)).join(" → ");
    const save = {
      savedAt: new Date().toISOString(),
      locale: language,
      character: { id: char.id, name: char.name, emoji: char.emoji },
      hp: currentHp, maxHp: char.maxHp,
      inventory: currentInv, effects: currentEff,
      plotSummary: recent || "Adventure begins",
      messageCount: msgs.length,
    };
    try { window.localStorage.setItem("dnd_save_v3", JSON.stringify(save)); } catch { /* noop */ }
    trackEvent("session_saved", { characterId: char.id, messageNumber: msgs.length });
  }

  // ── API: request to the /api/dm server function ───────────────
  async function callAPI(char: Character, currentHp: number, currentInv: string[], currentEff: string[], history: ChatMessage[], userMessage: string) {
    const slotsForPrompt = char.id === "mage" ? (stateRef.current.spellSlots ?? { current: 0, max: 0 }) : null;
    const res = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: buildSystemPrompt(char, currentHp, currentInv, currentEff, slotsForPrompt, language),
        messages: [...history, { role: "user", content: userMessage }].map(m => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json() as { text?: string };
    return data.text || t("dm.silent");
  }

  // ── Apply parsed DM response ──────────────────────────────────
  function applyParsed(parsed: Parsed, currentHp: number, currentInv: string[], currentEff: string[], currentEnemies: Enemy[]) {
    let newHp = currentHp;
    let newInv = [...currentInv];
    const newEff = [...currentEff];
    let newEnemies = [...currentEnemies];

    if (parsed.damage) {
      newHp = Math.max(0, newHp - parsed.damage);
      setHp(newHp);
      // Don't show the defeat screen immediately — let the DM finish narrating.
      // We just mark the defeat as "pending"; the effect above will pick up
      // the flag and open the screen with a delay once the DM is done.
      if (newHp <= 0) { setDefeatPending(true); setDefeatDismissed(false); }
    }

    if (parsed.newItems?.length) {
      newInv = [...newInv, ...parsed.newItems];
      setInventory(newInv);
    } else if (parsed.newItem) {
      newInv = [...newInv, parsed.newItem];
      setInventory(newInv);
    }

    if (parsed.upgrades?.length) {
      let changed = false;
      for (const up of parsed.upgrades) {
        const fromLc = up.from.toLowerCase();
        const idx = newInv.findIndex(it => it.toLowerCase() === fromLc || it.toLowerCase().includes(fromLc));
        if (idx >= 0) {
          newInv = [...newInv.slice(0, idx), up.to, ...newInv.slice(idx + 1)];
          changed = true;
        } else {
          // if the old item is missing — just add the new one
          newInv = [...newInv, up.to];
          changed = true;
        }
      }
      if (changed) setInventory(newInv);
    }

    if (parsed.newEnemies?.length) {
      const wasInCombat = currentEnemies.length > 0;
      newEnemies = [...newEnemies, ...parsed.newEnemies];
      setEnemies(newEnemies);
      setInCombat(true);
      if (!wasInCombat) {
        trackEvent("combat_started", {
          characterId: stateRef.current.character?.id,
          messageNumber: stateRef.current.messages.length,
          enemyCount: parsed.newEnemies.length,
        });
      }
    } else if (newEnemies.length === 0) {
      // Safety net: DM forgot to declare enemies via [ENEMY:] but the narrative
      // clearly describes a fight. Try to extract names and HP from text by
      // the "Name (HP: X/Y)" pattern. Keep multilingual combat hints to also
      // catch DM responses written in Russian.
      const combatHints = /(attack|attacks|ambush|HP:|cultist|bandit|enemy|raider|goblin|orc|skeleton|gnoll|атакует|нападает|нападают|культист|бандит|враг|разбойник|гоблин|орк|скелет|гнолл)/i;
      if (combatHints.test(parsed.narrative)) {
        const inferred: Enemy[] = [];
        const hpRe = /([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'`-]{1,30}?)\s*\(\s*HP:\s*(\d+)\s*\/\s*(\d+)\s*\)/gi;
        let m: RegExpExecArray | null;
        const seen = new Set<string>();
        while ((m = hpRe.exec(parsed.narrative)) !== null) {
          const name = m[1].trim().replace(/^[—–\-•:,\.]+/, "").trim();
          const enemyHp = parseInt(m[2]);
          const maxHp = parseInt(m[3]);
          const key = `${name.toLowerCase()}|${maxHp}`;
          if (name && maxHp > 0 && !seen.has(key)) {
            seen.add(key);
            inferred.push({ name, hp: enemyHp, maxHp, ac: 12, damage: "d4+1" });
          }
        }
        if (inferred.length) {
          newEnemies = [...newEnemies, ...inferred];
          setEnemies(newEnemies);
          setInCombat(true);
          trackEvent("combat_started", {
            characterId: stateRef.current.character?.id,
            messageNumber: stateRef.current.messages.length,
            enemyCount: inferred.length,
            inferred: true,
          });
        }
      }
    }

    if (parsed.enemyDamages?.length) {
      for (const ed of parsed.enemyDamages) {
        const targetIdx = newEnemies.findIndex(e => e.hp > 0 && e.name.toLowerCase() === ed.name.toLowerCase());
        if (targetIdx >= 0) {
          newEnemies = newEnemies.map((e, i) =>
            i === targetIdx ? { ...e, hp: Math.max(0, e.hp - ed.damage) } : e
          );
        }
      }
      setEnemies(newEnemies);
    }

    // Allies: spawning and damage
    if (parsed.newAllies?.length) {
      setAllies(prev => [...prev, ...parsed.newAllies.map(a => ({ ...a }))]);
    }
    if (parsed.allyDamages?.length) {
      setAllies(prev => {
        let next = [...prev];
        for (const ad of parsed.allyDamages) {
          const idx = next.findIndex(a => a.hp > 0 && a.name.toLowerCase() === ad.name.toLowerCase());
          if (idx >= 0) {
            next = next.map((a, i) => i === idx ? { ...a, hp: Math.max(0, a.hp - ad.damage) } : a);
          }
        }
        return next;
      });
    }

    if (parsed.combatEnd || (newEnemies.length > 0 && newEnemies.every(e => e.hp <= 0))) {
      const wasInCombat = currentEnemies.length > 0 || stateRef.current.enemies.length > 0;
      setInCombat(false);
      setEnemies([]);
      setAllies([]);
      // Reset combat state on combat end
      setBerserkChargesLeft(0);
      setBerserkUsedThisCombat(false);
      setDidDodgeLastTurn(false);
      setDefensiveStance(false);
      setSelectingTarget(false);
      setShowSpellMini(false);
      pendingPotionInfoRef.current = null;
      if (wasInCombat) {
        trackEvent("combat_ended", {
          characterId: stateRef.current.character?.id,
          messageNumber: stateRef.current.messages.length,
          playerHp: newHp,
        });
      }
    }

    let finalEffects = newEff;
    if (parsed.newEffects?.length) {
      const labels = parsed.newEffects.map(e => e.duration ? `${e.name} (${e.duration})` : e.name);
      finalEffects = [...newEff, ...labels];
      setEffects(finalEffects);
    }

    // On combat end — strip the Berserk effect from the list
    if (parsed.combatEnd || (newEnemies.length > 0 && newEnemies.every(e => e.hp <= 0))) {
      const cleaned = finalEffects.filter(e => !/berserk|берсерк/i.test(e));
      if (cleaned.length !== finalEffects.length) {
        finalEffects = cleaned;
        setEffects(cleaned);
      }
    }

    // On a new combat start — reset dodge, defensive stance and UI flags
    if (parsed.initiativeTrigger) {
      setDidDodgeLastTurn(false);
      setDefensiveStance(false);
      setSelectingTarget(false);
      setShowSpellMini(false);
    }

    return { newHp, newInv, newEff: finalEffects, newEnemies };
  }

  // Auto attack-roll: computes d20+mod+prof vs AC, builds a system message
  // for the DM, sends it via handleChoice. No RollBlock — instant.
  async function executeAttackRoll(req: { weapon: string; dice: string; mod: number; ac: number; targetName?: string }) {
    const hitRoll = rollDice(20);
    const prof = PROFICIENCY_BONUS;
    const total = hitRoll + req.mod + prof;
    const crit = hitRoll === 20;
    const autoMiss = hitRoll === 1;
    const hit = !autoMiss && (crit || total >= req.ac);
    let damage = 0;
    if (hit) {
      const dmgDice = parseDiceSides(req.dice || "d6");
      damage = crit
        ? rollDice(dmgDice) + rollDice(dmgDice) + req.mod
        : rollDice(dmgDice) + req.mod;
      if (damage < 1) damage = 1;
    }
    const tname = req.targetName ? `, target: ${req.targetName}` : "";
    const tagName = req.targetName ?? "Name";
    let msg: string;
    if (autoMiss) {
      msg = i18n.t("system.attackAutoMiss", { weapon: req.weapon, target: tname, ac: req.ac });
    } else if (crit) {
      msg = i18n.t("system.attackCrit", { weapon: req.weapon, target: tname, ac: req.ac, damage, tagName });
    } else if (hit) {
      msg = i18n.t("system.attackHit", { weapon: req.weapon, target: tname, ac: req.ac, damage, tagName, roll: hitRoll, mod: req.mod, prof, total });
    } else {
      msg = i18n.t("system.attackMiss", { weapon: req.weapon, target: tname, ac: req.ac, roll: hitRoll, mod: req.mod, prof, total });
    }
    await handleChoice(msg);
  }

  async function processAndSetMessages(char: Character, currentHp: number, currentInv: string[], currentEff: string[], currentEnemies: Enemy[], reply: string, prevMessages: ChatMessage[]) {
    const parsed = parseDMResponse(reply);
    const newMsgs: ChatMessage[] = [...prevMessages, { role: "assistant", content: reply, parsed }];
    const { newHp, newInv, newEff } = applyParsed(parsed, currentHp, currentInv, currentEff, currentEnemies);
    setMessages(newMsgs);

    // Snapshot the start of every fight — used by the "Restart fight" button
    if (parsed.initiativeTrigger) {
      const snapEnemies = (parsed.newEnemies?.length ? parsed.newEnemies : stateRef.current.enemies).map(e => ({ ...e }));
      const snapAllies = stateRef.current.allies.map(a => ({ ...a }));
      combatStartSnapshotRef.current = { hp: newHp, enemies: snapEnemies, allies: snapAllies };
    }

    let autoAttackReq: { weapon: string; dice: string; mod: number; ac: number } | null = null;

    // In combat, attacks only flow through player combat buttons — not via
    // DM-initiated [ATTACK:] tags. If the DM sends [ATTACK:] in combat
    // anyway (ignoring the prompt), drop the tag so we don't auto-attack
    // after winning initiative.
    const wasInCombat = stateRef.current.enemies.length > 0 || currentEnemies.length > 0;

    if (parsed.initiativeTrigger) {
      setPendingInitiative(true);
      setPendingRoll(null);
    } else if (parsed.attackRequest && !wasInCombat) {
      // Attack outside combat (e.g. an ambush sneak attack) — auto-roll
      const mod = char.stats[char.weapon.stat] || 0;
      autoAttackReq = { ...parsed.attackRequest, mod };
      setPendingRoll(null);
      setPendingInitiative(false);
    } else if (parsed.rollRequest) {
      const lower = parsed.rollRequest.stat.toLowerCase();
      const statKey: Stat = (lower.includes("str") || lower.includes("сил")) ? "str"
        : (lower.includes("dex") || lower.includes("лов")) ? "dex"
        : "int";
      const mod = char.stats[statKey] || 0;
      setPendingRoll({ type: "roll", request: { ...parsed.rollRequest, mod } });
      setPendingInitiative(false);
    } else {
      setPendingRoll(null);
      setPendingInitiative(false);
    }

    doSave(char, newHp, newInv, newEff, newMsgs);
    trackEvent("scene_completed", {
      characterId: char.id,
      messageNumber: newMsgs.length,
      inCombat: stateRef.current.enemies.length > 0,
    });

    if (autoAttackReq) {
      // Run the auto-roll asynchronously after the current tick so state has applied
      setTimeout(() => { void executeAttackRoll(autoAttackReq!); }, 0);
    }

    return newMsgs;
  }

  // ── Game start ────────────────────────────────────────────────
  async function startGame(char: Character, customPrompt?: string) {
    setCharacter(char);
    setHp(char.hp);
    const startInv = [...char.startItems];
    setInventory(startInv);
    setEffects([]);
    setEnemies([]);
    setAllies([]);
    setInCombat(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    setSpellSlots(char.spellSlots ? { ...char.spellSlots } : null);
    setBerserkChargesLeft(0);
    setBerserkUsedThisCombat(false);
    setDidDodgeLastTurn(false);
    setDefensiveStance(false);
    setShowSpellMini(false);
    setSelectingTarget(false);
    setMessages([]);
    setScreen("game");
    setLoading(true);
    trackEvent("game_started", { characterId: char.id, messageNumber: 0, characterName: char.name });
    const prompt = customPrompt || t("dm.startPrompt");
    try {
      const reply = await callAPI(char, char.hp, startInv, [], [], prompt);
      await processAndSetMessages(char, char.hp, startInv, [], [], reply, []);
    } catch {
      const errText = t("dm.connectionError");
      setMessages([{ role: "assistant", content: errText, parsed: parseDMResponse(errText) }]);
    }
    setLoading(false);
  }

  // ── Choice handling ───────────────────────────────────────────
  async function handleChoice(choiceText: string) {
    if (loading) return;
    const { character: c, hp: h, inventory: inv, effects: eff, enemies: en, messages: msgs } = stateRef.current;
    if (!c) return;
    setFreeInput(false);
    setFreeText("");
    setPendingRoll(null);
    setPendingInitiative(false);
    const newMsgs: ChatMessage[] = [...msgs, { role: "user", content: choiceText }];
    setMessages(newMsgs);
    setLoading(true);
    // After EVERY player action in combat — append a system rule so enemies
    // are forced to attack in this same DM response.
    // Exception: the "[Initiative won: ...]" message itself — enemies don't
    // act there; we wait for the player's first action.
    const isInitiativeWin = /Initiative won/i.test(choiceText);
    // If a potion was drunk as a bonus action — attach it to the main action
    // in ONE request so the DM describes both the potion and the attack
    // before enemies retaliate.
    const potionInfo = pendingPotionInfoRef.current;
    pendingPotionInfoRef.current = null;
    const choiceWithPotion = potionInfo ? `${potionInfo}\n${choiceText}` : choiceText;
    const apiMessage = (inCombat || en.length > 0) && !isInitiativeWin
      ? `${choiceWithPotion}\n\n${i18n.t("system.combatTurnReminder")}`
      : choiceWithPotion;
    try {
      const reply = await callAPI(c, h, inv, eff, msgs, apiMessage);
      await processAndSetMessages(c, h, inv, eff, en, reply, newMsgs);
    } catch {
      const lostText = t("dm.connectionLost");
      setMessages([...newMsgs, { role: "assistant", content: lostText, parsed: parseDMResponse(lostText) }]);
    }
    setLoading(false);
  }

  // ── Roll result ───────────────────────────────────────────────
  async function handleRollResult(rollRes: RollResult) {
    const r = pendingRoll;
    if (!r) return;
    setPendingRoll(null);
    let msg: string;
    if (r.type === "attack") {
      const tname = "";
      if (rollRes.autoMiss) {
        msg = i18n.t("system.attackAutoMiss", { weapon: r.request.weapon, target: tname, ac: rollRes.ac });
      } else if (rollRes.crit) {
        msg = i18n.t("system.attackCrit", { weapon: r.request.weapon, target: tname, ac: rollRes.ac, damage: rollRes.damage, tagName: "Name" });
      } else if (rollRes.success) {
        msg = i18n.t("system.attackHit", { weapon: r.request.weapon, target: tname, ac: rollRes.ac, damage: rollRes.damage, tagName: "Name", roll: rollRes.hitRoll, mod: rollRes.mod, prof: rollRes.prof, total: rollRes.total });
      } else {
        msg = i18n.t("system.attackMiss", { weapon: r.request.weapon, target: tname, ac: rollRes.ac, roll: rollRes.hitRoll, mod: rollRes.mod, prof: rollRes.prof, total: rollRes.total });
      }
    } else {
      const modPart = rollRes.mod !== 0 ? `${rollRes.mod >= 0 ? "+" : ""}${rollRes.mod}` : "";
      msg = i18n.t(rollRes.success ? "system.rollSuccess" : "system.rollFail", {
        stat: r.request.stat,
        roll: rollRes.hitRoll,
        modPart,
        total: rollRes.total,
        dc: rollRes.dc,
      });
    }
    await handleChoice(msg);
  }

  async function handleInitiativeResult(res: { player: number; enemy: number; playerWins: boolean }) {
    setPendingInitiative(false);
    const msg = res.playerWins
      ? i18n.t("system.initiativeWon", { player: res.player, enemy: res.enemy })
      : i18n.t("system.initiativeLost", { player: res.player, enemy: res.enemy });
    await handleChoice(msg);
  }

  function handleUseItem(_item: string, idx: number) {
    const { hp: h, character: c } = stateRef.current;
    if (!c) return;
    // In combat, a potion can ONLY be drunk on your turn and ONLY before the main action.
    // "Your turn" conditions: no pending request (loading), no pending roll, no pending initiative.
    if (inCombat && (loading || pendingRoll || pendingInitiative)) return;
    // Cannot drink a second potion on top of an unspent bonus action.
    if (inCombat && pendingPotionInfoRef.current) return;
    const heal = rollDice(6) + 2;
    const newHp = Math.min(c.maxHp, h + heal);
    setHp(newHp);
    setInventory(prev => prev.filter((_, i) => i !== idx));
    setShowInventory(false);
    if (inCombat) {
      // Bonus action: do NOT call the DM now, otherwise enemies attack right after the potion.
      // Apply the effect locally, show a grey system message, and the potion info is
      // attached to the next main player action (attack/dodge/special).
      pendingPotionInfoRef.current = i18n.t("system.potionBonusAction", { heal, hp: newHp, max: c.maxHp });
      const narrativeText = t("combat.potionUsed", { heal, hp: newHp, max: c.maxHp });
      const parsedText = t("combat.potionUsedNarrative", { heal, hp: newHp, max: c.maxHp });
      setMessages(prev => [...prev, {
        role: "assistant",
        content: narrativeText,
        parsed: parseDMResponse(parsedText),
      }]);
      return;
    }
    const narrativeText = t("combat.potionOutOfCombat", { heal, hp: newHp, max: c.maxHp });
    const parsedText = t("combat.potionOutOfCombatNarrative", { heal, hp: newHp, max: c.maxHp });
    setMessages(prev => [...prev, {
      role: "assistant",
      content: narrativeText,
      parsed: parseDMResponse(parsedText),
    }]);
  }

  // Use a potion on the defeated screen — heals and continues the fight
  function handleDefeatedUsePotion() {
    const { inventory: inv, character: c } = stateRef.current;
    if (!c) return;
    const potionIdx = inv.findIndex(isPotion);
    if (potionIdx < 0) return;
    const heal = rollDice(6) + 2;
    setHp(Math.min(c.maxHp, heal));
    setInventory(prev => prev.filter((_, i) => i !== potionIdx));
    setShowDefeated(false);
    setDefeatPending(false);
    const text = t("combat.defeatedRescue", { heal });
    setMessages(prev => [...prev, {
      role: "assistant",
      content: text,
      parsed: parseDMResponse(text),
    }]);
  }

  // Restart the fight — restore the snapshot
  function handleDefeatedRetry() {
    const snap = combatStartSnapshotRef.current;
    const { character: c } = stateRef.current;
    if (!snap || !c) {
      setShowDefeated(false);
      setDefeatPending(false);
      return;
    }
    // Clear first (fix: otherwise enemies/allies double up), then restore in the next tick
    setEnemies([]);
    setAllies([]);
    setShowDefeated(false);
    setDefeatPending(false);
    setBerserkChargesLeft(0);
    setBerserkUsedThisCombat(false);
    setDidDodgeLastTurn(false);
    setDefensiveStance(false);
    setSelectingTarget(false);
    setShowSpellMini(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    setTimeout(() => {
      setHp(snap.hp);
      setEnemies(snap.enemies.map(e => ({ ...e, hp: e.maxHp })));
      setAllies(snap.allies ? snap.allies.map(a => ({ ...a })) : []);
      setInCombat(true);
      void handleChoice(i18n.t("system.retryCombat"));
    }, 0);
  }

  function handleShortRest() {
    const { character: c, hp: h } = stateRef.current;
    if (!c || inCombat) return;
    const heal = rollDice(6);
    const newHp = Math.min(c.maxHp, h + heal);
    setHp(newHp);
    setShowInventory(false);
    const text = t("combat.shortRestNarrative", { heal, hp: newHp, max: c.maxHp });
    setMessages(prev => [...prev, {
      role: "assistant",
      content: text,
      parsed: parseDMResponse(text),
    }]);
  }

  function handleLongRest() {
    const { character: c } = stateRef.current;
    if (!c || inCombat) return;
    setHp(c.maxHp);
    if (c.spellSlots) setSpellSlots({ current: c.spellSlots.max, max: c.spellSlots.max });
    setBerserkChargesLeft(0);
    setBerserkUsedThisCombat(false);
    setShowInventory(false);
    const text = t("combat.longRestNarrative");
    setMessages(prev => [...prev, {
      role: "assistant",
      content: text,
      parsed: parseDMResponse(text),
    }]);
  }

  // ── Combat actions ────────────────────────────────────────────
  async function handleAttack(targetName?: string) {
    const { character: ch, enemies: en, berserkChargesLeft: bcl } = stateRef.current;
    if (!ch) return;
    setSelectingTarget(false);
    setDidDodgeLastTurn(false);
    let mod = ch.stats[ch.weapon.stat] || 0;
    if (bcl > 0) {
      mod += 2;
      setBerserkChargesLeft(prev => Math.max(0, prev - 1));
    }
    if (stateRef.current.defensiveStance) {
      setDefensiveStance(false);
    }
    const target = targetName
      ? en.find(e => e.hp > 0 && e.name === targetName)
      : en.find(e => e.hp > 0);
    const ac = target?.ac ?? 12;
    await executeAttackRoll({ weapon: ch.weapon.name, dice: ch.weapon.dice, mod, ac, targetName: target?.name });
  }

  async function handleBerserk() {
    setBerserkChargesLeft(2);
    setBerserkUsedThisCombat(true);
    setDefensiveStance(false);
    setDidDodgeLastTurn(false);
    setEffects(prev => [...prev, t("combat.berserkEffect")]);
    await handleChoice(i18n.t("system.berserkActivated"));
  }

  async function handleDefend() {
    setDefensiveStance(true);
    setDidDodgeLastTurn(false);
    await handleChoice(i18n.t("system.defendStance"));
  }

  async function handleDodge() {
    setDidDodgeLastTurn(true);
    await handleChoice(i18n.t("system.dodge"));
  }

  async function handleSpell(s: Spell) {
    const slots = stateRef.current.spellSlots;
    if (!slots || slots.current <= 0) return;
    const { character: ch, enemies: en } = stateRef.current;
    if (!ch) return;
    setShowSpells(false);
    setShowSpellMini(false);
    setSpellSlots({ current: slots.current - 1, max: slots.max });
    setDidDodgeLastTurn(false);

    if (s.type === "attack") {
      // Fire Bolt — slot-based attack, auto-roll
      const statKey: Stat = s.stat ?? "int";
      const mod = ch.stats[statKey] || 0;
      const target = en.find(e => e.hp > 0);
      const ac = target?.ac ?? 12;
      await executeAttackRoll({ weapon: s.name, dice: s.dice ?? "d10", mod, ac, targetName: target?.name });
      return;
    }
    if (s.type === "defense") {
      await handleChoice(i18n.t("system.shieldCast"));
      return;
    }
    if (s.type === "control" && s.id === "sleep") {
      // Pool mechanic: 5d8. The DM distributes across enemies from weakest to strongest.
      const pool = rollDice(8) + rollDice(8) + rollDice(8) + rollDice(8) + rollDice(8);
      await handleChoice(i18n.t("system.sleepCast", { pool }));
      return;
    }
    if (s.type === "control") {
      await handleChoice(i18n.t("system.controlSpellCast", { name: s.name }));
      return;
    }
    await handleChoice(i18n.t("system.spellCast", { name: s.name }));
  }

  function exitToMenu() {
    const { character: c, hp: h, inventory: inv, effects: eff, messages: msgs } = stateRef.current;
    if (c) doSave(c, h, inv, eff, msgs);
    setScreen("select");
    setMessages([]);
    setEnemies([]);
    setAllies([]);
    setInCombat(false);
    setPendingRoll(null);
    setPendingInitiative(false);
  }

  function handleDevTap() {
    devTaps.current += 1;
    if (devTaps.current >= 5) {
      devTaps.current = 0;
      const { character: c, hp: h, inventory: inv, effects: eff, messages: msgs } = stateRef.current;
      if (c) doSave(c, h, inv, eff, msgs);
      setShowDev(true);
    }
  }

  async function jumpToScene(prompt: string) {
    const { character: c, hp: h, inventory: inv, effects: eff } = stateRef.current;
    if (!c) return;
    setMessages([]);
    setEnemies([]);
    setAllies([]);
    setInCombat(false);
    setPendingRoll(null);
    setPendingInitiative(false);
    setLoading(true);
    try {
      const reply = await callAPI(c, h, inv, eff, [], prompt);
      await processAndSetMessages(c, h, inv, eff, [], reply, []);
    } catch {
      const text = t("dm.genericError");
      setMessages([{ role: "assistant", content: text, parsed: parseDMResponse(text) }]);
    }
    setLoading(false);
  }

  // Language switch confirmation: only intercept if the user is in a game
  // session (we have a character + at least one DM message), otherwise let
  // the switch happen immediately.
  function handleLanguageBeforeChange(next: "en" | "ru"): Promise<boolean> {
    const inSession = stateRef.current.character !== null && stateRef.current.messages.length > 0;
    if (!inSession) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setPendingLanguageSwitch({ next, resolve });
    });
  }

  function resolveLanguageSwitch(ok: boolean) {
    if (!pendingLanguageSwitch) return;
    pendingLanguageSwitch.resolve(ok);
    setPendingLanguageSwitch(null);
  }

  // ─────────────────────────────────────────────────────────────
  // SELECT SCREEN
  // ─────────────────────────────────────────────────────────────
  if (screen === "select") {
    return (
      <div className="min-h-screen flex flex-col relative" style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>
        <div className="absolute top-3 right-3 z-10">
          <LanguageSwitcher />
        </div>
        <div className="text-center pt-12 pb-6 px-6">
          <div className="text-amber-600 text-xs tracking-[0.4em] uppercase mb-2">{t("menu.tagline")}</div>
          <h1 className="text-4xl font-bold text-amber-100 leading-tight mb-2 whitespace-pre-line">{t("menu.title")}</h1>
          <p className="text-stone-500 text-sm">{t("menu.subtitle")}</p>
          <div className="mt-4 w-16 h-px bg-amber-700/50 mx-auto" />
        </div>
        <div className="px-4 pb-8 flex flex-col gap-3 max-w-md mx-auto w-full">
          <p className="text-stone-500 text-xs text-center mb-1 tracking-wide uppercase">{t("menu.chooseHero")}</p>
          {characters.map(char => (
            <CharacterCard key={char.id} char={char} selected={selectedChar?.id === char.id} onSelect={setSelectedChar} />
          ))}
          <button
            onClick={() => selectedChar && startGame(selectedChar)}
            disabled={!selectedChar}
            className="mt-2 w-full py-4 rounded-2xl font-bold text-lg transition-all duration-300 active:scale-95"
            style={{
              background: selectedChar ? "linear-gradient(135deg,#d97706 0%,#92400e 100%)" : "#292524",
              color: selectedChar ? "#0c0a09" : "#57534e",
              boxShadow: selectedChar ? "0 4px 24px rgba(217,119,6,0.3)" : "none",
              letterSpacing: "0.05em",
            }}>
            {selectedChar ? t("menu.startAs", { name: selectedChar.name }) : t("menu.selectCharacter")}
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // GAME SCREEN
  // ─────────────────────────────────────────────────────────────
  const lastMsg = messages[messages.length - 1];
  const parsed = lastMsg?.parsed;
  // Defeat is registered (HP=0). When the defeat screen is closed, we show
  // "Retry / Menu" instead of combat buttons so the player can re-read the
  // journal or continue.
  const hasPotion = inventory.some(isPotion);
  const showDefeatActions = defeatPending && !showDefeated && !loading;
  const showCombatButtons = !loading && !freeInput && !pendingRoll && !pendingInitiative && !showDefeated && !defeatPending && inCombat && !!character;
  const showChoices = !loading && !freeInput && !pendingRoll && !pendingInitiative && !showDefeated && !defeatPending && !inCombat && (parsed?.choices?.length ?? 0) > 0;
  const showFreeArea = freeInput && !loading && !defeatPending;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(180deg,#0c0a09 0%,#1c1917 100%)", fontFamily: "serif" }}>

      {showInventory && (
        <InventoryPanel
          inventory={inventory}
          effects={effects}
          onUseItem={handleUseItem}
          onShortRest={handleShortRest}
          onLongRest={handleLongRest}
          inCombat={inCombat}
          canUsePotion={showCombatButtons && !pendingPotionInfoRef.current}
          onClose={() => setShowInventory(false)}
        />
      )}
      {showSpells && character && spellSlots && (
        <SpellPanel
          character={character}
          spellSlots={spellSlots}
          onSpell={handleSpell}
          onClose={() => setShowSpells(false)}
        />
      )}
      {showDev && <DevPanel scenes={devScenes} onJump={jumpToScene} onClose={() => setShowDev(false)} />}
      {showDefeated && (
        <DefeatedScreen
          hasPotion={inventory.some(isPotion)}
          onUsePotion={handleDefeatedUsePotion}
          onRetry={handleDefeatedRetry}
          onMenu={() => { setShowDefeated(false); setDefeatPending(false); setDefeatDismissed(false); exitToMenu(); }}
          onClose={() => { setShowDefeated(false); setDefeatDismissed(true); }}
        />
      )}

      {pendingLanguageSwitch && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.85)" }}>
          <div className="max-w-sm w-full bg-stone-900 border border-stone-700 rounded-2xl p-6">
            <div className="text-amber-200 font-bold text-lg mb-2" style={{ fontFamily: "serif" }}>
              {t("language.switchDuringGame.title")}
            </div>
            <div className="text-stone-400 text-sm leading-relaxed mb-5">
              {t("language.switchDuringGame.body")}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => resolveLanguageSwitch(false)}
                className="flex-1 py-2.5 rounded-xl border border-stone-700 bg-stone-800 text-stone-300 text-sm font-bold transition-colors hover:text-stone-100"
                style={{ fontFamily: "serif" }}
              >
                {t("language.switchDuringGame.cancel")}
              </button>
              <button
                onClick={() => resolveLanguageSwitch(true)}
                className="flex-[2] py-2.5 rounded-xl font-bold text-sm text-stone-900 transition-transform active:scale-95"
                style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}
              >
                {t("language.switchDuringGame.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-20 border-b border-stone-800/60 backdrop-blur" style={{ background: "rgba(12,10,9,0.93)" }}>
        <div className="flex items-center justify-between px-4 py-2.5 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={exitToMenu} className="text-stone-500 text-sm hover:text-stone-300 transition-colors whitespace-nowrap">← {t("common.menu")}</button>
            <LanguageSwitcher onBeforeChange={handleLanguageBeforeChange} />
          </div>

          <div className="text-center cursor-pointer select-none" onClick={handleDevTap}>
            <div className="text-amber-200 text-sm font-bold">{character?.emoji} {character?.name}</div>
            <button
              onClick={e => { e.stopPropagation(); setShowInventory(true); }}
              className="text-stone-500 text-xs hover:text-amber-400 transition-colors"
            >
              🎒 {t("header.items", { count: inventory.length })}
            </button>
          </div>

          <div className="flex items-center gap-2 min-w-[60px] justify-end">
            {character?.id === "mage" && spellSlots && (
              <button
                onClick={() => setShowSpells(true)}
                className="text-sm tracking-widest hover:opacity-80 transition-opacity"
                style={{ color: "#60a5fa", fontFamily: "serif" }}
                title={t("header.spellSlotsTitle", { current: spellSlots.current, max: spellSlots.max })}
              >
                {Array.from({ length: spellSlots.max }, (_, i) => i < spellSlots.current ? "✦" : "◇").join("")}
              </button>
            )}
            <div className="flex items-center gap-1.5">
              <div className="text-xs text-stone-500">{t("stats.hp")}</div>
              <div className="font-bold text-sm" style={{ color: character && hp / character.maxHp > 0.5 ? "#f87171" : character && hp / character.maxHp > 0.25 ? "#fbbf24" : "#ef4444" }}>{hp}</div>
              <div className="text-stone-600 text-xs">/{character?.maxHp}</div>
            </div>
          </div>
        </div>

        {inCombat && enemies.filter(e => e.hp > 0).length > 0 && (
          <div className="px-4 pb-2 space-y-1 border-t border-stone-800/40 pt-2">
            {enemies.filter(e => e.hp > 0).map((en, i) => (
              <EnemyHP key={i} name={en.name} hp={en.hp} maxHp={en.maxHp} />
            ))}
          </div>
        )}
        {inCombat && allies.filter(a => a.hp > 0).length > 0 && (
          <div className="px-4 pb-2 space-y-1">
            {allies.filter(a => a.hp > 0).map((ally, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-green-400 text-xs truncate max-w-[100px]">⚔ {ally.name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-stone-800 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.round(ally.hp / ally.maxHp * 100)}%`, background: "#4ade80" }} />
                </div>
                <span className="text-xs text-green-400 font-bold">{ally.hp}/{ally.maxHp}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ paddingBottom: "280px" }}>
        {messages.map((msg, i) => {
          if (msg.role === "user") {
            const isSystem = msg.content.startsWith("[");
            return (
              <div key={i} className="flex justify-end">
                <div className={`max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed ${
                  isSystem
                    ? "bg-stone-950 border border-stone-800 text-stone-500 text-xs font-mono"
                    : "bg-stone-800 text-stone-300"
                }`}>
                  {isSystem ? msg.content.replace(/^\[/, "").replace(/\]$/, "") : msg.content}
                </div>
              </div>
            );
          }
          const p = msg.parsed || parseDMResponse(msg.content);
          const isLast = i === messages.length - 1;
          return (
            <div key={i} className="space-y-2">
              <div className="bg-stone-900/60 rounded-2xl rounded-tl-sm px-4 py-4 border border-stone-800/40 max-w-full overflow-hidden">
                <p className="text-amber-100/90 text-sm leading-relaxed whitespace-pre-line" style={{ fontFamily: "serif", overflowWrap: "break-word", wordBreak: "break-word" }}>
                  {p.narrative}
                </p>
                {p.newItem && <div className="mt-2 text-xs text-amber-500">✦ {t("dm.receivedItem", { item: p.newItem })}</div>}
              </div>
              {p.damage ? (
                <div className="flex justify-end">
                  <div className="rounded-xl border border-red-900/40 bg-stone-950/80 px-3 py-1.5 text-xs text-red-400 font-mono">
                    ⚡ {t("combat.damageToPlayer", { amount: p.damage })}
                  </div>
                </div>
              ) : null}
              {isLast && pendingInitiative && <InitiativeBlock dexMod={character?.stats.dex ?? 0} onResult={handleInitiativeResult} />}
              {isLast && pendingRoll && !pendingInitiative && (
                <RollBlock type={pendingRoll.type} request={pendingRoll.request} onResult={handleRollResult} />
              )}
            </div>
          );
        })}

        {loading && (
          <div className="bg-stone-900/60 rounded-2xl rounded-tl-sm px-4 py-4 border border-stone-800/40">
            <div className="flex gap-1.5 items-center">
              <div className="text-amber-600 text-xs tracking-widest">{t("dm.thinking")}</div>
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1 h-1 bg-amber-600 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-10" style={{ background: "linear-gradient(0deg,#0c0a09 60%,transparent 100%)" }}>
        <div className="px-4 pb-6 pt-3 max-w-md mx-auto space-y-2">
          {showDefeatActions && (
            <>
              <div className="text-center text-xs text-stone-500 pb-1" style={{ fontFamily: "serif" }}>
                {t("defeated.footer")}
              </div>
              {hasPotion && (
                <button onClick={handleDefeatedUsePotion}
                  className="w-full py-3 rounded-xl font-bold text-stone-900"
                  style={{ background: "linear-gradient(135deg,#d97706,#92400e)", fontFamily: "serif" }}>
                  🧪 {t("defeated.drinkPotion")}
                </button>
              )}
              <button onClick={handleDefeatedRetry}
                className="w-full py-3 rounded-xl border border-stone-600 bg-stone-800 text-amber-100 font-bold"
                style={{ fontFamily: "serif" }}>
                ⚔️ {t("defeated.retry")}
              </button>
              <button onClick={() => { setDefeatPending(false); exitToMenu(); }}
                className="w-full py-3 rounded-xl border border-stone-700 bg-stone-900 text-stone-400 text-sm"
                style={{ fontFamily: "serif" }}>
                ← {t("defeated.returnToMenu")}
              </button>
            </>
          )}
          {showCombatButtons && character && (
            <>
              <CombatPanel
                character={character}
                berserkUsedThisCombat={berserkUsedThisCombat}
                didDodgeLastTurn={didDodgeLastTurn}
                spellSlots={spellSlots}
                showSpellMini={showSpellMini}
                spells={character.spells}
                onAttackClick={() => {
                  const liveEnemies = stateRef.current.enemies.filter(e => e.hp > 0);
                  if (liveEnemies.length > 1) {
                    setSelectingTarget(true);
                  } else {
                    void handleAttack();
                  }
                }}
                onSpecial={() => {
                  if (character.id === "warrior") void handleBerserk();
                  else if (character.id === "rogue") void handleAttack(); // sneak = attack after dodge
                  else if (character.id === "mage") setShowSpellMini(v => !v);
                }}
                onDefend={() => {
                  if (character.id === "warrior") void handleDefend();
                  else void handleDodge();
                }}
                onToggleSpells={() => setShowSpellMini(v => !v)}
                onCastSpell={handleSpell}
                onFreeInput={() => {
                  trackEvent("free_input_used", { characterId: character.id, messageNumber: messages.length, inCombat: true });
                  setFreeInput(true);
                }}
              />
              {selectingTarget && (
                <div className="space-y-1 pl-2 border-l-2 border-amber-900/60">
                  <div className="text-xs text-stone-500 px-2">{t("combat.selectTarget")}</div>
                  {enemies.filter(e => e.hp > 0).map((en, i) => (
                    <button key={i}
                      onClick={() => { setSelectingTarget(false); void handleAttack(en.name); }}
                      className="w-full text-left px-3 py-2 rounded-lg bg-stone-900 border border-stone-700 hover:border-amber-700 text-amber-100 text-sm transition-colors"
                      style={{ fontFamily: "serif" }}>
                      {en.name}
                      <span className="text-stone-500 text-xs ml-2">{en.hp}/{en.maxHp} HP</span>
                    </button>
                  ))}
                  <button onClick={() => setSelectingTarget(false)}
                    className="w-full text-center px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors">
                    {t("common.cancel")}
                  </button>
                </div>
              )}
            </>
          )}

          {showChoices && parsed && (
            <>
              {parsed.choices
                .filter(choice => !/free\s*(choice|action)|свой\s*вариант/i.test(choice.text))
                .map((choice, i) => (
                <button key={i} onClick={() => handleChoice(choice.text)}
                  className="w-full text-left px-4 py-3 rounded-xl border border-stone-700 bg-stone-900/95 text-amber-100 text-sm leading-snug transition-all active:scale-[0.98] hover:border-amber-700/50 hover:bg-stone-800"
                  style={{ fontFamily: "serif", overflowWrap: "break-word", wordBreak: "break-word" }}>
                  <span className="text-amber-600 font-bold mr-2">{choice.num}.</span>{choice.text}
                </button>
              ))}
              <button onClick={() => {
                trackEvent("free_input_used", {
                  characterId: stateRef.current.character?.id,
                  messageNumber: stateRef.current.messages.length,
                });
                setFreeInput(true);
              }}
                className="w-full text-left px-4 py-3 rounded-xl border border-stone-800 bg-stone-950/90 text-stone-400 text-sm transition-all active:scale-[0.98] hover:border-stone-600 hover:text-stone-300"
                style={{ fontFamily: "serif" }}>
                <span className="text-stone-600 mr-2">✍</span>{t("dm.freeChoiceLabel")}
              </button>
            </>
          )}

          {showFreeArea && (
            <>
              <textarea autoFocus value={freeText} onChange={e => setFreeText(e.target.value)}
                placeholder={freeInputPlaceholder}
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-stone-600 bg-stone-900 text-amber-100 text-sm leading-relaxed resize-none outline-none focus:border-amber-700 transition-colors"
                style={{ fontFamily: "serif" }} />
              <div className="flex gap-2">
                <button onClick={() => { setFreeInput(false); setFreeText(""); }}
                  className="flex-1 py-2.5 rounded-xl border border-stone-700 bg-stone-900 text-stone-400 text-sm hover:text-stone-300 transition-colors">
                  {t("common.cancel")}
                </button>
                <button onClick={() => freeText.trim() && handleChoice(freeText.trim())}
                  disabled={!freeText.trim()}
                  className="flex-[2] py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
                  style={{
                    background: freeText.trim() ? "linear-gradient(135deg,#d97706,#92400e)" : "#292524",
                    color: freeText.trim() ? "#0c0a09" : "#57534e"
                  }}>
                  {t("common.act")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
