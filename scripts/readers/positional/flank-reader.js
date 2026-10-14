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
import { candidateAverageDamage, isRangedStrike, strikeMeleeReach } from "./tactic-helpers.js";

function orientation(a, b, c) {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(cross) < 1e-9 ? 0 : Math.sign(cross);
}

function onSegment(a, b, point) {
  return point.x >= Math.min(a.x, b.x) - 1e-9 && point.x <= Math.max(a.x, b.x) + 1e-9
    && point.y >= Math.min(a.y, b.y) - 1e-9 && point.y <= Math.max(a.y, b.y) + 1e-9;
}

// Inclusive of endpoints, so a line through a corner touches both sides that meet there.
function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(a, b, c))
    || (o2 === 0 && onSegment(a, b, d))
    || (o3 === 0 && onSegment(c, d, a))
    || (o4 === 0 && onSegment(c, d, b));
}

function rectangleCenter(rectangle) {
  return { x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 };
}

// PF2e flanking: the line between the two flankers' centers passes through opposite sides or
// opposite corners of the target's space (a corner counts as both sides that meet there).
export function flanksTarget(attackerRectangle, allyRectangle, targetRectangle) {
  if (!attackerRectangle || !allyRectangle || !targetRectangle) return false;
  const from = rectangleCenter(attackerRectangle);
  const to = rectangleCenter(allyRectangle);
  const left = targetRectangle.x;
  const right = targetRectangle.x + targetRectangle.width;
  const top = targetRectangle.y;
  const bottom = targetRectangle.y + targetRectangle.height;
  const crosses = (a, b) => segmentsIntersect(from, to, a, b);
  const crossesLeft = crosses({ x: left, y: top }, { x: left, y: bottom });
  const crossesRight = crosses({ x: right, y: top }, { x: right, y: bottom });
  const crossesTop = crosses({ x: left, y: top }, { x: right, y: top });
  const crossesBottom = crosses({ x: left, y: bottom }, { x: right, y: bottom });
  return (crossesLeft && crossesRight) || (crossesTop && crossesBottom);
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
      averageDamage: candidateAverageDamage(strike) || null,
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
