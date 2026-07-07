import { entityKey as targetKey } from "../../foundry-data.js";
import { slugify } from "../../engine/action/text.js";
import { contextAllies } from "../../engine/target-pool.js";
import {
  allyThreatensTarget,
  centerPoint,
  movementGridMetrics,
  reachableAttackCenters,
  tokenPlacementForCenter,
} from "../action/reach.js";
import { movementFootprintForToken } from "../../rules/token-geometry.js";
import { compareTacticalCenters } from "../../rules/battlefield-analysis.js";
import { t } from "../../i18n.js";
import {
  contextProfile,
  movementBlockingCondition,
  movementRange,
  uniqueTargets,
} from "../action/reader-helpers.js";
import { isRangedStrike, strikeMeleeReach } from "./tactic-helpers.js";

function rangeOverlap(aMin, aMax, bMin, bMax) {
  return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

function withinRange(value, min, max) {
  return value >= min && value <= max;
}

// Actor and ally flank a target when they are on opposite sides and actually across from
// each other along that side. Center-only checks accept wrong squares for large targets.
function flanksTarget(attackerRectangle, allyRectangle, targetRectangle) {
  if (!attackerRectangle || !allyRectangle || !targetRectangle) return false;
  const targetCenter = { x: targetRectangle.x + targetRectangle.width / 2, y: targetRectangle.y + targetRectangle.height / 2 };
  const attackerCenter = { x: attackerRectangle.x + attackerRectangle.width / 2, y: attackerRectangle.y + attackerRectangle.height / 2 };
  const allyCenter = { x: allyRectangle.x + allyRectangle.width / 2, y: allyRectangle.y + allyRectangle.height / 2 };
  const dx = attackerCenter.x - targetCenter.x;
  const dy = attackerCenter.y - targetCenter.y;
  const ax = allyCenter.x - targetCenter.x;
  const ay = allyCenter.y - targetCenter.y;
  const targetYMin = targetRectangle.y;
  const targetYMax = targetRectangle.y + targetRectangle.height;
  const targetXMin = targetRectangle.x;
  const targetXMax = targetRectangle.x + targetRectangle.width;

  if (
    dx * ax < 0
    && withinRange(attackerCenter.y, targetYMin, targetYMax)
    && withinRange(allyCenter.y, targetYMin, targetYMax)
  ) {
    const overlap = rangeOverlap(
      attackerRectangle.y, attackerRectangle.y + attackerRectangle.height,
      allyRectangle.y, allyRectangle.y + allyRectangle.height,
    );
    if (overlap > 0) return true;
  }
  if (
    dy * ay < 0
    && withinRange(attackerCenter.x, targetXMin, targetXMax)
    && withinRange(allyCenter.x, targetXMin, targetXMax)
  ) {
    const overlap = rangeOverlap(
      attackerRectangle.x, attackerRectangle.x + attackerRectangle.width,
      allyRectangle.x, allyRectangle.x + allyRectangle.width,
    );
    if (overlap > 0) return true;
  }
  return false;
}

function flankStrikePlan(context, profile, strike) {
  if (isRangedStrike(strike)) return null;

  const reach = strikeMeleeReach(strike);
  const speed = movementRange(profile);
  if (reach <= 0 || speed <= 0) return null;

  const metrics = movementGridMetrics();
  const attackerFootprint = movementFootprintForToken(context?.token);
  const allies = contextAllies(context).filter((ally) => centerPoint(ally));
  if (!allies.length) return null;

  for (const target of uniqueTargets(context)) {
    const targetCenter = centerPoint(target);
    if (!targetCenter) continue;
    const targetRectangle = tokenPlacementForCenter(targetCenter, target, metrics);

    const flankAllies = allies
      .filter((ally) => allyThreatensTarget(ally, target, metrics))
      .map((ally) => ({ ally, rectangle: tokenPlacementForCenter(centerPoint(ally), ally, metrics) }));
    if (!flankAllies.length) continue;

    const attackCenter = reachableAttackCenters(context, target, speed, reach)
      .filter((center) => {
        const attackerRectangle = tokenPlacementForCenter(center, attackerFootprint, metrics);
        return flankAllies.some(({ rectangle }) => flanksTarget(attackerRectangle, rectangle, targetRectangle));
      })
      .toSorted((left, right) => compareTacticalCenters(context, left, right, { target }))[0] ?? null;
    if (!attackCenter) continue;

    const attackCenterRectangle = tokenPlacementForCenter(attackCenter, attackerFootprint, metrics);
    const ally = flankAllies.find(({ rectangle }) => flanksTarget(attackCenterRectangle, rectangle, targetRectangle))?.ally
      ?? flankAllies[0].ally;
    return { target, attackCenter, ally };
  }

  return null;
}

export function readFlankStrikeActivities(context, readyStrikes) {
  const profile = contextProfile(context);
  if (movementBlockingCondition(profile, { slug: "stride" })) return [];

  const seenTargets = new Set();
  return readyStrikes.flatMap((strike) => {
    const plan = flankStrikePlan(context, profile, strike);
    if (!plan) return [];
    const { target, attackCenter, ally } = plan;

    const key = targetKey(target);
    if (key && seenTargets.has(key)) return [];
    if (key) seenTargets.add(key);

    const reach = strikeMeleeReach(strike);
    const slug = slugify(strike.name ?? strike.slug ?? "strike");
    return [{
      id: `flank-strike-${strike.id ?? slug}`,
      name: t("Action.FlankStrike", "Stride to Flank ({strike}'s Reach)", { strike: strike.name }),
      slug: `flank-strike-${slug}`,
      actionCost: 1,
      actionType: "action",
      source: "system-inferred",
      confidence: "medium",
      executable: "chat-guidance",
      detected: true,
      available: true,
      item: strike.item ?? null,
      preferredTarget: target,
      role: "mobility",
      requiresDestination: true,
      destination: attackCenter,
      activityProfile: {
        includes: ["stride"],
        strideCount: 1,
        strikeReach: reach,
        attackCenter,
        setsUpFlank: true,
        flankAllyId: ally?.id ?? ally?.token?.id ?? null,
        flankAllyName: ally?.name ?? null,
        targetOffGuard: true,
      },
      targetingProfile: {
        enemy: true,
        reachAfterMove: true,
        preferredTargetId: target.id ?? null,
        preferredTargetName: target.name ?? null,
      },
      attackTrait: false,
      setupFor: [],
      reasons: [t("Reason.FlankStrike", "Strides within its {reach}-foot reach to flank {target} with {ally}, setting up an off-guard Strike.", { reach, target: target.name, ally: ally?.name ?? t("Reason.AnAlly", "an ally") })],
    }];
  });
}
