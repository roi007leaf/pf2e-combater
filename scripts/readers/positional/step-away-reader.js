import { slugify } from "../../engine/action/text.js";
import { canAttackTarget, contextEnemies, contextTargets } from "../../engine/target-pool.js";
import { resolveTacticPersonality } from "../../rules/tactic-personality.js";
import { t } from "../../i18n.js";
import { contextProfile, movementBlockingCondition } from "../action/reader-helpers.js";
import { candidateAverageDamage, isRangedStrike, strikeMeleeReach } from "./tactic-helpers.js";

// Hit and reposition: Strike an adjacent enemy, then Step away. Offered only to a Skirmisher -- for
// everyone else a second Strike is the better use of the action, and Step/Stride can't otherwise
// follow an attack that already reaches.
export function readStrikeStepAwayActivities(context, readyStrikes) {
  const tactic = resolveTacticPersonality(context);
  if ((tactic.effectiveRole ?? tactic.role) !== "skirmisher") return [];
  const profile = contextProfile(context);
  if (movementBlockingCondition(profile, { slug: "step" })) return [];
  const melee = (readyStrikes ?? [])
    .filter((strike) => strike?.available !== false && !isRangedStrike(strike))
    .toSorted((left, right) => candidateAverageDamage(right) - candidateAverageDamage(left));
  const targets = [...contextTargets(context), ...contextEnemies(context)].filter(canAttackTarget);
  for (const strike of melee) {
    const reach = strikeMeleeReach(strike);
    const target = targets.find((entry) => Number(entry?.distance ?? Infinity) <= reach);
    if (!target) continue;
    const slug = slugify(strike.name ?? strike.slug ?? "strike");
    return [{
      id: `strike-step-away-${strike.id ?? slug}`,
      name: t("Action.StrikeStepAway", "{strike} -> Step Away", { strike: strike.name }),
      slug: `strike-step-away-${slug}`,
      actionCost: 2,
      actionType: "action",
      source: "system-inferred",
      confidence: "medium",
      executable: "open-item",
      detected: true,
      available: true,
      item: strike.item ?? null,
      traits: strike.traits,
      averageDamage: candidateAverageDamage(strike) || null,
      preferredTarget: target,
      role: "mobility-attack",
      activityProfile: {
        includes: ["strike", "step"],
        includesStrike: true,
        retreatAfterStrike: true,
        fixedDistance: 5,
        safeMovement: true,
        strikeReach: reach,
      },
      targetingProfile: {
        enemy: true,
        preferredTargetId: target.id ?? null,
        preferredTargetName: target.name ?? null,
      },
      attackTrait: true,
      setupFor: [],
      reasons: [t("Reason.StrikeStepAway", "Strike {target}, then Step out of reach.", { target: target.name })],
    }];
  }
  return [];
}
