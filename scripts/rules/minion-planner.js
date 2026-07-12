import { actorStrikeOptions } from "../readers/action/reader.js";
import { actorMovementOptions, readActorSpeed } from "../readers/actor-profile.js";
import { t } from "../i18n.js";
import { numeric } from "./canvas-geometry.js";

function center(value) {
  const point = value?.center ?? value?.token?.center;
  const x = Number(point?.x);
  const y = Number(point?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function measureDistance(from, to) {
  if (!from || !to) return Infinity;
  try {
    const path = globalThis.canvas?.grid?.measurePath?.([from, to]);
    const distance = path?.distance ?? path;
    if (Number.isFinite(distance)) return distance;
  } catch (_error) {
    // fall through to simple pixel distance
  }
  const gridSize = numeric(globalThis.canvas?.grid?.size, 50) || 50;
  const sceneDistance = numeric(globalThis.canvas?.scene?.grid?.distance, 5) || 5;
  return (Math.hypot(to.x - from.x, to.y - from.y) / gridSize) * sceneDistance;
}

function actorSpeed(actor) {
  return readActorSpeed(actor);
}

function strikeRange(strike) {
  return numeric(strike?.range?.max ?? strike?.range?.increment, 5) || 5;
}

function familiarAttackRollName() {
  return t("MinionPlan.AttackRoll", "Attack Roll");
}

function isFamiliarActor(actor) {
  return String(actor?.type ?? "").toLowerCase() === "familiar";
}

function familiarAttackRollOption(actor) {
  if (!isFamiliarActor(actor)) return null;
  return {
    id: "familiar-attack-roll",
    name: familiarAttackRollName(),
    slug: "familiar-attack-roll",
    actionCost: 1,
    source: "familiar",
    confidence: "high",
    executable: "familiar-attack-roll",
    attackTrait: true,
    traits: ["attack"],
    range: { max: 5 },
    detected: true,
    available: true,
    averageDamage: 0,
    attackStatistic: actor?.attackStatistic ?? null,
    activityProfile: {
      includes: ["attack"],
      includesStrike: true,
      familiarAttackRoll: true,
    },
  };
}

function minionAttackOptions(actor, context) {
  const options = actorStrikeOptions(actor, context);
  const familiarAttack = familiarAttackRollOption(actor);
  if (!familiarAttack) return options;
  const familiarName = familiarAttack.name.toLowerCase();
  if (options.some((option) => String(option?.name ?? "").trim().toLowerCase() === familiarName)) return options;
  return [...options, familiarAttack];
}

function bestStrike(strikes) {
  return [...strikes].toSorted((left, right) =>
    numeric(right?.averageDamage, 0) - numeric(left?.averageDamage, 0),
  )[0] ?? null;
}

function minionActionBudget(options = {}) {
  const budget = options.minionActionBudget ?? options.actionBudget;
  return Math.max(1, Math.min(3, Math.round(numeric(budget, 2)) || 2));
}

function minionSteps({ actionBudget, distance, range, speed, strikeName }) {
  const safeBudget = Math.max(1, Math.min(3, Number(actionBudget) || 2));
  const strideName = t("MinionPlan.Stride", "Stride");
  if (distance <= range) return Array.from({ length: safeBudget }, () => strikeName);

  const stridesToReach = Math.max(1, Math.ceil(Math.max(0, distance - range) / Math.max(speed, 1)));
  if (stridesToReach < safeBudget) {
    return [
      ...Array.from({ length: stridesToReach }, () => strideName),
      ...Array.from({ length: safeBudget - stridesToReach }, () => strikeName),
    ];
  }

  return Array.from({ length: safeBudget }, () => strideName);
}

function minionBasicSteps(actionBudget) {
  const safeBudget = Math.max(1, Math.min(3, Number(actionBudget) || 2));
  return Array.from({ length: safeBudget }, () => t("MinionPlan.Stride", "Stride"));
}

function uniqueLabels(labels) {
  const seen = new Set();
  const result = [];
  for (const label of labels) {
    const name = String(label ?? "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function minionActionOptions(strikes) {
  const strikeNames = strikes.map((strike) => strike?.name).filter(Boolean);
  return uniqueLabels([
    t("MinionPlan.Stride", "Stride"),
    ...strikeNames,
    t("MinionPlan.Seek", "Seek"),
    t("MinionPlan.Stand", "Stand"),
    t("MinionPlan.Leap", "Leap"),
    t("MinionPlan.DropProne", "Drop Prone"),
  ]);
}

function minionScoreDelta(steps, strikeName) {
  const strikeCount = steps.filter((step) => step === strikeName).length;
  const strideCount = steps.length - strikeCount;
  if (strikeCount >= 2 && strideCount === 0) return 24 + (strikeCount - 2) * 6;
  if (strikeCount > 0) return 18 + Math.max(0, strikeCount - 1) * 6 - Math.max(0, strideCount - 1) * 2;
  return 4 + steps.length * 2;
}

function minionContext(baseContext, minion, enemies) {
  return {
    ...baseContext,
    actor: resolvedMinionActor(minion),
    token: minion.token,
    battlefield: {
      ...(baseContext?.battlefield ?? {}),
      enemies,
      targets: enemies.slice(0, 1),
    },
  };
}

function resolvedMinionActor(minion) {
  return minion?.actor?.document
    ?? minion?.token?.actor?.document
    ?? minion?.token?.document?.actor?.document
    ?? minion?.token?.actor
    ?? minion?.token?.document?.actor
    ?? minion?.actor
    ?? null;
}

function enemiesFromMinion(minion, enemies) {
  const origin = center(minion);
  return enemies.map((enemy) => ({
    ...enemy,
    distance: measureDistance(origin, center(enemy)),
  })).toSorted((left, right) => left.distance - right.distance);
}

export function planMinionSubturn(context, options = {}) {
  const minions = context?.minions ?? context?.companions ?? [];
  const enemies = context?.battlefield?.enemies ?? context?.enemies ?? [];
  if (!minions.length || !enemies.length) return null;
  const actionBudget = minionActionBudget(options);

  for (const minion of minions) {
    const actor = resolvedMinionActor(minion);
    if (!actor) continue;
    const projectedEnemies = enemiesFromMinion(minion, enemies);
    const target = projectedEnemies[0] ?? null;
    if (!target) continue;

    const strikeOptions = minionAttackOptions(actor, minionContext(context, minion, projectedEnemies));
    const strikes = strikeOptions.filter((strike) => strike.available !== false);
    const strike = bestStrike(strikes.length ? strikes : strikeOptions);
    const actionOptions = minionActionOptions(strikes.length ? strikes : strikeOptions);

    const distance = numeric(target.distance, Infinity);
    const steps = strike
      ? minionSteps({ actionBudget, distance, range: strikeRange(strike), speed: actorSpeed(actor), strikeName: strike.name })
      : minionBasicSteps(actionBudget);
    const label = t("MinionPlan.Label", "{minion}: {steps} vs {target}", {
      minion: minion.name ?? actor.name,
      steps: steps.join(" -> "),
      target: target.name ?? t("MinionPlan.Target", "target"),
    });

    return {
      minionId: minion.id ?? minion.token?.id ?? actor.id ?? null,
      minionName: minion.name ?? actor.name,
      targetId: target.id ?? target.token?.id ?? null,
      targetName: target.name ?? "",
      actionBudget,
      steps,
      actionOptions,
      movementOptions: actorMovementOptions(actor),
      label,
      scoreDelta: minionScoreDelta(steps, strike?.name ?? null),
      reasons: [label],
    };
  }

  return null;
}
