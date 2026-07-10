import { t } from "../../i18n.js";
import {
  canUseIntelCategory,
  canUseIntelFact,
  intelDefenseFactId,
  intelSaveBand,
  isNpcIntelTarget,
} from "../../rules/intel-ledger.js";
import { distanceFromCenterToEntity, entityThreatReach } from "../../rules/battlefield-analysis.js";
import { canvasPoint } from "../../rules/canvas-geometry.js";
import { detectionState } from "../target-pool.js";
import {
  canUseTargetSave,
  damageTypes,
  targetActorDocument,
  targetDc,
  titleCase,
} from "./facts.js";

function isGM(context) {
  return context?.isGM === true || globalThis.game?.user?.isGM === true;
}

function actionSource(step, action = null) {
  return action ?? step?.action ?? step;
}

function warningTarget(step, action = null) {
  const source = actionSource(step, action);
  return step?.suggestedTarget
    ?? step?.preferredTarget
    ?? step?.target
    ?? source?.suggestedTarget
    ?? source?.preferredTarget
    ?? source?.target
    ?? null;
}

function defenseEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return Array.from(value.values());
  if (typeof value === "object") return Object.values(value);
  return [];
}

function actorDefenseEntries(target, category) {
  const actor = targetActorDocument(target);
  return defenseEntries(
    actor?.system?.attributes?.[category]
      ?? actor?.system?.[category],
  );
}

function targetDefenseEntries(target, category) {
  return [
    ...defenseEntries(target?.[category]),
    ...actorDefenseEntries(target, category),
  ];
}

