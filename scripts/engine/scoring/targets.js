import { hasDemoralizeImmunity } from "../../rules/demoralize-immunity.js";
import { battlefieldPressure } from "../../rules/battlefield-analysis.js";
import { aggroTargetValue } from "../../rules/aggro.js";
import { targetHasMarkState } from "../../rules/combat-state.js";
import { hasExploitVulnerabilityMark, isExploitVulnerabilityAction } from "../../rules/exploit-vulnerability.js";
import { actorItems, entityKey } from "../../foundry-data.js";
import { isSelfCenteredAreaAction } from "../action/requirements.js";
import { slugify as slugText } from "../action/text.js";
import {
  actionTraitSlugs,
  canUseTargetDefenses,
  contextActorDocument,
  damageAdjustment,
  damageTypes,
  hasCondition,
  hpPercent,
  inRange,
  isOffensiveRole,
  maxRange,
  requiresTargetableEnemy,
  targetDc,
  targetHasMatchingDefense,
  targetTraitSlugs,
} from "./facts.js";
import { canAttackTarget, contextEnemies, firstContextTarget } from "../target-pool.js";

const KINETICIST_ELEMENT_SLUGS = new Set(["air", "earth", "fire", "metal", "water", "wood"]);
const ELEMENT_DAMAGE_FALLBACKS = {
  air: ["electricity"],
  earth: ["bludgeoning"],
  fire: ["fire"],
  metal: ["piercing", "slashing"],
  water: ["cold"],
  wood: ["vitality"],
};

function itemSlug(item) {
  return slugText(item?.slug ?? item?.system?.slug?.value ?? item?.system?.slug ?? item?.name);
}

function elementalBlastItem(actor) {
  return actorItems(actor, "action")
    .find((item) => itemSlug(item) === "elemental-blast")
    ?? null;
}

function kineticistElementProfiles(context, action) {
  const actor = contextActorDocument(context);
  const item = elementalBlastItem(actor);
  const selections = item?.flags?.pf2e?.damageSelections ?? {};
  const flag = actor?.flags?.pf2e?.kineticist?.elementalBlast;
  const profiles = new Map();

  const addProfile = (rawElement, rawTypes = []) => {
    const element = slugText(rawElement);
    if (!KINETICIST_ELEMENT_SLUGS.has(element)) return;

    const selected = selections?.[rawElement] ?? selections?.[element];
    const damageTypeValues = [
      selected,
      ...(Array.isArray(rawTypes) ? rawTypes : [rawTypes]),
      ...(ELEMENT_DAMAGE_FALLBACKS[element] ?? []),
    ];
    const damageTypesForElement = [...new Set(damageTypeValues.map(slugText).filter(Boolean))];
    const existing = profiles.get(element) ?? { element, damageTypes: [] };
    profiles.set(element, {
      element,
      damageTypes: [...new Set([...existing.damageTypes, ...damageTypesForElement])],
    });
  };

  if (flag && typeof flag === "object") {
    for (const entry of Object.values(flag)) {
      if (!entry || typeof entry !== "object" || !entry.element) continue;
      addProfile(entry.element, [
        entry.damageType,
        ...(Array.isArray(entry.damageTypes) ? entry.damageTypes : []),
      ]);
    }
  }

  if (action?.elementalBlastConfig?.element) {
    addProfile(action.elementalBlastConfig.element, [
      action.elementalBlastConfig.damageType,
      ...(Array.isArray(action.elementalBlastConfig.damageTypes) ? action.elementalBlastConfig.damageTypes : []),
      ...damageTypes(action),
    ]);
  }

  for (const trait of actionTraitSlugs(action)) {
    if (KINETICIST_ELEMENT_SLUGS.has(trait)) addProfile(trait, damageTypes(action));
  }

  return Array.from(profiles.values());
}

function offensiveTargetValue(context, action, role, target) {
  if (!target) return -Infinity;
  if ((action?.targetingProfile?.maxRange || action?.range?.max || action?.range?.increment) && !inRange(action, target)) {
    return -Infinity;
  }

  const pressure = battlefieldPressure(context);
  let value = 0;
  if (pressure.meleeThreatKeys.has(entityKey(target))) value += 14;
  if (role === "grab" || action?.targetingProfile?.reach) {
    if (!inRange(action, target)) value -= 20;
  }
  if (action?.saveProfile?.stat && canUseTargetDefenses(context)) {
    const dc = targetDc(target, action.saveProfile.stat);
    if (Number.isFinite(dc)) value += 30 - dc;
  }

  const appliedConditions = [
    action?.activityProfile?.appliesCondition,
    ...(Array.isArray(action?.activityProfile?.appliesConditions) ? action.activityProfile.appliesConditions : []),
  ].filter(Boolean);
  if (appliedConditions.some((condition) => hasCondition(target, condition))) value -= 12;

  const adjustment = damageAdjustment(context, action, target);
  if (adjustment) value += adjustment.scoreDelta;
  value += aggroTargetValue(context, action, role, target);
  value += (1 - hpPercent(target)) * 4;
  return value;
}

