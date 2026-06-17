import { findCustomAction } from "../catalog/custom-actions.js";
import { GENERIC_ACTIONS } from "../catalog/generic-actions.js";
import { classifySystemAction } from "../engine/action-classifier.js";
import {
  isSeekRelevantVisibility,
  isVisionerActive,
  readVisionerCoverState,
  readVisionerDetectionState,
} from "../integrations/visioner.js";

const ACTION_ITEM_TYPES = new Set(["action", "feat", "feature", "consumable"]);
const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
};
const MOVE_ACTION_SLUGS = new Set([
  "balance",
  "climb",
  "high-jump",
  "long-jump",
  "sneak",
  "step",
  "stride",
  "swim",
  "tumble-through",
]);
const IMMOBILIZING_CONDITIONS = new Set([
  "grappled",
  "grabbed",
  "immobilised",
  "immobilized",
  "paralyzed",
  "petrified",
  "restrained",
  "unconscious",
]);
const PRONE_ALLOWED_MOVE_ACTION_SLUGS = new Set(["crawl", "stand"]);
const GENERIC_ACTIONS_BY_SLUG = new Map(GENERIC_ACTIONS.map((action) => [action.slug, action]));

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return Object.values(collection);
}

function systemValue(value) {
  if (value && typeof value === "object" && "value" in value) return value.value;
  return value;
}

