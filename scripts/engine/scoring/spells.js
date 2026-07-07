import { t } from "../../i18n.js";
import { isSpellAction, maxRange } from "./facts.js";
import { attackableEnemies } from "./targets.js";
import { contextAllies, contextEnemies } from "../target-pool.js";

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
