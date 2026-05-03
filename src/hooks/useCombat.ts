// ─────────────────────────────────────────────────────────────────
// useCombat — extracts combat actions and roll resolution.
// ─────────────────────────────────────────────────────────────────

import i18n from "@/i18n";
import { rollDice, parseDiceSides, PROFICIENCY_BONUS } from "@/game/dice";
import type { Enemy, Spell, Stat } from "@/game/types";
import type { GameDeps } from "./useGameDeps";

export function useCombat(deps: GameDeps) {
  const {
    t, stateRef, dispatch,
    setHp, setEffects, setEnemies, setAllies, setInCombat,
    setDidDodgeLastTurn, setDefensiveStance, setSelectingTarget,
    setPendingAction, setShowSpellMini, setShowSpells,
    setSpellSlots, setNegotiationDeclined,
    setDefeatPending, setDefeatDismissed,
    pendingPotionInfoRef,
  } = deps;

  async function executeAttackRoll(req: {
    weapon: string; dice: string; mod: number; ac: number; targetName?: string;
  }) {
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
    await deps.handleChoiceRef.current(msg);
  }

  async function executeEnemyAttacks(
    attackerNames: string[], currentEnemies: Enemy[], playerAc: number,
  ): Promise<string> {
    const results: string[] = [];
    for (const name of attackerNames) {
      const enemy = currentEnemies.find(
        e => e.hp > 0 && e.name.toLowerCase() === name.toLowerCase()
      );
      if (!enemy) continue;
      const roll = rollDice(20);
      const total = roll + enemy.attackBonus;
      const crit = roll === 20;
      const autoMiss = roll === 1;
      const hit = !autoMiss && (crit || total >= playerAc);
      let dmgDealt = 0;
      if (hit) {
        const dmgDice = parseDiceSides(enemy.damage);
        const dmgMod = parseInt(enemy.damage.split("+")[1] || "0");
        dmgDealt = crit
          ? rollDice(dmgDice) + rollDice(dmgDice) + dmgMod
          : rollDice(dmgDice) + dmgMod;
        if (dmgDealt < 1) dmgDealt = 1;
        const ch = stateRef.current.character;
        const livingEnemies = currentEnemies.filter(e => e.hp > 0);
        const bossPresent = livingEnemies.some(e => e.isBoss);
        if (ch && !bossPresent) {
          const cap = Math.max(1, Math.floor(ch.maxHp * 0.6));
          if (dmgDealt > cap && stateRef.current.hp > ch.maxHp * 0.5) {
            dmgDealt = cap;
          }
        }
        const newHp = Math.max(0, stateRef.current.hp - dmgDealt);
        setHp(newHp);
        if (newHp <= 0) {
          setDefeatPending(true);
          setDefeatDismissed(false);
        }
      }
      if (crit) {
        results.push(i18n.t("combat_log.enemyAttackCrit", { name: enemy.name, dmg: dmgDealt }));
      } else if (autoMiss) {
        results.push(i18n.t("combat_log.enemyAttackMiss", {
          name: enemy.name, roll: 1, atk: enemy.attackBonus,
          total: 1 + enemy.attackBonus, ac: playerAc,
        }));
      } else if (hit) {
        results.push(i18n.t("combat_log.enemyAttackHit", {
          name: enemy.name, roll, atk: enemy.attackBonus,
          total, ac: playerAc, dmg: dmgDealt,
        }));
      } else {
        results.push(i18n.t("combat_log.enemyAttackMiss", {
          name: enemy.name, roll, atk: enemy.attackBonus,
          total, ac: playerAc,
        }));
      }
    }
    return results.join("\n");
  }

  async function handleAttack(targetName?: string) {
    const { character: ch, enemies: en, berserkChargesLeft: bcl } = stateRef.current;
    if (!ch) return;
    setSelectingTarget(false);
    setPendingAction(null);
    setDidDodgeLastTurn(false);
    let mod = ch.stats[ch.weapon.stat] || 0;
    if (bcl > 0) {
      mod += 2;
      dispatch({ type: "DECREMENT_BERSERK_CHARGE" });
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
    dispatch({ type: "ACTIVATE_BERSERK" });
    setEffects(prev => [...prev, t("combat.berserkEffect")]);
    await deps.handleChoiceRef.current(i18n.t("system.berserkActivated"));
  }

  async function handleDefend() {
    setDefensiveStance(true);
    setDidDodgeLastTurn(false);
    await deps.handleChoiceRef.current(i18n.t("system.defendStance"));
  }

  async function handleDodge() {
    setDidDodgeLastTurn(true);
    await deps.handleChoiceRef.current(i18n.t("system.dodge"));
  }

  async function handleSneak(targetName?: string) {
    setSelectingTarget(false);
    setPendingAction(null);
    await handleAttack(targetName);
  }

  async function handleAcceptSurrender(name: string) {
    setEnemies([]);
    setAllies([]);
    setInCombat(false);
    setSelectingTarget(false);
    setPendingAction(null);
    setShowSpellMini(false);
    setNegotiationDeclined(true);
    pendingPotionInfoRef.current = null;
    await deps.handleChoiceRef.current(i18n.t("system.acceptSurrender", { name }));
  }

  async function handleLetThemGo(name: string) {
    setEnemies([]);
    setAllies([]);
    setInCombat(false);
    setSelectingTarget(false);
    setPendingAction(null);
    setShowSpellMini(false);
    setNegotiationDeclined(true);
    pendingPotionInfoRef.current = null;
    await deps.handleChoiceRef.current(i18n.t("system.letThemGo", { name }));
  }

  async function handleSpell(s: Spell, targetName?: string) {
    const slots = stateRef.current.spellSlots;
    if (!slots || slots.current <= 0) return;
    const { character: ch, enemies: en } = stateRef.current;
    if (!ch) return;
    setShowSpells(false);
    setShowSpellMini(false);
    setSelectingTarget(false);
    setPendingAction(null);
    setSpellSlots({ current: slots.current - 1, max: slots.max });
    setDidDodgeLastTurn(false);

    if (s.type === "attack") {
      const statKey: Stat = s.stat ?? "int";
      const mod = ch.stats[statKey] || 0;
      const target = targetName
        ? en.find(e => e.hp > 0 && e.name === targetName)
        : en.find(e => e.hp > 0);
      const ac = target?.ac ?? 12;
      await executeAttackRoll({ weapon: s.name, dice: s.dice ?? "d10", mod, ac, targetName: target?.name });
      return;
    }
    if (s.type === "defense") {
      await deps.handleChoiceRef.current(i18n.t("system.shieldCast"));
      return;
    }
    if (s.type === "control" && s.id === "sleep") {
      const pool = rollDice(8) + rollDice(8) + rollDice(8) + rollDice(8) + rollDice(8);
      await deps.handleChoiceRef.current(i18n.t("system.sleepCast", { pool }));
      return;
    }
    if (s.type === "control") {
      await deps.handleChoiceRef.current(i18n.t("system.controlSpellCast", { name: s.name }));
      return;
    }
    await deps.handleChoiceRef.current(i18n.t("system.spellCast", { name: s.name }));
  }

  return {
    executeAttackRoll, executeEnemyAttacks,
    handleAttack, handleBerserk, handleDefend, handleDodge, handleSneak,
    handleSpell, handleAcceptSurrender, handleLetThemGo,
  };
}