function descriptionHtml(item) {
  return String(systemValue(item?.system?.description) ?? item?.system?.description?.value ?? "");
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function htmlToText(value) {
  return normalizeWhitespace(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function readTraitSlugs(item) {
  const traits = item?.system?.traits;
  const value = traits?.value ?? traits;
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return [];
}

function isActorDocument(value) {
  return Boolean(value && typeof value === "object" && (value.system || value.items || value.itemTypes));
}

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function contextActor(context) {
  if (isActorDocument(context?.actor?.document)) return context.actor.document;
  if (isActorDocument(context?.combatant?.actor)) return context.combatant.actor;
  if (isActorDocument(context?.actor?.object)) return context.actor.object;
  if (isActorDocument(context?.actor)) return context.actor;
  return null;
}

function contextProfile(context) {
  return context?.profile ?? context?.actor?.profile ?? {};
}

function contextTargets(context) {
  return context?.targets ?? context?.battlefield?.targets ?? [];
}

function contextEnemies(context) {
  return context?.enemies ?? context?.battlefield?.enemies ?? contextTargets(context);
}

function contextAllies(context) {
  return context?.allies ?? context?.battlefield?.allies ?? [];
}

export function readActionSources(context) {
  const actor = contextActor(context);
  const generatedStrikes = readGeneratedStrikes(actor, context);
  return [
    ...readGenericActions(context),
    ...generatedStrikes,
    ...readDrawStrikeActivities(actor, context, generatedStrikes),
    ...readStrideStrikeActivities(context, generatedStrikes),
    ...readSkirmishStrikeActivities(context, generatedStrikes),
    ...readGeneratedActivities(actor, context),
    ...readActorItemActions(actor, context),
  ];
}

function readGenericActions(context) {
  return GENERIC_ACTIONS.map((action) => {
    const itemAvailability = isGenericAvailable(action, context);
    return {
      ...action,
      source: "generic",
      confidence: "medium",
      detected: true,
      item: null,
      available: itemAvailability.available,
      unavailableReason: itemAvailability.reason,
    };
  });
}

function genericActionAvailability(slug, context) {
  const action = GENERIC_ACTIONS_BY_SLUG.get(slug);
  return action ? isGenericAvailable(action, context) : availability(true, "");
}

function diceAverage(formula) {
  const text = String(formula ?? "");
  let total = 0;
  let matched = false;
  for (const [, count, faces] of text.matchAll(/(\d+)d(\d+)/g)) {
    total += Number(count) * ((Number(faces) + 1) / 2);
    matched = true;
  }
  for (const flat of text.match(/[+-]\s*\d+(?!d)/g) ?? []) {
    total += Number(flat.replace(/\s/g, ""));
    matched = true;
  }
  return matched && total > 0 ? total : null;
}

// Average expected damage of a strike, read from whichever shape the system uses
// (NPC `damageRolls`, weapon `damage`, or a derived formula). Returns null when no
// damage data is present so scoring can skip the bonus rather than guess.
function readStrikeAverageDamage(strike) {
  const item = strike?.item;
  const rolls = item?.system?.damageRolls;
  if (rolls && typeof rolls === "object") {
    for (const roll of Object.values(rolls)) {
      const average = diceAverage(roll?.damage ?? roll?.formula);
      if (average !== null) return average;
    }
  }

  const damage = item?.system?.damage;
  const dieFaces = Number(String(damage?.die ?? "").replace(/\D/g, ""));
  const diceCount = Number(damage?.dice);
  if (Number.isFinite(dieFaces) && dieFaces > 0 && Number.isFinite(diceCount) && diceCount > 0) {
    return diceCount * ((dieFaces + 1) / 2) + (Number(damage?.modifier) || 0);
  }

  return diceAverage(strike?.damageFormula);
}

function readGeneratedStrikes(actor, context = null) {
  const strikes = Array.isArray(actor?.system?.actions) ? actor.system.actions : [];
  return strikes
    .filter((strike, index) => {
      const slug = slugify(strike?.slug ?? strike?.item?.slug ?? strike?.label ?? strike?.name ?? `strike-${index}`);
      return strike?.type === "strike" || (strike?.type === undefined && !findCustomAction(slug) && !classifySystemAction(strike, readGeneratedActionCost(strike)));
    })
    .filter((strike) => strike?.visible !== false)
    .filter((strike) => strike?.ready !== false)
    .filter((strike) => strike?.canAttack !== false)
    .map((strike, index) => {
      const slug = slugify(strike.slug ?? strike.item?.slug ?? strike.label ?? strike.name ?? `strike-${index}`);
      const traits = readStrikeTraits(strike);
      const range = readStrikeRange(strike, traits);
      const action = {
        range,
        traits,
      };
      const strikeAvailability = generatedStrikeAvailability(context, action);
      return {
        id: `strike-${slug || index}`,
        name: strike.label ?? strike.name ?? strike.item?.name ?? "Strike",
        slug: "strike",
        actionCost: 1,
        source: "strike",
        confidence: "medium",
        executable: "strike",
        attackTrait: true,
        traits,
        weaponTraits: strike.weaponTraits ?? [],
        range,
        detected: true,
        available: strikeAvailability.available,
        unavailableReason: strikeAvailability.reason,
        preferredTarget: strikeAvailability.target,
        strike,
        item: strike.item ?? null,
        variants: strike.variants ?? [],
        attack: strike.attack ?? strike.roll ?? null,
        damage: strike.damage ?? null,
        averageDamage: readStrikeAverageDamage(strike),
        critical: strike.critical ?? null,
      };
    });
}

function readGeneratedActivities(actor, context) {
  const actions = Array.isArray(actor?.system?.actions) ? actor.system.actions : [];
  return actions
    .filter((action, index) => {
      const slug = slugify(action?.slug ?? action?.item?.slug ?? action?.label ?? action?.name ?? `action-${index}`);
      const parsedCost = readGeneratedActionCost(action);
      return action?.type !== "strike" && (action?.type !== undefined || findCustomAction(slug) || classifySystemAction(action, parsedCost));
    })
    .filter((action) => action?.visible !== false)
    .filter((action) => action?.ready !== false)
    .flatMap((action, index) => {
      const slug = slugify(action.slug ?? action.item?.slug ?? action.label ?? action.name ?? `action-${index}`);
      const curated = findCustomAction(slug);
      const parsedCost = readGeneratedActionCost(action);
      const inferred = curated ? null : classifySystemAction(action, parsedCost);
      const tactic = curated ?? inferred;
      const actionCost = curated?.actionCost ?? parsedCost.actionCost;
      const trigger = readTrigger(action.item ?? action);
      const triggerAvailability = readTriggerAvailability(trigger, context);
      const traits = readGeneratedActionTraits(action);
      const movementAvailability = readMovementAvailability(context, { slug, traits, activityProfile: tactic?.activityProfile });
      const available = actionCost !== null
        && actionCost !== Infinity
        && triggerAvailability.available
        && movementAvailability.available;

      if (!tactic && parsedCost.passive) return [];
      if (!curated && actionCost === null) return [];

      return [{
        id: `generated-${action.id ?? action.item?.id ?? slug ?? index}`,
        name: curated?.name ?? action.label ?? action.name ?? action.item?.name ?? slug,
        slug,
        actionCost,
        actionType: parsedCost.type,
        source: curated ? "custom-curated" : (inferred ? "system-inferred" : "custom-unknown"),
        confidence: tactic?.confidence ?? "low",
        executable: tactic?.executable ?? "open-item",
        detected: true,
        available,
        unavailableReason: triggerAvailability.reason || movementAvailability.reason,
        item: action.item ?? null,
        generatedAction: action,
        trigger,
        role: tactic?.role ?? "unknown",
        activityProfile: tactic?.activityProfile ?? null,
        targetingProfile: tactic?.targetingProfile ?? null,
        saveProfile: tactic?.saveProfile ?? null,
        damageProfile: tactic?.damageProfile ?? null,
        gatingProfile: tactic?.gatingProfile ?? null,
        setupFor: tactic?.setupFor ?? [],
        reasons: tactic?.reasons ?? [],
        category: systemValue(action.category ?? action.item?.system?.category),
        traits,
        attackTrait: traits.includes("attack"),
      }];
    });
}

function readGeneratedActionCost(action) {
  if (action?.item) {
    const itemCost = readActionCost(action.item);
    if (itemCost.actionCost !== null) return itemCost;
  }

  const actionType = action?.actionType ?? action?.type ?? "action";
  const actions = action?.actions ?? action?.cost ?? action?.glyph ?? action?.actionCost;
  return parseActionCost(actionType, systemValue(actions));
}

function readGeneratedActionTraits(action) {
  const traitValues = [
    ...(Array.isArray(action?.traits) ? action.traits.map((trait) => trait.slug ?? trait.name ?? trait) : []),
    ...readTraitSlugs(action?.item),
  ];
  return [...new Set(traitValues.filter(Boolean).map((trait) => String(trait)))];
}

function readStrikeTraits(strike) {
  const traitValues = [
    ...(Array.isArray(strike.traits) ? strike.traits.map((trait) => trait.slug ?? trait.name ?? trait) : []),
    ...(Array.isArray(strike.weaponTraits) ? strike.weaponTraits.map((trait) => trait.slug ?? trait.name ?? trait) : []),
    ...readTraitSlugs(strike.item),
  ];
  return [...new Set(traitValues.filter(Boolean).map((trait) => String(trait)))];
}

function readStrikeRange(strike, traits) {
  const item = strike.item;
  const systemRange = item?.system?.range;
  const increment = Number(systemValue(systemRange?.increment ?? systemRange));
  const max = Number(systemValue(systemRange?.max));
  if (Number.isFinite(max) && max > 0) return { max };
  if (Number.isFinite(increment) && increment > 0) return { increment, max: increment };

  const traitReach = traits
    .map((trait) => trait.match(/^reach-(\d+)$/)?.[1])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (traitReach.length) return { max: Math.max(...traitReach) };
  if (traits.includes("reach")) return { max: 10 };
  return { max: 5 };
}

function targetKey(target) {
  return target?.id
    ?? target?.uuid
    ?? target?.token?.id
    ?? target?.token?.uuid
    ?? target?.name
    ?? null;
}

function uniqueTargets(context) {
  const seen = new Set();
  const targets = [];
  for (const target of [...contextTargets(context), ...contextEnemies(context)]) {
    const key = targetKey(target);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    targets.push(target);
  }
  return targets;
}

function hasAttackCollisionLayer() {
  return typeof globalThis.canvas?.walls?.checkCollision === "function"
    || (globalThis.canvas?.walls?.placeables ?? []).some?.(wallBlocksMovement);
}

function canStrikeTargetFromCurrentPosition(context, action, target) {
  const origin = centerPoint(context?.token);
  const targetCenter = centerPoint(target);
  if (!origin || !targetCenter) return true;
  if (!hasAttackCollisionLayer()) return true;

  const metrics = movementGridMetrics();
  const attackerRectangle = rectangleForCenter(origin, tokenFootprintPixels(context?.token, metrics));
  const targetRectangle = rectangleForCenter(targetCenter, tokenFootprintPixels(target, metrics));
  const range = Number(action?.range?.max ?? action?.range?.increment ?? action?.targetingProfile?.maxRange);
  if (Number.isFinite(range) && range > 0 && rectangleDistanceFeet(attackerRectangle, targetRectangle, metrics) > range) {
    return false;
  }

  return canAttackTargetPerimeter(attackerRectangle, targetRectangle, metrics);
}

function generatedStrikeAvailability(context, action) {
  if (!context) return availability(true, "");

  const targets = uniqueTargets(context).filter((target) => actionCanReach(action, target));
  if (!targets.length) return availability(false, "No target in range.");

  const target = targets.find((candidate) => canStrikeTargetFromCurrentPosition(context, action, candidate));
  if (target) return { ...availability(true, ""), target };

  return availability(false, "Attack path to target is blocked.");
}

function readWeaponRange(weapon) {
  const traits = readTraitSlugs(weapon);
  const systemRange = weapon?.system?.range;
  const increment = Number(systemValue(systemRange?.increment ?? systemRange));
  const max = Number(systemValue(systemRange?.max));
  if (Number.isFinite(max) && max > 0) return { max, traits };
  if (Number.isFinite(increment) && increment > 0) return { increment, max: increment, traits };

  const thrownRange = traits
    .map((trait) => trait.match(/^thrown-(\d+)$/)?.[1])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (thrownRange.length) return { max: Math.max(...thrownRange), traits };

  const reachRange = traits
    .map((trait) => trait.match(/^reach-(\d+)$/)?.[1])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (reachRange.length) return { max: Math.max(...reachRange), traits };
  if (traits.includes("reach")) return { max: 10, traits };

  return null;
}

function readWeaponItems(actor) {
  const typedWeapons = collectionValues(actor?.itemTypes?.weapon);
  const typedIds = new Set(typedWeapons.map((item) => item?.id).filter(Boolean));
  const fallbackWeapons = collectionValues(actor?.items)
    .filter((item) => item?.type === "weapon" && !typedIds.has(item?.id));
  return [...typedWeapons, ...fallbackWeapons];
}

function weaponCarryType(weapon) {
  return weapon?.carryType ?? weapon?.system?.equipped?.carryType ?? null;
}

function weaponHandsHeld(weapon) {
  const hands = Number(weapon?.handsHeld ?? weapon?.system?.equipped?.handsHeld);
  return Number.isFinite(hands) ? hands : 0;
}

function isDrawableWeapon(weapon) {
  if (!weapon || weapon.type !== "weapon") return false;
  const category = systemValue(weapon.system?.category);
  if (category === "unarmed") return false;
  if (weapon?.isHeld === true || weaponHandsHeld(weapon) > 0) return false;
  if (weaponCarryType(weapon) === "dropped") return false;
  return readItemAvailability(weapon).available;
}

function actionCanReach(action, target) {
  if (!target) return false;
  const max = Number(action?.range?.max ?? action?.targetingProfile?.maxRange ?? action?.range?.increment);
  return Number.isFinite(max) && max > 0 && (target.distance ?? Infinity) <= max;
}

function readyStrikeCanReach(strikes, target) {
  return strikes.some((strike) => strike?.available !== false && actionCanReach(strike, target));
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function centerPoint(value) {
  const center = value?.center ?? value?.token?.center;
  if (!center) return null;

  const x = numeric(center.x, NaN);
  const y = numeric(center.y, NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function movementGridMetrics() {
  const sceneDistance = numeric(globalThis.canvas?.scene?.grid?.distance, 5) || 5;
  const pixelSize = numeric(globalThis.canvas?.grid?.size, sceneDistance) || sceneDistance;
  return {
    sceneDistance,
    pixelSize,
    pixelsPerFoot: pixelSize / sceneDistance,
  };
}

function movementRay(from, to) {
  const Ray = globalThis.foundry?.utils?.Ray ?? globalThis.Ray;
  return Ray ? new Ray(from, to) : { A: from, B: to };
}

function wallCollisionBlocked(from, to, types) {
  const walls = globalThis.canvas?.walls;
  if (typeof walls?.checkCollision !== "function") return false;

  const ray = movementRay(from, to);
  for (const type of types) {
    try {
      if (walls.checkCollision(ray, { type, mode: "any" })) return true;
    } catch (_error) {
      // Foundry versions disagree on collision type names.
    }
  }
  return false;
}

function canvasTokenById(id) {
  if (!id) return null;
  return (globalThis.canvas?.tokens?.placeables ?? []).find((token) => {
    const document = token?.document ?? token;
    return token?.id === id || document?.id === id || document?.uuid === id;
  }) ?? null;
}

function movementPathBlocked(from, to, token = null) {
  if (typeof token?.checkCollision === "function") {
    try {
      if (token.checkCollision(to, { type: "move", mode: "any", origin: from })) return true;
    } catch (_error) {
      // Fall through to wall-layer collision.
    }
  }

  return wallCollisionBlocked(from, to, ["move", "movement"])
    || wallSegmentsBlockMovement(from, to);
}

function attackPathBlocked(from, to) {
  return wallCollisionBlocked(from, to, ["sight", "move", "movement"])
    || wallSegmentsBlockMovement(from, to);
}

function tokenFootprintPixels(value, metrics) {
  const token = value?.token ?? value ?? {};
  const document = token.document ?? token;
  return {
    width: Math.max(1, numeric(token.width ?? document.width, 1) || 1) * metrics.pixelSize,
    height: Math.max(1, numeric(token.height ?? document.height, 1) || 1) * metrics.pixelSize,
  };
}

function rectangleForCenter(center, footprint) {
  return {
    center,
    x: center.x - footprint.width / 2,
    y: center.y - footprint.height / 2,
    width: footprint.width,
    height: footprint.height,
  };
}

function rectangleDistanceFeet(left, right, metrics) {
  const dx = Math.max(right.x - (left.x + left.width), left.x - (right.x + right.width), 0);
  const dy = Math.max(right.y - (left.y + left.height), left.y - (right.y + right.height), 0);
  return Math.hypot(dx, dy) / metrics.pixelsPerFoot;
}

function gridReachDistanceFeet(left, right, metrics) {
  const dx = Math.max(right.x - (left.x + left.width), left.x - (right.x + right.width), 0);
  const dy = Math.max(right.y - (left.y + left.height), left.y - (right.y + right.height), 0);
  return (Math.max(dx, dy) + metrics.pixelSize) / metrics.pixelsPerFoot;
}

function perimeterSamplePoints(rectangle, metrics) {
  if (!rectangle) return [];

  const columns = Math.max(1, Math.round(rectangle.width / metrics.pixelSize));
  const rows = Math.max(1, Math.round(rectangle.height / metrics.pixelSize));
  const inset = metrics.pixelSize * 0.05;
  const points = [];

  for (let column = 0; column < columns; column += 1) {
    const x = rectangle.x + (column + 0.5) * metrics.pixelSize;
    points.push({ x, y: rectangle.y + inset });
    points.push({ x, y: rectangle.y + rectangle.height - inset });
  }

  for (let row = 0; row < rows; row += 1) {
    const y = rectangle.y + (row + 0.5) * metrics.pixelSize;
    points.push({ x: rectangle.x + inset, y });
    points.push({ x: rectangle.x + rectangle.width - inset, y });
  }

  return points;
}

function nearestPoints(points, target, limit) {
  return points
    .toSorted((left, right) =>
      Math.hypot(left.x - target.x, left.y - target.y)
      - Math.hypot(right.x - target.x, right.y - target.y),
    )
    .slice(0, limit);
}

function canAttackTargetPerimeter(attackerRectangle, targetRectangle, metrics) {
  if (attackPathBlocked(attackerRectangle.center, targetRectangle.center)) return false;

  const originPoints = nearestPoints(
    [attackerRectangle.center, ...perimeterSamplePoints(attackerRectangle, metrics)].filter(Boolean),
    targetRectangle.center,
    8,
  );
  const targetPoints = nearestPoints(
    perimeterSamplePoints(targetRectangle, metrics),
    attackerRectangle.center,
    16,
  );
  const targets = targetPoints.length ? targetPoints : [targetRectangle.center];

  return originPoints.some((origin) =>
    targets.some((target) => !attackPathBlocked(origin, target)),
  );
}

function measureMovementFeet(from, to, metrics) {
  try {
    const path = globalThis.canvas?.grid?.measurePath?.([from, to]);
    const distance = Number(path?.distance ?? path);
    if (Number.isFinite(distance)) return distance;
  } catch (_error) {
    // Fall back to Euclidean distance when Foundry measurement is unavailable.
  }

  return Math.hypot(to.x - from.x, to.y - from.y) / metrics.pixelsPerFoot;
}

function movementPointKey(point) {
  return `${point.x},${point.y}`;
}

function movementNeighbors(center, metrics) {
  const neighbors = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      neighbors.push({
        x: center.x + dx * metrics.pixelSize,
        y: center.y + dy * metrics.pixelSize,
      });
    }
  }
  return neighbors;
}

function movementReachableCenters(origin, distanceFeet, metrics, token = null) {
  const cells = Math.floor(distanceFeet / metrics.sceneDistance);
  const maxOffset = cells * metrics.pixelSize;
  const maxDistance = distanceFeet + 0.0001;
  const centers = [];
  const bestCosts = new Map([[movementPointKey(origin), 0]]);
  const queue = [{ center: origin, cost: 0 }];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const center of movementNeighbors(current.center, metrics)) {
      if (Math.abs(center.x - origin.x) > maxOffset || Math.abs(center.y - origin.y) > maxOffset) continue;
      if (movementPathBlocked(current.center, center, token)) continue;

      const stepCost = measureMovementFeet(current.center, center, metrics);
      const cost = current.cost + stepCost;
      if (!Number.isFinite(cost) || cost > maxDistance) continue;

      const key = movementPointKey(center);
      if ((bestCosts.get(key) ?? Infinity) <= cost) continue;
      bestCosts.set(key, cost);
      centers.push(center);
      queue.push({ center, cost });
    }
  }

  return centers;
}

function hasMovementCollisionLayer(token = null) {
  return typeof globalThis.canvas?.walls?.checkCollision === "function"
    || typeof token?.checkCollision === "function"
    || (globalThis.canvas?.walls?.placeables ?? []).some?.(wallBlocksMovement);
}

function reachableAttackCenters(context, target, distanceFeet, reachFeet) {
  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const origin = centerPoint(context?.token);
  const targetCenter = centerPoint(target);
  if (!origin || !targetCenter) return [];

  const metrics = movementGridMetrics();
  const attackerFootprint = tokenFootprintPixels(context?.token, metrics);
  const targetRectangle = rectangleForCenter(targetCenter, tokenFootprintPixels(target, metrics));
  return movementReachableCenters(origin, distanceFeet, metrics, collisionToken)
    .filter((center) => {
      const attackerRectangle = rectangleForCenter(center, attackerFootprint);
      return gridReachDistanceFeet(attackerRectangle, targetRectangle, metrics) <= reachFeet
        && canAttackTargetPerimeter(attackerRectangle, targetRectangle, metrics);
    });
}

function canMoveIntoReach(context, target, distanceFeet, reachFeet) {
  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const origin = centerPoint(context?.token);
  const targetCenter = centerPoint(target);
  if (!origin || !targetCenter) return true;
  if (!hasMovementCollisionLayer(collisionToken)) return true;
  return reachableAttackCenters(context, target, distanceFeet, reachFeet).length > 0;
}

function canReturnToOrigin(context, fromCenter, distanceFeet) {
  const origin = centerPoint(context?.token);
  if (!origin || !fromCenter) return false;

  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const metrics = movementGridMetrics();
  const originKey = movementPointKey(origin);
  return movementReachableCenters(fromCenter, distanceFeet, metrics, collisionToken)
    .some((center) => movementPointKey(center) === originKey);
}

function drawStrikeTarget(context, range, readyStrikes) {
  const targets = contextTargets(context);
  const enemies = contextEnemies(context);
  return [...targets, ...enemies].find((target) =>
    !readyStrikeCanReach(readyStrikes, target)
      && (target?.distance ?? Infinity) <= range.max,
  ) ?? null;
}

function readDrawStrikeActivities(actor, context, readyStrikes) {
  return readWeaponItems(actor)
    .filter(isDrawableWeapon)
    .flatMap((weapon) => {
      const range = readWeaponRange(weapon);
      if (!range) return [];

      const target = drawStrikeTarget(context, range, readyStrikes);
      if (!target) return [];

      const slug = slugify(weapon.slug ?? weapon.system?.slug ?? weapon.name);
      return [{
        id: `draw-strike-${weapon.id ?? slug}`,
        name: `Draw ${weapon.name} -> Strike`,
        slug: `draw-strike-${slug}`,
        actionCost: 2,
        actionType: "action",
        source: "system-inferred",
        confidence: "medium",
        executable: "open-item",
        detected: true,
        available: true,
        item: weapon,
        preferredTarget: target,
        role: "damage",
        activityProfile: {
          includes: ["draw", "strike"],
          includesStrike: true,
          drawsWeapon: true,
          weaponName: weapon.name,
        },
        targetingProfile: {
          enemy: true,
          maxRange: range.max,
          preferredTargetId: target.id ?? null,
          preferredTargetName: target.name ?? null,
        },
        range: { max: range.max, increment: range.increment },
        traits: range.traits,
        attackTrait: true,
        setupFor: [],
        reasons: [`Draw ${weapon.name} enables a Strike against ${target.name}.`],
      }];
    });
}

function strikeMeleeReach(strike) {
  const reach = Number(strike?.range?.max);
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

// Find a target this strike can reach by Striding, and how many Strides it takes.
// A single Stride covers Speed; two Strides cover double Speed, letting the actor
// simulate closing a gap that one move can't (the "move-move-strike" turn).
function strideStrikePlan(context, profile, strike, readyStrikes) {
  const reach = strikeMeleeReach(strike);
  const speed = movementRange(profile);
  const oneStride = speed + reach;
  const twoStrides = speed * 2 + reach;
  for (const target of [...contextTargets(context), ...contextEnemies(context)]) {
    const distance = target?.distance ?? Infinity;
    if (readyStrikeCanReach(readyStrikes, target)) continue;
    if (distance <= oneStride && canMoveIntoReach(context, target, speed, reach)) return { target, strides: 1 };
    if (distance <= twoStrides && canMoveIntoReach(context, target, speed * 2, reach)) return { target, strides: 2 };
  }
  return null;
}

function readStrideStrikeActivities(context, readyStrikes) {
  const profile = contextProfile(context);
  if (movementBlockingCondition(profile, { slug: "stride" })) return [];

  const seenTargets = new Set();
  return readyStrikes.flatMap((strike) => {
    const reach = strikeMeleeReach(strike);
    const plan = strideStrikePlan(context, profile, strike, readyStrikes);
    if (!plan) return [];
    const { target, strides } = plan;

    const targetKey = target.id ?? target.name;
    if (seenTargets.has(targetKey)) return [];
    seenTargets.add(targetKey);

    const slug = slugify(strike.name ?? strike.slug ?? "strike");
    const movePrefix = "Stride -> ".repeat(strides);
    return [{
      id: `stride-strike-${strike.id ?? slug}`,
      name: `${movePrefix}${strike.name}`,
      slug: `stride-strike-${slug}`,
      actionCost: strides + 1,
      actionType: "action",
      source: "system-inferred",
      confidence: "medium",
      executable: "open-item",
      detected: true,
      available: true,
      item: strike.item ?? null,
      preferredTarget: target,
      role: "mobility-attack",
      activityProfile: {
        includes: [...Array(strides).fill("stride"), "strike"],
        includesStrike: true,
        strideCount: strides,
        strikeReach: reach,
      },
      targetingProfile: {
        enemy: true,
        reachAfterMove: true,
        preferredTargetId: target.id ?? null,
        preferredTargetName: target.name ?? null,
      },
      attackTrait: true,
      setupFor: [],
      reasons: [strides > 1
        ? `Stride twice into reach and Strike ${target.name}.`
        : `Stride into reach and Strike ${target.name}.`],
    }];
  });
}

const DEFENSIVE_COVER_STATES = new Set(["lesser", "standard", "greater"]);

function usefulCoverState(state) {
  const normalized = String(state ?? "").toLowerCase();
  return DEFENSIVE_COVER_STATES.has(normalized) ? normalized : null;
}

function originCoverFromTarget(context, target) {
  if (!isVisionerActive()) return null;
  return usefulCoverState(readVisionerCoverState(target, context));
}

function skirmishStrikePlan(context, profile, strike, readyStrikes) {
  const reach = strikeMeleeReach(strike);
  if (reach <= 5) return null;

  const speed = movementRange(profile);
  for (const target of [...contextTargets(context), ...contextEnemies(context)]) {
    if (readyStrikeCanReach(readyStrikes, target) || (target?.distance ?? Infinity) <= reach) continue;

    const coverState = originCoverFromTarget(context, target);
    if (!coverState) continue;

    const attackCenter = reachableAttackCenters(context, target, speed, reach)
      .find((center) => canReturnToOrigin(context, center, speed));
    if (attackCenter) return { target, coverState, attackCenter };
  }
  return null;
}

function readSkirmishStrikeActivities(context, readyStrikes) {
  const profile = contextProfile(context);
  if (movementBlockingCondition(profile, { slug: "stride" })) return [];

  const seenTargets = new Set();
  return readyStrikes.flatMap((strike) => {
    const plan = skirmishStrikePlan(context, profile, strike, readyStrikes);
    if (!plan) return [];
    const { target, coverState, attackCenter } = plan;

    const targetKey = target.id ?? target.name;
    if (seenTargets.has(targetKey)) return [];
    seenTargets.add(targetKey);

    const reach = strikeMeleeReach(strike);
    const slug = slugify(strike.name ?? strike.slug ?? "strike");
    return [{
      id: `stride-strike-stride-${strike.id ?? slug}`,
      name: `Stride -> ${strike.name} -> Stride`,
      slug: `stride-strike-stride-${slug}`,
      actionCost: 3,
      actionType: "action",
      source: "system-inferred",
      confidence: "medium",
      executable: "open-item",
      detected: true,
      available: true,
      item: strike.item ?? null,
      preferredTarget: target,
      role: "mobility-attack",
      activityProfile: {
        includes: ["stride", "strike", "stride"],
        includesStrike: true,
        retreatAfterStrike: true,
        retreatToOrigin: true,
        strideCount: 2,
        strikeReach: reach,
        defensiveCoverState: coverState,
        attackCenter,
      },
      targetingProfile: {
        enemy: true,
        reachAfterMove: true,
        retreatAfterStrike: true,
        preferredTargetId: target.id ?? null,
        preferredTargetName: target.name ?? null,
      },
      attackTrait: true,
      setupFor: [],
      reasons: [`Stride to attack ${target.name}, then return to ${coverState} cover.`],
    }];
  });
}

function readActorItemActions(actor, context) {
  const typedItems = [
    ...collectionValues(actor?.itemTypes?.action),
    ...collectionValues(actor?.itemTypes?.feat),
    ...collectionValues(actor?.itemTypes?.feature),
    ...collectionValues(actor?.itemTypes?.consumable),
  ];
  const typedIds = new Set(typedItems.map((item) => item?.id).filter(Boolean));
  const fallbackItems = collectionValues(actor?.items)
    .filter((item) => !typedIds.has(item?.id))
    .filter((item) => ACTION_ITEM_TYPES.has(item?.type));

  return [...typedItems, ...fallbackItems].flatMap((item) => {
    if (!item) return [];
    const slug = slugify(item.slug ?? item.system?.slug ?? item.name);
    const curated = findCustomAction(slug);
    const parsedCost = readActionCost(item);
    const inferred = curated ? null : classifySystemAction(item, parsedCost);
    const tactic = curated ?? inferred;
    const actionCost = curated?.actionCost ?? parsedCost.actionCost;
    const itemAvailability = readItemAvailability(item);
    const trigger = readTrigger(item);
    const triggerAvailability = readTriggerAvailability(trigger, context);
    const traits = readTraitSlugs(item);
    const movementAvailability = readMovementAvailability(context, { slug, traits, activityProfile: tactic?.activityProfile });
    const genericAvailability = genericActionAvailability(slug, context);
    const available = actionCost !== null
      && actionCost !== Infinity
      && itemAvailability.available
      && triggerAvailability.available
      && movementAvailability.available
      && genericAvailability.available;

    if (!tactic && parsedCost.passive) return [];
    if (!curated && actionCost === null) return [];

    return [{
      id: `item-${item.id ?? slug}`,
      name: curated?.name ?? item.name,
      slug,
      actionCost,
      actionType: parsedCost.type,
      source: curated ? "custom-curated" : (inferred ? "system-inferred" : "custom-unknown"),
      confidence: tactic?.confidence ?? "low",
      executable: tactic?.executable ?? "open-item",
      detected: true,
      available,
      unavailableReason: itemAvailability.reason || triggerAvailability.reason || movementAvailability.reason || genericAvailability.reason,
      item,
      trigger,
      role: tactic?.role ?? "unknown",
      activityProfile: tactic?.activityProfile ?? null,
      targetingProfile: tactic?.targetingProfile ?? null,
      saveProfile: tactic?.saveProfile ?? null,
      damageProfile: tactic?.damageProfile ?? null,
      gatingProfile: tactic?.gatingProfile ?? null,
      setupFor: tactic?.setupFor ?? [],
      reasons: tactic?.reasons ?? [],
      category: systemValue(item.system?.category),
      traits,
      attackTrait: traits.includes("attack"),
    }];
  });
}

function readTrigger(item) {
  const explicit = systemValue(item?.system?.trigger);
  if (explicit) return normalizeWhitespace(explicit);

  const html = descriptionHtml(item);
  const triggerMatch = html.match(/<strong>\s*Trigger\s*<\/strong>\s*([^<]+)/i);
  if (triggerMatch?.[1]) return normalizeWhitespace(triggerMatch[1]);

  const text = htmlToText(html);
  const textMatch = text.match(/\bTrigger\b\s+(.+?)(?:\s+Requirements\b|\s+Frequency\b|\s+Effect\b|$)/i);
  return textMatch?.[1] ? normalizeWhitespace(textMatch[1]) : "";
}

function contextTriggerEvents(context) {
  const raw = context?.triggerEvents ?? context?.events ?? context?.battlefield?.triggerEvents ?? [];
  return new Set((Array.isArray(raw) ? raw : [raw]).filter(Boolean).map((event) => String(event).toLowerCase()));
}

function triggerEventKeys(trigger) {
  const text = String(trigger ?? "").toLowerCase();
  const keys = [];
  if (/\broll(?:ed)? initiative\b/.test(text)) keys.push("initiative", "initiative-roll", "initiative-rolled");
  if (/\bturn begins\b|\bstart of your turn\b/.test(text)) keys.push("turn-start", "turn-begins");
  if (/\bend of (?:a|any|your|another) .*turn\b/.test(text)) keys.push("turn-end");
  if (/\btargeted\b|\btargets you\b/.test(text)) keys.push("targeted");
  if (/\bhits? you\b|\bdamages? you\b|\battack\b/.test(text)) keys.push("attacked", "damaged");
  if (/\bcast(?:s)? a spell\b/.test(text)) keys.push("spell-cast");
  if (/\bmanipulate\b|\bmove action\b|\branged attack\b|\bleaves a square\b/.test(text)) keys.push("provokes-reaction");
  return keys;
}

function readTriggerAvailability(trigger, context) {
  if (!trigger) return availability(true, "");

  const events = contextTriggerEvents(context);
  const keys = triggerEventKeys(trigger);
  if (keys.some((key) => events.has(key))) return availability(true, "");

  return availability(false, `Trigger is not active: ${trigger}`);
}

function isGenericAvailable(action, context) {
  const profile = contextProfile(context);
  const targets = contextTargets(context);
  const enemies = contextEnemies(context);
  const allies = contextAllies(context);
  const movementAvailability = readMovementAvailability(context, action);

  if (action.playerFacing && isNpcProfile(profile)) {
    return availability(false, "NPCs do not need Recall Knowledge recommendations.");
  }
  if (!movementAvailability.available) {
    return movementAvailability;
  }
  if (action.slug === "raise-a-shield") {
    return availability(Boolean(profile.hasShield), "No shield equipped.");
  }
  if (action.requiresTarget) {
    const targetExists = Boolean(targets.length);
    if (!targetExists) return availability(false, "No enemy target selected.");
  }
  if (Number.isFinite(action.maxRange)) {
    const inRange = [...targets, ...enemies].some((target) => (target?.distance ?? Infinity) <= action.maxRange);
    if (!inRange) return availability(false, `No target within ${action.maxRange} feet.`);
  }
  if (action.requiresEnemyInReach) {
    const enemyInReach = targets.some((target) => (target?.distance ?? Infinity) <= meleeReach(profile));
    if (!enemyInReach) return availability(false, "No enemy in reach.");
  }
  if (action.requiresFreeHand && freeHands(profile) < 1) {
    return availability(false, "No free hand to manipulate an object.");
  }
  if (action.requiresNearbyEnemy) {
    const nearbyEnemy = targets.some((target) => (target?.distance ?? Infinity) <= movementRange(profile));
    if (!nearbyEnemy) return availability(false, "No enemy close enough.");
  }
  if (action.requiresSeekTarget) {
    if (!hasSeekTarget(context, enemies)) {
      return availability(false, "No hidden or undetected target detected.");
    }
  }
  if (action.requiresCombatSignal) {
    if (!hasCombatSignal(context, targets)) {
      return availability(false, "No combat-relevant deception or mental effect detected.");
    }
  }
  if (action.requiresTumbleThroughOpportunity) {
    if (!hasTumbleThroughOpportunity(context, targets)) {
      return availability(false, "No useful path through enemy detected.");
    }
  }
  if (action.requiresTerrain) {
    if (!hasTerrain(context, action.requiresTerrain)) {
      return availability(false, `No ${action.requiresTerrain} terrain detected.`);
    }
  }
  if (action.requiresObstacleInReach) {
    if (!hasObjectInReach(context, profile, ["obstacles", "objects", "hazards", "doors"])) {
      return availability(false, "No obstacle or object in reach.");
    }
  }
  if (action.requiresObjectInReach) {
    if (!hasObjectInReach(context, profile, ["objects"])) {
      return availability(false, "No object in reach.");
    }
  }
  if (action.requiresCover) {
    if (action.slug === "take-cover") {
      if (!hasAdjacentCover(context, profile)) {
        return availability(false, "No adjacent wall or cover.");
      }
    } else if (!hasCoverOrConcealment(profile, context)) {
      return availability(false, "No cover or concealment detected.");
    }
  }
  if (action.requiresHiddenOrCover) {
    if (!hasCoverOrConcealment(profile, context) && !hasCondition(profile, "hidden")) {
      return availability(false, "No hidden state, cover, or concealment detected.");
    }
  }
  if (action.requiresGrabbedOrRestrained) {
    if (!hasCondition(profile, "grabbed") && !hasCondition(profile, "restrained")) {
      return availability(false, "Actor is not grabbed or restrained.");
    }
  }
  if (action.requiresDyingAlly) {
    if (!allies.some((ally) => hasCondition(ally, "dying"))) {
      return availability(false, "No dying ally detected.");
    }
  }
  if (action.requiresDyingOrBleedingAlly) {
    if (!allies.some((ally) => hasCondition(ally, "dying") || hasCondition(ally, "persistent-bleed"))) {
      return availability(false, "No dying or bleeding ally detected.");
    }
  }
  if (action.requiresCompanionOrMinion) {
    if (!hasCompanionOrMinion(context, profile)) {
      return availability(false, "No companion or minion detected.");
    }
  }
  return availability(true, "");
}

function availability(available, reason) {
  return { available, reason };
}

function meleeReach(profile) {
  const reach = Number(profile?.reach ?? profile?.meleeReach);
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

function freeHands(profile) {
  const hands = Number(profile?.handsFree);
  return Number.isFinite(hands) ? hands : 0;
}

function movementRange(profile) {
  const speed = Number(profile?.speed ?? profile?.landSpeed);
  return Number.isFinite(speed) && speed > 0 ? speed : 30;
}

function normalizedTraits(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((trait) => trait?.slug ?? trait?.name ?? trait);
  if (value instanceof Set) return Array.from(value);
  return [];
}

function activityUsesMovement(activityProfile) {
  const includes = Array.isArray(activityProfile?.includes) ? activityProfile.includes : [];
  return Number(activityProfile?.strideCount) > 0
    || includes.some((entry) => ["move", "stride"].includes(String(entry ?? "").toLowerCase()));
}

function actionUsesMovement(action) {
  const slug = String(action?.slug ?? "").toLowerCase();
  if (MOVE_ACTION_SLUGS.has(slug)) return true;
  if (normalizedTraits(action?.traits).some((trait) => String(trait ?? "").toLowerCase() === "move")) return true;
  return activityUsesMovement(action?.activityProfile);
}

function movementBlockingCondition(profile, action) {
  for (const slug of IMMOBILIZING_CONDITIONS) {
    if (hasCondition(profile, slug)) return slug;
  }
  const slug = String(action?.slug ?? "").toLowerCase();
  if (hasCondition(profile, "prone") && !PRONE_ALLOWED_MOVE_ACTION_SLUGS.has(slug)) return "prone";
  return null;
}

function hasMovementCollisionChecker(context) {
  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  return typeof globalThis.canvas?.walls?.checkCollision === "function"
    || Array.isArray(globalThis.canvas?.walls?.placeables)
    || typeof collisionToken?.checkCollision === "function";
}

function basicMovementBlockedByCollision(context, profile, action) {
  const slug = String(action?.slug ?? "").toLowerCase();
  if (!["step", "stride"].includes(slug)) return false;
  if (!hasMovementCollisionChecker(context)) return false;

  const origin = centerPoint(context?.token);
  if (!origin) return false;

  const distance = slug === "step" ? 5 : movementRange(profile);
  const metrics = movementGridMetrics();
  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  return !movementReachableCenters(origin, distance, metrics, collisionToken).length;
}

function readMovementAvailability(context, action) {
  if (!actionUsesMovement(action)) return availability(true, "");

  const profile = contextProfile(context);
  const condition = movementBlockingCondition(profile, action);
  if (condition) return availability(false, `Actor is ${condition}; move actions are unavailable.`);

  if (basicMovementBlockedByCollision(context, profile, action)) {
    return availability(false, "No collision-free movement path.");
  }

  return availability(true, "");
}

function isNpcProfile(profile) {
  return ["npc", "hazard", "loot"].includes(String(profile?.actorType ?? profile?.type ?? "").toLowerCase());
}

function hasTerrain(context, key) {
  const terrain = context?.battlefield?.terrain ?? context?.terrain ?? {};
  if (terrain === key) return true;
  if (Array.isArray(terrain)) return terrain.includes(key);
  return Boolean(terrain?.[key]);
}

function wallDocument(wall) {
  return wall?.document ?? wall ?? {};
}

function wallBlocksMovement(wall) {
  const document = wallDocument(wall);
  const movement = document.move ?? document.movement;
  if (Number(movement) === 0) return false;

  const door = doorTypeValue(document);
  const state = doorStateValue(document);
  const hasDoor = Number(door) > 0
    || ["door", "secret"].includes(String(door ?? "").toLowerCase());
  if (hasDoor && (Number(state) === 1 || String(state ?? "").toLowerCase() === "open")) return false;
  return true;
}

function doorTypeValue(document) {
  return document.door ?? document.doorType ?? document.type;
}

function doorStateValue(document) {
  return document.ds ?? document.doorState ?? document.state;
}

function isLockedDoorWall(wall) {
  const document = wallDocument(wall);
  const door = doorTypeValue(document);
  const state = doorStateValue(document);
  const hasDoor = Number(door) > 0
    || ["door", "secret"].includes(String(door ?? "").toLowerCase());
  return hasDoor && (
    Number(state) === 2
    || document.locked === true
    || String(state ?? "").toLowerCase() === "locked"
  );
}

function wallEndpoints(wall) {
  const document = wallDocument(wall);
  const coords = document.c ?? document.coords;
  if (Array.isArray(coords) && coords.length >= 4) {
    return [{ x: Number(coords[0]), y: Number(coords[1]) }, { x: Number(coords[2]), y: Number(coords[3]) }];
  }
  if (wall?.A && wall?.B) return [wall.A, wall.B];
  if (document.A && document.B) return [document.A, document.B];
  return null;
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function pointToRectangleDistance(point, rectangle) {
  const dx = Math.max(rectangle.x - point.x, point.x - (rectangle.x + rectangle.width), 0);
  const dy = Math.max(rectangle.y - point.y, point.y - (rectangle.y + rectangle.height), 0);
  return Math.hypot(dx, dy);
}

function pointInRectangle(point, rectangle) {
  return point.x >= rectangle.x
    && point.x <= rectangle.x + rectangle.width
    && point.y >= rectangle.y
    && point.y <= rectangle.y + rectangle.height;
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
}

function pointOnSegment(point, start, end) {
  return point.x <= Math.max(start.x, end.x) + 0.0001
    && point.x + 0.0001 >= Math.min(start.x, end.x)
    && point.y <= Math.max(start.y, end.y) + 0.0001
    && point.y + 0.0001 >= Math.min(start.y, end.y);
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(c, a, b)) return true;
  if (o2 === 0 && pointOnSegment(d, a, b)) return true;
  if (o3 === 0 && pointOnSegment(a, c, d)) return true;
  if (o4 === 0 && pointOnSegment(b, c, d)) return true;
  return false;
}

function rectangleEdges(rectangle) {
  const topLeft = { x: rectangle.x, y: rectangle.y };
  const topRight = { x: rectangle.x + rectangle.width, y: rectangle.y };
  const bottomRight = { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height };
  const bottomLeft = { x: rectangle.x, y: rectangle.y + rectangle.height };
  return [
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ];
}

function segmentTouchesRectangle(start, end, rectangle) {
  return pointInRectangle(start, rectangle)
    || pointInRectangle(end, rectangle)
    || rectangleEdges(rectangle).some(([edgeStart, edgeEnd]) => segmentsIntersect(start, end, edgeStart, edgeEnd));
}

function segmentToRectangleDistance(start, end, rectangle) {
  if (segmentTouchesRectangle(start, end, rectangle)) return 0;

  const endpointDistance = Math.min(
    pointToRectangleDistance(start, rectangle),
    pointToRectangleDistance(end, rectangle),
  );
  const cornerDistance = Math.min(
    ...rectangleEdges(rectangle).flatMap(([edgeStart, edgeEnd]) => [
      pointToSegmentDistance(edgeStart, start, end),
      pointToSegmentDistance(edgeEnd, start, end),
    ]),
  );
  return Math.min(endpointDistance, cornerDistance);
}

function wallSegment(wall) {
  const endpoints = wallEndpoints(wall);
  if (!endpoints) return null;
  const [start, end] = endpoints;
  const values = [start.x, start.y, end.x, end.y].map(Number);
  if (!values.every(Number.isFinite)) return null;
  return [{ x: values[0], y: values[1] }, { x: values[2], y: values[3] }];
}

function wallSegmentsBlockMovement(from, to) {
  const walls = globalThis.canvas?.walls?.placeables ?? [];
  if (!Array.isArray(walls) || !walls.length) return false;

  return walls.some((wall) => {
    if (!wallBlocksMovement(wall)) return false;
    const segment = wallSegment(wall);
    return segment ? segmentsIntersect(from, to, segment[0], segment[1]) : false;
  });
}

function hasAdjacentCoverWall(context) {
  const origin = centerPoint(context?.token);
  const walls = globalThis.canvas?.walls?.placeables ?? [];
  if (!origin || !Array.isArray(walls) || !walls.length) return false;

  const metrics = movementGridMetrics();
  const rectangle = rectangleForCenter(origin, tokenFootprintPixels(context?.token, metrics));
  const threshold = Math.max(metrics.pixelsPerFoot * 0.5, 0.0001);
  return walls.some((wall) => {
    const segment = wallSegment(wall);
    if (!segment) return false;
    return segmentToRectangleDistance(segment[0], segment[1], rectangle) <= threshold;
  });
}

function hasAdjacentCover(context, profile) {
  return Boolean(
    profile?.hasAdjacentCover
      || context?.adjacentCover
      || context?.battlefield?.hasAdjacentCover
      || context?.battlefield?.adjacentCover
      || hasAdjacentCoverWall(context),
  );
}

function hasLockedCanvasDoorInReach(context, profile) {
  const origin = centerPoint(context?.token);
  const walls = globalThis.canvas?.walls?.placeables ?? [];
  if (!origin || !Array.isArray(walls) || !walls.length) return false;

  const metrics = movementGridMetrics();
  const reach = meleeReach(profile);
  return walls.some((wall) => {
    if (!isLockedDoorWall(wall)) return false;
    const segment = wallSegment(wall);
    if (!segment) return false;
    return pointToSegmentDistance(origin, segment[0], segment[1])
      / metrics.pixelsPerFoot <= reach;
  });
}

function hasObjectInReach(context, profile, buckets) {
  const reach = meleeReach(profile);
  if (buckets.includes("doors") && hasLockedCanvasDoorInReach(context, profile)) return true;

  return buckets.some((bucket) => {
    const values = context?.battlefield?.[bucket] ?? context?.[bucket] ?? [];
    return Array.isArray(values) && values.some((entry) => (entry?.distance ?? Infinity) <= reach);
  });
}

function hasSeekTarget(context, enemies) {
  const observer = context?.token ?? context?.combatant?.token ?? null;
  const useVisioner = isVisionerActive();
  return enemies.some((enemy) => {
    const visionerState = useVisioner
      ? (enemy?.visionerDetectionState
        ?? enemy?.visibility
        ?? readVisionerDetectionState(observer, enemy))
      : null;
    if (visionerState) return isSeekRelevantVisibility(visionerState);
    if (enemy?.token?.hidden || enemy?.hidden) return true;
    return hasCondition(enemy, "hidden")
      || hasCondition(enemy, "undetected")
      || hasCondition(enemy, "unnoticed")
      || hasCondition(enemy, "invisible");
  });
}

function hasCombatSignal(context, targets) {
  const contextSignals = context?.combatSignals ?? context?.battlefield?.combatSignals ?? [];
  const signals = Array.isArray(contextSignals) ? contextSignals : [contextSignals];
  const targetSignals = targets.flatMap((target) => {
    const values = target?.behaviorSignals ?? target?.combatSignals ?? [];
    return Array.isArray(values) ? values : [values];
  });
  return [...signals, ...targetSignals]
    .map((signal) => String(signal ?? "").toLowerCase())
    .some((signal) => [
      "deception",
      "mental-magic",
      "mental",
      "abnormal-behavior",
      "possessed",
      "charmed",
      "controlled",
    ].includes(signal));
}

function hasTumbleThroughOpportunity(context, targets) {
  const battlefield = context?.battlefield ?? {};
  if (context?.tumbleThroughOpportunity || battlefield.tumbleThroughOpportunity) return true;

  const rawNeeds = context?.tacticalNeeds ?? battlefield.tacticalNeeds ?? [];
  const needs = (Array.isArray(rawNeeds) ? rawNeeds : [rawNeeds])
    .map((need) => String(need ?? "").toLowerCase());
  if (needs.some((need) => ["through-enemy", "flank", "body-block", "reposition-behind"].includes(need))) {
    return true;
  }

  return targets.some((target) =>
    target?.blocksPath
      || target?.needThroughEnemy
      || target?.flankOpportunity
      || target?.offGuardPayoff,
  );
}

function hasCoverOrConcealment(profile, context) {
  return Boolean(
    profile?.hasCover
      || profile?.hasConcealment
      || context?.battlefield?.hasCover
      || context?.battlefield?.hasConcealment,
  );
}

function hasCompanionOrMinion(context, profile) {
  return Boolean(
    profile?.hasCompanion
      || profile?.hasMinion
      || context?.companions?.length
      || context?.minions?.length,
  );
}

function hasCondition(entity, slug) {
  const conditions = entity?.conditions;
  if (!conditions) return false;
  if (Array.isArray(conditions)) {
    return conditions.some((condition) => condition === slug || condition?.slug === slug);
  }
  if (Array.isArray(conditions.slugs) && conditions.slugs.includes(slug)) return true;
  const value = Number(conditions.values?.[slug]);
  if (Number.isFinite(value)) return value > 0;
  return false;
}

export function readActionCost(item) {
  const getterCost = item?.actionCost;
  const getterType = systemValue(getterCost?.type);
  const getterValue = systemValue(getterCost?.value);
  if (getterType) return parseActionCost(getterType, getterValue);

  const actionType = systemValue(item?.system?.actionType);
  const actions = systemValue(item?.system?.actions);
  return parseActionCost(actionType, actions);
}

function readItemAvailability(item) {
  if (!item) return { available: false, reason: "Missing item." };
  if (item.disabled === true || item.system?.disabled === true || item.system?.enabled === false) {
    return { available: false, reason: "Item is disabled." };
  }

  const quantity = Number(systemValue(item.system?.quantity));
  if (item.type === "consumable" && Number.isFinite(quantity) && quantity <= 0) {
    return { available: false, reason: "Consumable quantity is 0." };
  }

  const usesValue = Number(systemValue(item.system?.uses));
  const usesMax = Number(systemValue(item.system?.uses?.max ?? item.system?.uses?.maximum));
  if (Number.isFinite(usesValue) && (!Number.isFinite(usesMax) || usesMax > 0) && usesValue <= 0) {
    return { available: false, reason: "No uses remaining." };
  }

  const frequencyCurrent = Number(systemValue(
    item.system?.frequency?.value
      ?? item.system?.frequency?.current
      ?? item.system?.frequency?.remaining,
  ));
  if (Number.isFinite(frequencyCurrent) && frequencyCurrent <= 0) {
    return { available: false, reason: "Frequency is spent." };
  }

  if (hasUnevaluatedPredicate(item)) {
    return { available: false, reason: "Action has unevaluated PF2e predicate." };
  }

  return { available: true, reason: "" };
}

function hasUnevaluatedPredicate(item) {
  const predicate = item.system?.predicate;
  if (Array.isArray(predicate) && predicate.length > 0) return true;
  if (predicate && typeof predicate === "object" && Object.keys(predicate).length > 0) return true;

  const rules = Array.isArray(item.system?.rules) ? item.system.rules : [];
  return rules.some((rule) => {
    const rulePredicate = rule?.predicate;
    if (Array.isArray(rulePredicate)) return rulePredicate.length > 0;
    return Boolean(rulePredicate && typeof rulePredicate === "object" && Object.keys(rulePredicate).length > 0);
  });
}

function parseActionCost(type, value) {
  const normalizedType = String(type ?? "").toLowerCase();
  if (normalizedType === "passive") {
    return { actionCost: null, type: "passive", passive: true };
  }
  if (normalizedType === "free" || normalizedType === "free-action") {
    return { actionCost: 0, type: "free", passive: false };
  }
  if (normalizedType === "reaction") {
    return { actionCost: "reaction", type: "reaction", passive: false };
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 3) {
    return { actionCost: numeric, type: normalizedType || "action", passive: false };
  }

  const parsedText = parseActionText(value);
  if (parsedText !== null) return { actionCost: parsedText, type: "action", passive: false };
  if (normalizedType === "action") return { actionCost: 1, type: "action", passive: false };
  return { actionCost: null, type: normalizedType || "unknown", passive: false };
}

export function parseActionText(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, " ");
  const numbers = [...text.matchAll(/\b(?:[123]|one|two|three)\b/g)]
    .map((match) => WORD_NUMBERS[match[0]] ?? Number(match[0]))
    .filter((number) => Number.isFinite(number) && number >= 0 && number <= 3);
  if (!numbers.length) return null;
  return Math.min(...numbers);
}
