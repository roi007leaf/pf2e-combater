import { t } from "../../i18n.js";
import { isSpellAction, maxRange } from "./facts.js";
import { attackableEnemies } from "./targets.js";
import { contextAllies, contextEnemies } from "../target-pool.js";
import { canUseIntelCategory } from "../../rules/intel-ledger.js";
import { contextActorDocument } from "../actor-context.js";

// A foe's level, when this viewer may know it: a GM always; a player once the party has identified
// the creature (Intel identity).
function knownEnemyLevel(context, enemy) {
  const level = Number(enemy?.actor?.level ?? enemy?.actor?.document?.level ?? enemy?.level);
  if (!Number.isFinite(level)) return null;
  const gm = typeof context?.isGM === "boolean" ? context.isGM : globalThis.game?.user?.isGM === true;
  return gm || canUseIntelCategory(context, enemy, "identity") ? level : null;
}

function weakOppositionPenalty(context, enemies, castRank) {
  const actorLevel = Number(contextActorDocument(context)?.level ?? context?.profile?.level ?? context?.actor?.profile?.level);
  if (!Number.isFinite(actorLevel) || !Number.isFinite(castRank) || !enemies.length) return 0;
  const levels = enemies.map((enemy) => knownEnemyLevel(context, enemy));
  if (levels.some((level) => level === null)) return 0;
  const gap = actorLevel - Math.max(...levels);
  if (gap < 2) return 0;
  const topRank = Math.max(1, Math.ceil(actorLevel / 2));
  const rankWeight = castRank >= topRank ? 1 : castRank >= topRank - 1 ? 0.6 : 0.3;
  return Math.round(Math.min(45, 12 * (gap - 1)) * rankWeight);
}

export function spellTacticalAdjustment(action, role, context) {
  if (!isSpellAction(action)) return { scoreDelta: 0, reasons: [] };

  const profile = action?.activityProfile ?? {};
  const reasons = [];
  let scoreDelta = 0;

  if (action.isCantrip || profile.cantrip) {
    scoreDelta += ["damage", "save-damage", "control"].includes(role) ? 10 : 4;
    reasons.push(t("ScoreReason.CantripConservesSpellSlots", "Cantrip conserves spell slots."));
  } else if (action.isFocusSpell || profile.focus) {
    scoreDelta += 10;
    reasons.push(t("ScoreReason.FocusSpellIsRecoverable", "Focus spell is recoverable after combat."));
  } else if (Number(action.rank ?? profile.rank) > 0) {
    const lowImpact = ["utility", "exploration-utility", "combat-utility"].includes(role)
      || (role === "area-damage" && (context?.battlefield?.enemies?.length ?? 0) <= 1);
    scoreDelta -= lowImpact ? 14 : 5;
    reasons.push(t("ScoreReason.UsesARankedSpell", "Uses a ranked spell slot."));
    // The last slot of a rank is worth more than a spare one.
    const remaining = Number(action.spellResource?.remaining);
    if (action.spellResource?.type !== "prepared" && Number.isFinite(remaining) && remaining <= 1) {
      scoreDelta -= 8;
      reasons.push(t("ScoreReason.LastSlotOfRank", "Last slot of this rank."));
    }
    // Every enemy in the fight is nearly down: a cantrip or a Strike can finish them.
    const enemies = attackableEnemies(context);
    const damaging = ["damage", "save-damage", "area-damage"].includes(role);
    // Weak opposition doesn't deserve the top slots: the further below the caster's level the
    // strongest known foe is, the more a high-rank slot costs.
    const weakFoes = weakOppositionPenalty(context, enemies, Number(action.castRank ?? action.rank ?? profile.rank));
    if (damaging && weakFoes) {
      scoreDelta -= weakFoes;
      reasons.push(t("ScoreReason.WeakFoesSaveSlots", "Weak foes: save the high-rank slot."));
    }
    if (damaging && enemies.length && enemies.every((enemy) => Number(enemy?.hpPercent ?? 1) < 0.3)) {
      scoreDelta -= 15;
      reasons.push(t("ScoreReason.EnemiesNearlyDown", "Enemies are nearly down; save the slot."));
    }
  }

  if (profile.sustained) {
    if (["control", "sustain-control", "buff", "summon"].includes(role)) {
      scoreDelta += 12;
      reasons.push(t("ScoreReason.SustainedSpellCanKeep", "Sustained spell can keep affecting the fight."));
    } else {
      scoreDelta -= 4;
      reasons.push(t("ScoreReason.SustainingMayCostLater", "Sustaining may cost later actions."));
    }
  } else if (profile.lastingDuration && ["control", "sustain-control", "buff", "stealth-defense", "defense", "summon"].includes(role)) {
    scoreDelta += 8;
    reasons.push(t("ScoreReason.DurationCanPersistBeyond", "Duration can persist beyond this turn."));
  }

  if (profile.terrainControl || profile.wall || profile.areaDenial) {
    const enemyCount = contextEnemies(context).length;
    scoreDelta += 14 + Math.min(12, enemyCount * 3);
    reasons.push(t("ScoreReason.BattlefieldControlCanRestrict", "Battlefield control can restrict enemy movement."));
  }
  if (profile.obscuring) {
    scoreDelta += 8;
    reasons.push(t("ScoreReason.ObscuringEffectCanBreak", "Obscuring effect can break enemy lines of sight."));
  }
  if (profile.forcedMovement) {
    scoreDelta += 8;
    reasons.push(t("ScoreReason.ForcedMovementCanImprove", "Forced movement can improve positioning."));
  }

  return { scoreDelta, reasons };
}

export function isRangeBuffSetup(action) {
  return action?.activityProfile?.rangeBuff === true;
}

function spellHasReachableTarget(context, spell) {
  const targeting = spell?.targetingProfile ?? {};
  const range = maxRange(spell);
  if (!Number.isFinite(range)) return true;
  const pool = targeting.enemy ? attackableEnemies(context) : contextAllies(context);
  return pool.some((entity) => (entity?.distance ?? Infinity) <= range);
}

export function rangeBuffIsNeeded(context, siblingSpells) {
  const relevantSpells = (siblingSpells ?? []).filter((spell) => {
    if (!isSpellAction(spell) || isRangeBuffSetup(spell)) return false;
    const targeting = spell.targetingProfile ?? {};
    if (!targeting.enemy && !targeting.ally) return false;
    return Number.isFinite(maxRange(spell));
  });
  if (!relevantSpells.length) return true;
  return relevantSpells.some((spell) => !spellHasReachableTarget(context, spell));
}
