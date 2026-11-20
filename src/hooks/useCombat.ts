// ─────────────────────────────────────────────────────────────────
// useCombat — extracts combat actions and roll resolution.
// ─────────────────────────────────────────────────────────────────

import i18n from "@/i18n";
import { combatReference, findCombatantIndex } from "@/game/combatReferences";
import { recordPlayerAttack, selectEnemyAttackers } from "@/game/combatTurn";
import { resolveEnemyAttack } from "@/game/enemyBalance";
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

  function turnLocked() {
    return deps.loading || deps.pendingCombatTurn !== null || deps.turnRequestInFlight.current;
  }

  async function executeAttackRoll(req: {
    weapon: string; dice: string; mod: number; ac: number; targetRef?: string;
  }) {
    if (turnLocked()) return;
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
    const { enemies, artifactBonus } = stateRef.current;
    const attack = recordPlayerAttack(enemies, req.targetRef, damage, artifactBonus);
    const tname = req.targetRef ? `, target: ${req.targetRef}` : "";
    const tagName = req.targetRef ?? "Name";
    let msg: string;
    if (autoMiss) {
      msg = i18n.t("system.attackAutoMiss", { weapon: req.weapon, target: tname, ac: req.ac });
    } else if (crit) {
      msg = i18n.t(attack ? "system.combatAttackCrit" : "system.attackCrit", {
        weapon: req.weapon, target: tname, ac: req.ac, damage: attack?.damage ?? damage, tagName,
      });
    } else if (hit) {
      msg = i18n.t(attack ? "system.combatAttackHit" : "system.attackHit", {
        weapon: req.weapon, target: tname, ac: req.ac, damage: attack?.damage ?? damage, tagName, roll: hitRoll, mod: req.mod, prof, total,
      });
    } else {
      msg = i18n.t("system.attackMiss", { weapon: req.weapon, target: tname, ac: req.ac, roll: hitRoll, mod: req.mod, prof, total });
    }
    await deps.handleChoiceRef.current(msg, { attack });
  }

  function executeEnemyAttacks(
    attackerNames: string[], currentEnemies: Enemy[], playerAc: number, playerHp: number, disadvantage = false,
  ) {
    const results: string[] = [];
    const maxHp = stateRef.current.character?.maxHp ?? playerHp;
    for (const enemy of selectEnemyAttackers(attackerNames, currentEnemies)) {
      if (playerHp <= 0) break;
      const attack = resolveEnemyAttack(enemy, playerAc, maxHp, disadvantage);
      if (attack.hit) {
        playerHp = Math.max(0, playerHp - attack.damageDealt);
        setHp(playerHp);
        if (playerHp === 0) {
          setDefeatPending(true);
          setDefeatDismissed(false);
        }
      }
      const result = attack.crit ? "enemyAttackCrit" : attack.hit ? "enemyAttackHit" : "enemyAttackMiss";
      const log = i18n.t(`combat_log.${result}`, {
        name: enemy.name, roll: attack.die, atk: attack.attackBonus, total: attack.total,
        ac: playerAc, dmg: attack.damageDealt,
      });
      const dice = attack.second === null ? "" : i18n.t("combat_log.disadvantage", {
        first: attack.first, second: attack.second,
      });
      results.push(log + dice);
    }
    return { log: results.join("\n"), hp: playerHp };
  }

  async function handleAttack(targetRef?: string) {
    if (turnLocked()) return;
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
    const targetIndex = targetRef
      ? findCombatantIndex(en, "enemy", targetRef)
      : en.findIndex(enemy => enemy.hp > 0);
    await executeAttackRoll({
      weapon: ch.weapon.name, dice: ch.weapon.dice, mod,
      ac: en[targetIndex]?.ac ?? 12,
      targetRef: targetIndex === -1 ? undefined : combatReference("enemy", targetIndex),
    });
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
    await deps.handleChoiceRef.current(i18n.t("system.dodge"), { dodge: true });
  }

  async function handleSneak(targetRef?: string) {
    setSelectingTarget(false);
    setPendingAction(null);
    await handleAttack(targetRef);
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

  async function handleSpell(s: Spell, targetRef?: string) {
    if (turnLocked()) return;
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
      const targetIndex = targetRef
        ? findCombatantIndex(en, "enemy", targetRef)
        : en.findIndex(enemy => enemy.hp > 0);
      await executeAttackRoll({
        weapon: s.name, dice: s.dice ?? "d10", mod,
        ac: en[targetIndex]?.ac ?? 12,
        targetRef: targetIndex === -1 ? undefined : combatReference("enemy", targetIndex),
      });
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
