// ─────────────────────────────────────────────────────────────────
// DM RESPONSE PARSER
// ─────────────────────────────────────────────────────────────────
// Extracts structured game events from the raw text returned by the LLM.
// Tags are part of an internal contract — they are ALWAYS English even
// when the narrative is written in another language.
// ─────────────────────────────────────────────────────────────────

export function parseDMResponse(text: string) {
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
  };
}
