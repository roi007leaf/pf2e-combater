import { slugify } from "./text.js";
import { readActionResource } from "../../rules/action-resources.js";

const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const AREA_SHAPES = new Set(["burst", "cone", "cube", "cylinder", "emanation", "line", "ring", "square"]);
const AREA_REGION_TYPES = new Set(["circle", "cone", "emanation", "line", "rectangle", "ring"]);
const DESTINATION_ACTION_SLUGS = new Set(["crawl", "stride", "step", "stand-stride"]);
const NO_TARGET_ACTION_SLUGS = new Set(["stand", "retch", "drop-prone", "stride", "step", "crawl", "stand-stride"]);
const GENERIC_ATTACK_SLUGS = new Set(["trip", "grapple", "disarm", "shove", "reposition"]);
const BASIC_MOVE_SLUGS = new Set(["crawl", "step", "stride"]);
const SKILL_ACTION_SLUGS = new Set([
  "demoralize",
  "recall-knowledge",
  "create-a-diversion",
  "feint",
  "trip",
  "grapple",
  "disarm",
  "shove",
  "reposition",
  "tumble-through",
  "seek",
  "sense-motive",
]);
const SUPPORT_ROLES = new Set(["healing", "defense", "buff", "stealth-defense", "self-healing"]);
const OFFENSIVE_ROLES = new Set(["damage", "area-damage", "save-damage", "control", "debuff", "grab", "mobility-attack", "multiattack"]);
function values(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return value === undefined || value === null ? [] : [value];
}

function normalizedValues(...sources) {
  return [...new Set(sources.flatMap(values).map((value) => slugify(value?.slug ?? value?.name ?? value)).filter(Boolean))];
}