function canAffectTarget(context, action, target) {
  if (action?.slug === "demoralize" && hasDemoralizeImmunity(target)) return false;
  if (isExtractElementAction(action) && !canExtractElementFromTarget(context, action, target)) return false;
  if (isExploitVulnerabilityAction(action) && hasExploitVulnerabilityMark(target)) return false;
  const mark = action?.activityProfile?.targetMark;
  if (mark && targetHasMarkState(target, mark)) return false;
  return true;
}

function targetPoolForAction(context, action, role, needsTargetableEnemy) {
  const values = needsTargetableEnemy
    ? attackableEnemies(context)
    : contextEnemies(context);
  return values.filter((target) => canAffectTarget(context, action, target));
}

export function bestTargetForAction(context, action, role) {
  const needsTargetableEnemy = requiresTargetableEnemy(action, role);
  if (isSelfCenteredAreaAction(action)) return null;

  if (
    action?.preferredTarget
    && (!needsTargetableEnemy || canAttackTarget(action.preferredTarget))
    && canAffectTarget(context, action, action.preferredTarget)
  ) {
    return action.preferredTarget;
  }

  const target = firstContextTarget(context);
  const enemyValues = targetPoolForAction(context, action, role, needsTargetableEnemy);

  if (action.source === "strike") {
    const reachable = enemyValues.filter((enemy) => inRange(action, enemy));
    if (reachable.length) {
      return reachable.toSorted((left, right) =>
        offensiveTargetValue(context, action, role, right) - offensiveTargetValue(context, action, role, left),
      )[0];
    }
    return canAttackTarget(target) && canAffectTarget(context, action, target) ? target : null;
  }

  if (isOffensiveRole(role)) {
    const reachable = enemyValues.filter((enemy) => {
      const max = maxRange(action);
      return !Number.isFinite(max) || max === Infinity || (enemy?.distance ?? Infinity) <= max;
    });
    if (reachable.length) {
      return reachable.toSorted((left, right) =>
        offensiveTargetValue(context, action, role, right) - offensiveTargetValue(context, action, role, left),
      )[0];
    }
    return inRange(action, target) && canAttackTarget(target) && canAffectTarget(context, action, target) ? target : null;
  }

  if (needsTargetableEnemy) {
    const reachable = enemyValues.filter((enemy) => {
      const max = maxRange(action);
      return !Number.isFinite(max) || max === Infinity || (enemy?.distance ?? Infinity) <= max;
    });
    return reachable[0] ?? null;
  }

  if (["step", "stride"].includes(action.slug)) {
    return target ?? enemyValues[0] ?? null;
  }

  return target;
}

export function distinctTargetsFor(context, action, role) {
  const count = Number.isFinite(action.activityProfile?.distinctStrikeCount) ? action.activityProfile.distinctStrikeCount : 2;
  const max = maxRange(action);
  const reachable = attackableEnemies(context)
    .filter((enemy) => !Number.isFinite(max) || max === Infinity || (enemy?.distance ?? Infinity) <= max)
    .toSorted((left, right) => offensiveTargetValue(context, action, role, right) - offensiveTargetValue(context, action, role, left));

  if (!reachable.length) return [];

  const picked = [];
  for (let i = 0; i < count; i += 1) picked.push(reachable[i % reachable.length]);
  return picked;
}

export function attackableEnemies(context) {
  return contextEnemies(context).filter(canAttackTarget);
}

export function isExtractElementAction(action) {
  return [
    action?.slug,
    action?.tacticSlug,
    action?.name,
  ].map(slugText).includes("extract-element");
}

export function canExtractElementFromTarget(context, action, target) {
  if (!target) return false;

  const profiles = kineticistElementProfiles(context, action);
  if (!profiles.length) return false;

  const traits = targetTraitSlugs(context, target);
  if (profiles.some((profile) => traits.has(profile.element))) return true;

  const damageTypeSet = new Set(profiles.flatMap((profile) => profile.damageTypes));
  return targetHasMatchingDefense(context, target, Array.from(damageTypeSet));
}
