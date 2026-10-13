import { contextEnemies } from "../../engine/target-pool.js";
import { hpPercent } from "../../engine/scoring/facts.js";
import { resolveTacticPersonality } from "../../rules/tactic-personality.js";
import { t } from "../../i18n.js";
import { canvasTokenById } from "../../rules/canvas-geometry.js";
import {
  centerPoint,
  distanceFromCenterToTarget,
  movementGridMetrics,
  movementReachableCenters,
  targetThreatReach,
} from "../action/reach.js";
import { contextProfile, movementBlockingCondition, movementRange } from "../action/reader-helpers.js";

// A wounded cautious or cowardly creature backs off: Stride to the nearest square no enemy can reach.
const RETREAT_TEMPERAMENTS = new Set(["cautious", "coward"]);
const RETREAT_HP = 0.4;

function threatening(enemy) {
  if (enemy?.hpPercent === 0) return false;
  const slugs = enemy?.conditions?.slugs ?? [];
  return !["unconscious", "paralyzed", "petrified", "stunned", "dead"].some((slug) => slugs.includes(slug));
}

export function readRetreatMoveActivities(context) {
  const profile = contextProfile(context);
  if (!(hpPercent(profile) < RETREAT_HP)) return [];
  const tactic = resolveTacticPersonality(context);
  if (!RETREAT_TEMPERAMENTS.has(tactic.effectiveTemperament ?? tactic.temperament)) return [];
  if (movementBlockingCondition(profile, { slug: "stride" })) return [];

  const origin = centerPoint(context?.token);
  const speed = movementRange(profile);
  if (!origin || speed <= 0) return [];
  const enemies = contextEnemies(context).filter(threatening);
  const threatsAt = (center) => enemies.filter((enemy) => distanceFromCenterToTarget(context, center, enemy) <= targetThreatReach(enemy)).length;
  const threatsNow = threatsAt(origin);
  if (!threatsNow) return [];

  const token = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const nearest = (center) => Math.min(...enemies.map((enemy) => distanceFromCenterToTarget(context, center, enemy)));
  const destination = movementReachableCenters(origin, speed, movementGridMetrics(), token, context)
    .filter((center) => threatsAt(center) === 0)
    .toSorted((left, right) => nearest(right) - nearest(left) || (left.cost ?? 0) - (right.cost ?? 0))[0];
  if (!destination) return [];

  return [{
    id: "retreat-stride",
    name: t("Action.Retreat", "Stride Away"),
    slug: "stride",
    actionCost: 1,
    actionType: "action",
    source: "system-inferred",
    confidence: "medium",
    executable: "chat-guidance",
    detected: true,
    available: true,
    role: "defense",
    destination: { x: destination.x, y: destination.y },
    activityProfile: { includes: ["stride"], retreat: true, threatsEscaped: threatsNow },
    targetingProfile: { self: true },
    setupFor: [],
    reasons: [t("Reason.Retreat", "Badly hurt: Stride out of every enemy's reach.")],
  }];
}