function numberOrNull(...valuesToRead) {
  for (const value of valuesToRead) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function frozenArray(value) {
  return Object.freeze([...value]);
}

function frozenGroups(groups) {
  return Object.freeze(groups.map((group) => frozenArray(group)));
}

function rawActivity(candidate) {
  return candidate?.activityProfile ?? candidate?.action?.activityProfile ?? {};
}

function rawTargeting(candidate) {
  return candidate?.targetingProfile ?? candidate?.action?.targetingProfile ?? {};
}

function rawSave(candidate) {
  return candidate?.saveProfile ?? candidate?.action?.saveProfile ?? {};
}

function actionItem(candidate) {
  return candidate?.item ?? candidate?.strike?.item ?? candidate?.generatedAction?.item ?? candidate?.action?.item ?? null;
}

function actionSlug(candidate) {
  return slugify(candidate?.slug ?? candidate?.action?.slug ?? candidate?.actionKey);
}

function activityIncludes(activity) {
  return normalizedValues(activity?.includes);
}

function actionTraits(candidate, item) {
  return normalizedValues(
    candidate?.traits,
    candidate?.weaponTraits,
    candidate?.range?.traits,
    item?.system?.traits?.value,
  );
}

function conditionRequirementGroups(activity) {
  const any = normalizedValues(activity?.requiresAnyTargetCondition);
  if (any.length) return [any];
  return normalizedValues(activity?.requiresTargetCondition).map((condition) => [condition]);
}

function appliedConditions(candidate, activity, slug) {
  const conditions = normalizedValues(
    activity?.appliesCondition,
    activity?.appliesConditions,
    activity?.appliedCondition,
    activity?.conditions,
    candidate?.appliesConditions,
  );
  if ((activity?.includesGrab === true || slug === "grapple") && !conditions.includes("grabbed")) {
    conditions.push("grabbed");
  }
  return conditions;
}

function previousRequirements(candidate, activity) {
  const gating = candidate?.gatingProfile ?? candidate?.action?.gatingProfile ?? {};
  const eventTriggers = normalizedValues(gating?.eventTriggers);
  const explicit = normalizedValues(
    activity?.previousActionRequirements,
    gating?.previousActionRequirements,
  );
  if (activity?.requiresPreviousStrike === true || gating?.requiresPreviousStrike === true) {
    if (!explicit.includes("after-strike")) explicit.push("after-strike");
  }
  if (explicit.length) return explicit;
  return eventTriggers.includes("previous-action") ? ["previous-action"] : [];
}

function explicitMaxRange(candidate, targeting) {
  return numberOrNull(candidate?.range?.max, targeting?.maxRange, targeting?.range, candidate?.range?.increment);
}

function actionCategory({ candidate, activity, role, slug, source, spell, strikeLike, skill }) {
  if (SUPPORT_ROLES.has(role)) return "support";
  if (strikeLike) return "strike";
  if (spell) return "spell";
  if (activity?.impulse === true) return "class";
  if (BASIC_MOVE_SLUGS.has(slug) || role === "mobility") return "movement";
  if (candidate?.item?.type === "consumable" || candidate?.type === "consumable" || Number(candidate?.interactDrawCost) > 0) {
    return "item";
  }
  if (skill || SKILL_ACTION_SLUGS.has(slug)) return "skill";
  if (["custom-curated", "system-inferred"].includes(source)) return "class";
  return "other";
}

function isFacts(value) {
  return value?.version === 2
    && value?.identity
    && value?.resolution
    && value?.targeting
    && value?.effects
    && value?.sequencing;
}

/** Normalize every reader/classifier candidate into stable tactical facts. */
export function normalizedActionFacts(candidate) {
  if (isFacts(candidate)) return candidate;

  const activity = rawActivity(candidate);
  const targeting = rawTargeting(candidate);
  const save = rawSave(candidate);
  const item = actionItem(candidate);
  const slug = actionSlug(candidate);
  const source = String(candidate?.source ?? candidate?.action?.source ?? "unknown").trim().toLowerCase();
  const classificationSource = String(candidate?.classificationSource ?? source).trim().toLowerCase();
  const role = String(candidate?.role ?? candidate?.action?.role ?? "").trim().toLowerCase();
  const utilitySubtype = String(activity?.utilitySubtype ?? "").trim().toLowerCase();
  const rawConfidence = String(candidate?.confidence ?? candidate?.action?.confidence ?? "").trim().toLowerCase();
  const confidence = CONFIDENCE_VALUES.has(rawConfidence) ? rawConfidence : "unknown";
  const combatUse = String(candidate?.combatUse ?? activity?.combatUse ?? "auto").trim().toLowerCase();
  const allowLowConfidenceAutoFill = candidate?.allowLowConfidenceAutoFill === true
    || activity?.allowLowConfidenceAutoFill === true;
  const confidenceAllowsAutoFill = confidence !== "low" || allowLowConfidenceAutoFill;
  const includes = activityIncludes(activity);
  const traits = actionTraits(candidate, item);
  if (activity?.incapacitation === true && !traits.includes("incapacitation")) traits.push("incapacitation");

  const strike = source === "strike";
  const includesStrike = activity?.includesStrike === true || includes.includes("strike");
  const drawsWeapon = activity?.drawsWeapon === true;
  const strikeLike = strike || includesStrike || drawsWeapon;
  const spell = source.startsWith("spell") || activity?.spell === true || item?.type === "spell";
  const cantrip = candidate?.isCantrip === true || activity?.cantrip === true || traits.includes("cantrip");
  const rank = numberOrNull(candidate?.castRank, candidate?.rank, candidate?.spellRank, item?.rank, item?.system?.level?.value);
  const nonCantripSpell = spell && !cantrip && (candidate?.isCantrip === false || (rank !== null && rank > 0));
  const skill = slugify(candidate?.skill ?? candidate?.statistic ?? candidate?.action?.skill);
  const saveStat = slugify(save?.stat ?? save?.statistic);
  const targetDefense = slugify(candidate?.targetSave ?? candidate?.targetDefense ?? candidate?.action?.targetSave);
  const attackTrait = candidate?.attackTrait === true || candidate?.attack === true || traits.includes("attack");
  const attack = strike || includesStrike || attackTrait || GENERIC_ATTACK_SLUGS.has(slug);
  const makesAttackRoll = strike || candidate?.attackTrait === true || includesStrike
    || activity?.spellAttack === true || traits.includes("attack");
  const offensive = OFFENSIVE_ROLES.has(role);
  const criticalFailureRisk = String(candidate?.criticalFailureRisk ?? activity?.criticalFailureRisk ?? "none")
    .trim().toLowerCase();
  const rollType = saveStat ? "save" : skill ? "check" : makesAttackRoll ? "attack" : "automatic";

  const areaType = slugify(targeting?.type ?? targeting?.shape ?? candidate?.area?.type);
  const area = targeting?.area === true
    || AREA_SHAPES.has(areaType)
    || AREA_REGION_TYPES.has(areaType)
    || includes.includes("area")
    || role.includes("area");
  const selfCentered = areaType === "emanation"
    && (targeting?.selfCentered === true || targeting?.maxRange === undefined);
  const targetCentered = targeting?.centerOnTarget === true;
  const teleport = activity?.teleport === true;
  const movesToStrike = includesStrike
    && (Number(activity?.strideCount) > 0 || includes.includes("stride") || includes.includes("step"));
  const requiresDestination = !includesStrike && (
    candidate?.requiresDestination === true
    || teleport
    || DESTINATION_ACTION_SLUGS.has(slug)
    || source === "movement"
    || role === "movement"
    || includes.includes("stride")
    || includes.includes("step")
    || Number(activity?.strideCount) > 0
  );
  const selfOnly = targeting?.self === true && targeting?.enemy !== true && targeting?.ally !== true;
  const suggested = candidate?.preferredTarget ?? candidate?.suggestedTarget ?? null;
  const hasExternalTarget = Boolean(suggested) && suggested?.type !== "self";
  const recallKnowledge = slug === "recall-knowledge"
    || String(candidate?.name ?? candidate?.action?.name ?? "").trim().toLowerCase() === "recall knowledge";
  const requiresTarget = area && !targetCentered
    ? false
    : NO_TARGET_ACTION_SLUGS.has(slug) || selfOnly
      ? false
      : recallKnowledge || candidate?.requiresTarget === true
        ? true
        : movesToStrike || (candidate?.requiresDestination === true && activity?.setsUpFlank === true)
          ? false
          : strike
            || candidate?.executable === "strike"
            || candidate?.attackTrait === true
            || hasExternalTarget
            || targeting?.enemy === true
            || targeting?.ally === true
            || targeting?.reach === true
            || targeting?.maxTargets !== undefined
            || targeting?.maxRange !== undefined
            || candidate?.requiresEnemyInReach === true;
  const requiresTargetableEnemy = !area && (
    strike
    || attack
    || offensive
    || targeting?.enemy === true
    || candidate?.requiresTarget === true
    || candidate?.requiresEnemyInReach === true
    || candidate?.requiresNearbyEnemy === true
    || candidate?.requiresTumbleThroughOpportunity === true
    || Boolean(candidate?.targetSave)
    || Boolean(candidate?.targetDefense)
  );

  const conditions = appliedConditions(candidate, activity, slug);
  const requiredTargetConditions = conditionRequirementGroups(activity);
  const priorRequirements = previousRequirements(candidate, activity);
  const grabRider = activity?.npcFamily === "grab-rider"
    || (activity?.includesGrab === true && priorRequirements.some((value) => ["strike", "after-strike"].includes(value)));
  const rawDamageAverage = numberOrNull(candidate?.damageProfile?.average, activity?.averageDamage, candidate?.averageDamage);
  const damageAverage = rawDamageAverage !== null && rawDamageAverage > 0
    ? rawDamageAverage * (activity?.damageScalesWithActions ? Math.max(1, numberOrNull(candidate?.actionCost) ?? 1) : 1)
    : null;
  const damageTypes = normalizedValues(
    candidate?.damageProfile?.types,
    candidate?.damageProfile?.type,
    activity?.damageTypes,
  );
  const appliedConditionsFrozen = frozenArray(conditions);
  const requiredTargetConditionsFrozen = frozenGroups(requiredTargetConditions);
  const previousRequirementsFrozen = frozenArray(priorRequirements);
  const traitsFrozen = frozenArray(traits);
  const includesFrozen = frozenArray(includes);
  const damageTypesFrozen = frozenArray(damageTypes);
  const removedConditionsFrozen = frozenArray(normalizedValues(activity?.removesCondition, activity?.removesConditions));
  const setupForFrozen = frozenArray(normalizedValues(candidate?.setupFor, activity?.setupFor));
  const actionCost = numberOrNull(candidate?.actionCost, candidate?.cost);
  const rawResource = readActionResource(candidate);
  const resource = rawResource ? Object.freeze({
    kind: String(rawResource.kind ?? "unknown").toLowerCase(),
    poolKey: rawResource.poolKey === null || rawResource.poolKey === undefined
      ? null
      : String(rawResource.poolKey),
    remaining: numberOrNull(rawResource.remaining),
    max: numberOrNull(rawResource.max),
    rank: numberOrNull(rawResource.rank),
  }) : null;
  const maxRange = explicitMaxRange(candidate, targeting);
  const rangeIncrement = numberOrNull(candidate?.range?.increment, item?.system?.range?.increment);
  const category = actionCategory({ candidate, activity, role, slug, source, spell, strikeLike, skill });

  return Object.freeze({
    version: 2,
    confidence,
    source: classificationSource,
    combatUse,
    role,
    utilitySubtype,
    allowLowConfidenceAutoFill,
    category,
    identity: Object.freeze({
      id: String(candidate?.id ?? candidate?._id ?? ""),
      slug,
      source,
      classificationSource,
    }),
    traits: traitsFrozen,
    activityIncludes: includesFrozen,
    automation: Object.freeze({
      combatUse,
      confidence,
      confidenceAllowsAutoFill,
      allowLowConfidenceAutoFill,
      executable: String(candidate?.executable ?? ""),
    }),
    economy: Object.freeze({
      actionCost,
      attack: makesAttackRoll,
      mapIncreases: makesAttackRoll,
      mapIndex: numberOrNull(candidate?.attackIndex, candidate?.mapIndex),
      criticalFailureRisk,
      resource,
    }),
    resolution: Object.freeze({
      type: rollType,
      strike,
      strikeLike,
      includesStrike,
      drawsWeapon,
      spell,
      cantrip,
      nonCantripSpell,
      rank,
      skill: skill || null,
      saveStat: saveStat || null,
      targetDefense: targetDefense || null,
      basicSave: save?.basic === true,
      attack,
      attackLike: attack || offensive,
      makesAttackRoll,
      offensive,
      criticalFailureRisk,
    }),
    targeting: Object.freeze({
      self: targeting?.self === true,
      enemy: targeting?.enemy === true,
      ally: targeting?.ally === true,
      reach: targeting?.reach === true,
      area,
      areaType: areaType || null,
      selfCentered,
      targetCentered,
      maxRange,
      rangeIncrement,
      maxTargets: numberOrNull(targeting?.maxTargets),
      requiresAreaMarker: area,
      requiresDestination,
      requiresTarget,
      requiresTargetableEnemy,
      requiresLiving: targeting?.requiresLiving === true,
      requiresAnyTrait: frozenArray(normalizedValues(targeting?.requiresAnyTrait)),
      requiresAllTraits: frozenArray(normalizedValues(targeting?.requiresAllTraits)),
    }),
    effects: Object.freeze({
      damage: damageAverage !== null || damageTypes.length > 0 || ["damage", "area-damage", "save-damage"].includes(role),
      damageAverage,
      damageTypes: damageTypesFrozen,
      healing: ["healing", "self-healing"].includes(role),
      defense: ["defense", "stealth-defense"].includes(role),
      support: SUPPORT_ROLES.has(role),
      appliedConditions: appliedConditionsFrozen,
      removedConditions: removedConditionsFrozen,
      requiredTargetConditions: requiredTargetConditionsFrozen,
      setupFor: setupForFrozen,
      duration: String(activity?.duration ?? "").trim() || null,
      lastingDuration: activity?.lastingDuration === true,
      sustained: activity?.sustained === true,
      movement: requiresDestination || Number(activity?.strideCount) > 0 || includes.includes("move"),
      teleport,
    }),
    sequencing: Object.freeze({
      previousActionRequirements: previousRequirementsFrozen,
      requiresPreviousAction: priorRequirements.length > 0,
      grabRider,
    }),
  });
}

export function actionConfidenceAllowsAutoFill(candidate) {
  return normalizedActionFacts(candidate).automation.confidenceAllowsAutoFill;
}