function entryType(entry) {
  return String(
    entry?.type?.value
      ?? entry?.type
      ?? entry?.slug?.value
      ?? entry?.slug
      ?? entry?.label
      ?? entry?.name
      ?? "",
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function entryValue(entry) {
  const number = Number(entry?.value ?? entry?.amount ?? entry?.total ?? entry?.modifier);
  return Number.isFinite(number) ? number : 0;
}

function matchesDamageType(entry, type) {
  const defenseType = entryType(entry);
  if (!defenseType || !type) return false;
  if (defenseType === "all" || defenseType === type) return true;
  if (defenseType === "physical" && ["bludgeoning", "piercing", "slashing"].includes(type)) return true;
  return false;
}

function isSanitizedIntelTarget(target) {
  const actor = targetActorDocument(target);
  return target?.intelLedger !== undefined && !actor?.system && !actor?.flags && typeof actor?.getFlag !== "function";
}

function visibleDefenseEntries(context, target, category, { showValue = true } = {}) {
  const entries = targetDefenseEntries(target, category);
  if (!entries.length) return [];
  if (isGM(context) || !isNpcIntelTarget(target)) return entries;
  if (!canUseIntelCategory(context, target, category)) return [];
  if (isSanitizedIntelTarget(target)) return entries;
  return entries.filter((entry) =>
    canUseIntelFact(context, target, category, intelDefenseFactId(entry, { showValue })));
}

function matchingEntries(entries, types, { requireValue = false } = {}) {
  if (!types.length) return [];
  return entries.filter((entry) =>
    (!requireValue || entryValue(entry) > 0)
    && types.some((type) => matchesDamageType(entry, type)));
}

function damageWarnings(context, source, target) {
  const types = damageTypes(source);
  if (!target || !types.length) return [];

  const immunities = matchingEntries(
    visibleDefenseEntries(context, target, "immunities", { showValue: false }),
    types,
  );
  if (immunities.length) {
    return [t("Warning.KnownImmunityBlocks", "Known immunity blocks this.")];
  }

  const resistances = matchingEntries(
    visibleDefenseEntries(context, target, "resistances"),
    types,
    { requireValue: true },
  );
  return resistances.length
    ? [t("Warning.KnownResistanceReduces", "Known resistance reduces this.")]
    : [];
}

function canReadSave(context, target, saveSlug) {
  if (!target || !saveSlug) return false;
  if (isGM(context)) return true;
  if (canUseTargetSave(context, target, saveSlug)) return true;
  const hasSanitizedBand = saveSlug === "perception"
    ? Boolean(target?.intelPerceptionBand)
    : Boolean(target?.intelSaveBands?.[saveSlug]);
  return isSanitizedIntelTarget(target) && hasSanitizedBand && Number.isFinite(Number(targetDc(target, saveSlug)));
}

function saveWarnings(context, source, target) {
  const stat = String(source?.saveProfile?.stat ?? source?.targetSave ?? "").toLowerCase();
  if (!stat || !canReadSave(context, target, stat)) return [];
  const dc = targetDc(target, stat);
  if (!Number.isFinite(Number(dc))) return [];
  const band = stat === "perception"
    ? target?.intelPerceptionBand
    : target?.intelSaveBands?.[stat];
  const knownBand = band?.id ? band : intelSaveBand(dc, target);
  return knownBand?.id === "high"
    ? [t("Warning.SaveLooksHigh", "{save} looks High.", { save: titleCase(stat) })]
    : [];
}

function conditionSlugs(target) {
  const conditions = target?.conditions;
  if (!conditions) return [];
  if (Array.isArray(conditions)) return conditions.map((condition) => condition?.slug ?? condition).filter(Boolean);
  return Array.isArray(conditions.slugs) ? conditions.slugs : [];
}

function targetHiddenWarning(source, target) {
  if (!target) return [];
  const state = detectionState(target);
  const isAttackLike = source?.source === "strike"
    || source?.attackTrait === true
    || source?.activityProfile?.includesStrike === true
    || source?.targetingProfile?.enemy === true
    || Boolean(source?.saveProfile?.stat);
  const hidden = target?.hidden === true
    || target?.token?.hidden === true
    || target?.token?.document?.hidden === true
    || state === "hidden"
    || conditionSlugs(target).includes("hidden");
  return hidden && isAttackLike
    ? [t("Warning.TargetHidden", "Target hidden.")]
    : [];
}

function stepDestination(step, source) {
  return canvasPoint(
    step?.destination
      ?? step?.movementPlan?.destination
      ?? step?.activityProfile?.attackCenter
      ?? source?.destination
      ?? source?.movementPlan?.destination
      ?? source?.activityProfile?.attackCenter,
  );
}

function stepOrigin(context) {
  return canvasPoint(context?.token?.center ?? context?.combatant?.token?.center);
}

function routePoints(context, step, source) {
  const origin = stepOrigin(context);
  const destination = stepDestination(step, source);
  const route = [
    ...(Array.isArray(step?.movementPlan?.route) ? step.movementPlan.route : []),
    ...(Array.isArray(step?.route) ? step.route : []),
    ...(Array.isArray(step?.stridePath) ? step.stridePath.flatMap((entry) => entry?.trail ?? entry?.center ?? []) : []),
  ].map((point) => canvasPoint(point?.center ?? point)).filter(Boolean);
  return [origin, ...route, destination].filter(Boolean);
}

function actorActions(entity) {
  const actor = targetActorDocument(entity);
  return [
    ...(Array.isArray(entity?.actions) ? entity.actions : []),
    ...(Array.isArray(entity?.abilities) ? entity.abilities : []),
    ...(Array.isArray(actor?.items) ? actor.items : []),
    ...(Array.isArray(actor?.itemTypes?.action) ? actor.itemTypes.action : []),
  ].filter(Boolean);
}

function hasReactiveStrike(entity) {
  if (entity?.reactiveStrike === true || entity?.hasReactiveStrike === true) return true;
  return actorActions(entity).some((action) => {
    const name = String(action?.name ?? action?.label ?? action?.slug ?? "").toLowerCase();
    const role = String(action?.role ?? action?.activityProfile?.role ?? "").toLowerCase();
    return role === "reaction-attack"
      || name.includes("reactive strike")
      || name.includes("attack of opportunity")
      || name === "reactive-strike";
  });
}

function reactiveStrikeKnown(context, entity) {
  if (isGM(context)) return hasReactiveStrike(entity);
  return entity?.reactiveStrikeKnown === true
    || entity?.knownReactiveStrike === true
    || entity?.revealedReactiveStrike === true;
}

function movingActionMayProvoke(source) {
  const slug = String(source?.slug ?? source?.action?.slug ?? "").toLowerCase();
  if (slug === "step" || slug === "crawl") return false;
  return source?.requiresDestination === true
    || Boolean(source?.destination)
    || Boolean(source?.activityProfile?.attackCenter)
    || Number(source?.activityProfile?.strideCount) > 0
    || ["stride", "fly", "swim", "climb", "burrow"].includes(slug);
}

function destinationMayProvokeWarnings(context, step, source) {
  if (!movingActionMayProvoke(source)) return [];
  const points = routePoints(context, step, source);
  if (points.length < 2) return [];
  const reactiveEnemies = [
    ...(Array.isArray(context?.battlefield?.enemies) ? context.battlefield.enemies : []),
    ...(Array.isArray(context?.enemies) ? context.enemies : []),
  ].filter((enemy) => reactiveStrikeKnown(context, enemy));
  if (!reactiveEnemies.length) return [];

  const danger = points.some((point) => reactiveEnemies.some((enemy) =>
    distanceFromCenterToEntity(context, point, enemy) <= entityThreatReach(enemy)));
  return danger ? [t("Warning.DestinationMayProvoke", "Destination may provoke.")] : [];
}

export function rkWarningsForStep(context, step, action = null) {
  const source = actionSource(step, action);
  const target = warningTarget(step, source);
  const warnings = [
    ...damageWarnings(context, source, target),
    ...saveWarnings(context, source, target),
    ...targetHiddenWarning(source, target),
    ...destinationMayProvokeWarnings(context, step, source),
  ];
  return [...new Set(warnings.filter(Boolean))];
}

export function rkWarningLabel(warnings) {
  const values = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
  return values.slice(0, 3).join(" ");
}
