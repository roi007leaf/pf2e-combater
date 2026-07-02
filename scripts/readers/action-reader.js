import { findCustomAction } from "../catalog/custom-actions.js";
import { GENERIC_ACTIONS } from "../catalog/generic-actions.js";
import { classifySystemAction } from "../engine/action-classifier.js";
import { actionBudget } from "../engine/planner.js";
import {
  isSeekRelevantVisibility,
  isVisionerActive,
  readVisionerCoverState,
  readVisionerDetectionState,
} from "../integrations/visioner.js";
import { compareTacticalCenters } from "../rules/battlefield-analysis.js";
import { hasDemoralizeImmunity } from "../rules/demoralize-immunity.js";
import { triggerMatchesContext } from "../rules/event-context.js";
import { pf2eMovementSegmentCost } from "../rules/movement-cost.js";
import { pf2eActionName, pf2eCondition, t } from "../i18n.js";

const ACTION_ITEM_TYPES = new Set(["action", "feat", "feature", "consumable"]);
const ACTIVATABLE_ITEM_TYPES = new Set([
  ...ACTION_ITEM_TYPES,
  "ammo",
  "armor",
  "backpack",
  "book",
  "equipment",
  "weapon",
]);
const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
};
const ACTION_GLYPHS = {
  A: 1,
  D: 2,
  T: 3,
  F: 0,
  R: "reaction",
};
const MOVE_ACTION_SLUGS = new Set([
  "balance",
  "climb",
  "crawl",
  "high-jump",
  "long-jump",
  "sneak",
  "stand",
  "step",
  "stride",
  "swim",
  "tumble-through",
]);
const ESCAPE_CONDITIONS = new Set([
  "grabbed",
  "grappled",
  "immobilised",
  "immobilized",
  "restrained",
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
const MANUAL_ONLY_SKILL_ACTION_SLUGS = new Set([
  "balance",
  "borrow-an-arcane-spell",
  "coerce",
  "cover-tracks",
  "create-forgery",
  "craft",
  "decipher-writing",
  "follow-the-expert",
  "gather-information",
  "high-jump",
  "identify-alchemy",
  "identify-magic",
  "impersonate",
  "learn-a-spell",
  "lie",
  "long-jump",
  "make-an-impression",
  "perform",
  "repair",
  "sense-direction",
  "squeeze",
  "subsist",
  "track",
  "treat-disease",
  "treat-poison",
  "treat-wounds",
]);
const COMBAT_SIGNAL_ROLES = new Set([
  "area-damage",
  "buff",
  "control",
  "damage",
  "debuff",
  "defense",
  "grab",
  "healing",
  "mobility-attack",
  "multiattack",
  "reaction-attack",
  "reaction-defense",
  "self-healing",
  "setup",
  "stealth-defense",
  "summon",
]);
const COMBAT_SIGNAL_SLUGS = new Set([
  "administer-first-aid",
  "command-an-animal",
  "create-a-diversion",
  "demoralize",
  "disarm",
  "escape",
  "feint",
  "grapple",
  "hide",
  "raise-a-shield",
  "recall-knowledge",
  "reposition",
  "seek",
  "sense-motive",
  "shove",
  "sneak",
  "stabilize",
  "steal",
  "take-cover",
  "trip",
  "tumble-through",
]);

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

function normalizeActivationText(value) {
  return normalizeWhitespace(
    String(value ?? "")
      .replace(/&mdash;|&ndash;|â€”|â€“|[\u2013\u2014]/g, " — "),
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

function isGmContext(context) {
  return context?.isGM === true || globalThis.game?.user?.isGM === true;
}

function hideGenericActionForContext(action, context) {
  if (action.hideFromSuggestions) return true;
  return action.slug === "recall-knowledge"
    && action.playerFacing
    && isGmContext(context)
    && isNpcProfile(contextProfile(context));
}

function hasCombatRelevantSystemActionSignal(slug, traits, tactic) {
  const normalizedTraits = traits.map((trait) => slugify(trait));
  if (COMBAT_SIGNAL_SLUGS.has(slug)) return true;
  if (normalizedTraits.includes("attack")) return true;
  if (COMBAT_SIGNAL_ROLES.has(tactic?.role)) return true;

  const activity = tactic?.activityProfile ?? {};
  const targeting = tactic?.targetingProfile ?? {};
  return Boolean(
    targeting.enemy
    || tactic?.saveProfile
    || tactic?.damageProfile
    || activity.appliesCondition
    || activity.removesCondition
    || activity.reducesCondition
    || activity.requiresTargetCondition
    || activity.averageDamage
    || activity.healing
    || activity.includesStrike
    || activity.extraAction
    || activity.shieldBlock
  );
}

function hideNonCombatSystemAction(slug, traits, tactic) {
  const normalizedTraits = traits.map((trait) => slugify(trait));
  if (MANUAL_ONLY_SKILL_ACTION_SLUGS.has(slug)) return true;
  if (!normalizedTraits.includes("exploration")) return false;
  return !hasCombatRelevantSystemActionSignal(slug, normalizedTraits, tactic);
}

function contextTargets(context) {
  return context?.targets ?? context?.battlefield?.targets ?? [];
}

function contextEnemies(context) {
  return context?.enemies ?? context?.battlefield?.enemies ?? contextTargets(context);
}

export function hasEnemyWithinRange(context, maxRange) {
  if (!Number.isFinite(maxRange)) return true;
  const pool = [...contextTargets(context), ...contextEnemies(context)];
  return pool.some((target) => (target?.distance ?? Infinity) <= maxRange);
}

function contextAllies(context) {
  return context?.allies ?? context?.battlefield?.allies ?? [];
}

export function readActionSources(context, spells = []) {
  // Per-build memos (reachable squares) are keyed by positions fixed for this build; clear them so a
  // moved token starts fresh. The wall-collision cache persists ACROSS builds and is invalidated only
  // when the scene/walls change.
  reachableCentersCache.clear();
  reachableAttackCentersCache.clear();
  syncCollisionCacheForScene();
  const actor = contextActor(context);
  const generatedStrikes = readGeneratedStrikes(actor, context);
  return [
    ...readGenericActions(context),
    ...readStandStrideActivities(context),
    ...generatedStrikes,
    ...readElementalBlastActions(actor, context),
    ...readDrawStrikeActivities(actor, context, generatedStrikes),
    ...readDrawWeaponActions(actor),
    ...readSheatheWeaponActions(actor),
    ...readReleaseWeaponActions(actor),
    ...readReloadWeaponActions(actor),
    ...readDropProneAction(actor, context),
    ...readStrideStrikeActivities(context, generatedStrikes),
    ...readRangedRetreatStrikeActivities(context, generatedStrikes),
    ...readSkirmishStrikeActivities(context, generatedStrikes),
    ...readPositionalTacticActivities(context, generatedStrikes, spells),
    ...readGeneratedActivities(actor, context),
    ...readShieldSpellBlockActions(actor, context),
    ...readActorItemActions(actor, context),
  ];
}

function readGenericActions(context) {
  return GENERIC_ACTIONS.filter((action) => !hideGenericActionForContext(action, context)).map((action) => {
    const itemAvailability = isGenericAvailable(action, context);
    const profile = contextProfile(context);
    const proneCover = action.slug === "take-cover"
      && hasCondition(profile, "prone")
      && !hasAdjacentCover(context, profile);
    return {
      ...action,
      name: pf2eActionName(action.slug, action.name),
      source: "generic",
      confidence: "medium",
      detected: true,
      item: null,
      available: itemAvailability.available,
      unavailableReason: itemAvailability.reason,
      activityProfile: {
        ...(action.activityProfile ?? {}),
        ...(proneCover ? { requiresProneCover: true } : {}),
      },
    };
  });
}

function canStandBeforeMovement(profile) {
  return movementBlockingCondition(profile, { slug: "stride" }) === "prone"
    && !movementBlockingCondition(profile, { slug: "stand", traits: ["move"] });
}

function readStandStrideActivities(context) {
  const profile = contextProfile(context);
  if (!canStandBeforeMovement(profile)) return [];

  const reach = meleeReach(profile);
  const target = [...contextTargets(context), ...contextEnemies(context)]
    .filter(canAttackTarget)
    .find((enemy) => (enemy?.distance ?? Infinity) > reach);
  if (!target) return [];

  return [{
    id: "stand-stride",
    name: t("Action.StandStride", "Stand -> Stride"),
    slug: "stand-stride",
    actionCost: 2,
    actionType: "action",
    source: "generic",
    confidence: "medium",
    executable: "chat-guidance",
    detected: true,
    available: true,
    item: null,
    preferredTarget: target,
    role: "mobility",
    activityProfile: {
      includes: ["stand", "stride"],
      removesCondition: "prone",
      strideCount: 1,
    },
    targetingProfile: {
      enemy: true,
      preferredTargetId: target.id ?? null,
      preferredTargetName: target.name ?? null,
    },
    setupFor: [],
    reasons: [t("Reason.StandThenStride", "Stand, then Stride toward {name}.", { name: target.name })],
  }];
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
function readStrikeDamageProfile(strike) {
  const item = strike?.item;
  const rolls = item?.system?.damageRolls;
  if (rolls && typeof rolls === "object") {
    const entries = [];
    for (const roll of Object.values(rolls)) {
      const average = diceAverage(roll?.damage ?? roll?.formula);
      const type = String(roll?.damageType ?? roll?.type ?? "").toLowerCase() || null;
      if (average !== null || type) {
        entries.push({
          formula: roll?.damage ?? roll?.formula ?? null,
          type,
          average,
        });
      }
    }
    if (entries.length) {
      const average = entries
        .map((entry) => Number(entry.average))
        .filter((value) => Number.isFinite(value) && value > 0)
        .reduce((total, value) => total + value, 0);
      return {
        average: average > 0 ? average : entries[0].average,
        type: entries[0].type,
        types: [...new Set(entries.map((entry) => entry.type).filter(Boolean))],
        entries,
      };
    }
  }

  const damage = item?.system?.damage;
  const dieFaces = Number(String(damage?.die ?? "").replace(/\D/g, ""));
  const diceCount = Number(damage?.dice);
  if (Number.isFinite(dieFaces) && dieFaces > 0 && Number.isFinite(diceCount) && diceCount > 0) {
    const average = diceCount * ((dieFaces + 1) / 2) + (Number(damage?.modifier) || 0);
    const type = String(damage?.damageType ?? damage?.type ?? "").toLowerCase() || null;
    return {
      average,
      type,
      types: type ? [type] : [],
      entries: [{ formula: `${diceCount}d${dieFaces}${damage?.modifier ? `+${damage.modifier}` : ""}`, type, average }],
    };
  }

  const formulaAverage = diceAverage(strike?.damageFormula);
  if (formulaAverage !== null) {
    const type = String(strike?.damageType ?? strike?.damage?.damageType ?? "").toLowerCase() || null;
    return {
      average: formulaAverage,
      type,
      types: type ? [type] : [],
      entries: [{ formula: strike.damageFormula, type, average: formulaAverage }],
    };
  }

  return null;
}

function readStrikeAverageDamage(strike) {
  return readStrikeDamageProfile(strike)?.average ?? null;
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
      const reload = readStrikeReload(strike, traits);
      const damageProfile = readStrikeDamageProfile(strike);
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
        reload,
        detected: true,
        available: strikeAvailability.available,
        unavailableReason: strikeAvailability.reason,
        preferredTarget: strikeAvailability.target,
        strike,
        item: strike.item ?? null,
        variants: strike.variants ?? [],
        attack: strike.attack ?? strike.roll ?? null,
        damage: strike.damage ?? null,
        damageProfile,
        averageDamage: damageProfile?.average ?? readStrikeAverageDamage(strike),
        critical: strike.critical ?? null,
      };
    });
}

export function bestReadyStrike(actor, context) {
  const strikes = readGeneratedStrikes(actor, context);
  if (!strikes.length) return null;
  return strikes.toSorted((left, right) => (Number(right.averageDamage) || 0) - (Number(left.averageDamage) || 0))[0];
}

export function bestReadyStrikeAverageDamage(actor, context) {
  const averages = readGeneratedStrikes(actor, context)
    .map((strike) => Number(strike.averageDamage))
    .filter((value) => Number.isFinite(value) && value > 0);
  return averages.length ? Math.max(...averages) : null;
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
      const activityProfile = addItemTraitProfile(tactic?.activityProfile, traits);
      if (hideNonCombatSystemAction(slug, traits, tactic)) return [];
      const movementAvailability = readMovementAvailability(context, { slug, traits, activityProfile });
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
        activityProfile,
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

function parseReloadCost(value) {
  const raw = systemValue(value);
  if (raw === undefined || raw === null) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;

  const text = String(raw ?? "").toLowerCase().trim();
  if (!text || text === "-" || text === "none") return 0;

  const word = text.match(/\b(one|two|three|1|2|3)\b/)?.[1];
  if (!word) return null;
  return WORD_NUMBERS[word] ?? Number(word);
}

function readStrikeReload(strike, traits) {
  const item = strike?.item ?? {};
  const candidates = [
    strike?.reload,
    strike?.reloadValue,
    strike?.system?.reload,
    strike?.system?.reload?.value,
    item?.reload,
    item?.system?.reload,
    item?.system?.reload?.value,
  ];

  for (const candidate of candidates) {
    const parsed = parseReloadCost(candidate);
    if (parsed !== null) return parsed;
  }

  const traitReloads = traits
    .map((trait) => String(trait ?? "").toLowerCase())
    .map((trait) => trait.match(/^reload[-\s]?(\d+)$/)?.[1])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return traitReloads.length ? Math.max(...traitReloads) : 0;
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
    if (!canAttackTarget(target)) continue;
    const key = targetKey(target);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    targets.push(target);
  }
  return targets;
}

function detectionState(target) {
  return String(target?.visionerDetectionState ?? target?.detectionState ?? target?.visibility ?? "").toLowerCase();
}

function canAttackTarget(target) {
  if (target?.attackTargetable === false) return false;
  const state = detectionState(target);
  if (state === "undetected" || state === "unnoticed") return false;
  return !hasCondition(target, "undetected") && !hasCondition(target, "unnoticed");
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
  if (!targets.length) return availability(false, t("Avail.NoTargetInRange", "No target in range."));

  const target = targets.find((candidate) => canStrikeTargetFromCurrentPosition(context, action, candidate));
  if (target) return { ...availability(true, ""), target };

  return availability(false, t("Avail.AttackPathBlocked", "Attack path to target is blocked."));
}

function actorLevel(actor) {
  const value = Number(actor?.level ?? actor?.system?.details?.level?.value);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function elementalBlastItem(actor) {
  return collectionValues(actor?.itemTypes?.action)
    .find((item) => slugify(item?.slug ?? item?.system?.slug ?? item?.name) === "elemental-blast")
    ?? null;
}

function kineticistBlastFlag(actor) {
  const flag = actor?.flags?.pf2e?.kineticist?.elementalBlast;
  return flag && typeof flag === "object" ? flag : null;
}

function elementalBlastConfigs(actor) {
  const flag = kineticistBlastFlag(actor);
  if (!flag) return [];
  return Object.values(flag)
    .filter((entry) => entry && typeof entry === "object" && typeof entry.element === "string");
}

function selectedElementalDamageType(item, config, infusion) {
  const configured = item?.flags?.pf2e?.damageSelections?.[config.element];
  const values = [
    configured,
    ...(Array.isArray(infusion?.damageTypes) ? infusion.damageTypes : []),
    ...(Array.isArray(config.damageTypes) ? config.damageTypes : []),
  ].filter(Boolean);
  return String(values[0] ?? "untyped").toLowerCase();
}

function selectedElementalBlastActionCost(item) {
  const selected = Number(item?.flags?.pf2e?.rulesSelections?.actionCost);
  if (selected === 1 || selected === 2) return selected;

  const parsed = readActionCost(item);
  const value = Number(parsed.actionCost);
  return value === 2 ? 2 : 1;
}

function elementalBlastActionCosts(item) {
  const selected = selectedElementalBlastActionCost(item);
  return [selected, ...[1, 2].filter((cost) => cost !== selected)];
}

function elementalBlastAverage(actor, config, actionCost) {
  const dieFaces = Number(config?.dieFaces);
  if (!Number.isFinite(dieFaces) || dieFaces <= 0) return null;

  // Coarse ordering estimate only. PF2e still executes exact blast damage.
  const dice = Math.max(1, Math.ceil(actorLevel(actor) / 4));
  const actionBonus = actionCost >= 2 ? dice : 0;
  return dice * ((dieFaces + 1) / 2) + actionBonus;
}

function titleCaseWords(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function localizeLabel(value) {
  const label = String(value ?? "").trim();
  if (!label) return null;

  const i18n = globalThis.game?.i18n;
  if (
    typeof i18n?.has === "function"
    && typeof i18n.localize === "function"
    && i18n.has(label)
  ) {
    const localized = String(i18n.localize(label) ?? "").trim();
    if (localized && localized !== label) return localized;
  }

  return label.startsWith("PF2E.") ? null : label;
}

function elementalBlastLabel(config) {
  const label = localizeLabel(config?.label);
  if (label) return label;

  const element = String(config?.element ?? "").trim();
  const elementLabel = titleCaseWords(element || "element");
  const key = `PF2E.SpecificRule.Kineticist.Impulse.ElementalBlast.Label.${elementLabel}`;
  return localizeLabel(key) ?? t("Action.ElementalBlastNamed", "Elemental Blast ({element})", { element: elementLabel });
}

function elementalBlastModeLabel(baseLabel, mode, actionCost) {
  const modeLabel = t(`Mode.${mode}`, mode);
  return actionCost === 2
    ? t("Action.ElementalBlast2", "{base} ({mode}, 2 actions)", { base: baseLabel, mode: modeLabel })
    : t("Action.ElementalBlast1", "{base} ({mode})", { base: baseLabel, mode: modeLabel });
}

function readElementalBlastActions(actor, context) {
  const item = elementalBlastItem(actor);
  const configs = elementalBlastConfigs(actor);
  if (!item || !configs.length) return [];

  const infusion = kineticistBlastFlag(actor)?.infusion;
  const actionCosts = elementalBlastActionCosts(item);

  return configs.flatMap((config) => {
    const damageType = selectedElementalDamageType(item, config, infusion);
    const element = slugify(config.element);
    const label = elementalBlastLabel(config);
    const rangedIncrement = Number(infusion?.range?.increment);
    const rangedMax = Number(infusion?.range?.max ?? config.range);
    const rangedRange = Number.isFinite(rangedIncrement) && rangedIncrement > 0
      ? { increment: rangedIncrement, max: rangedIncrement * 6 }
      : { max: Number.isFinite(rangedMax) && rangedMax > 0 ? rangedMax : 30 };

    return actionCosts.flatMap((actionCost) => {
      const averageDamage = elementalBlastAverage(actor, config, actionCost);
      const commonTraits = [
        "attack",
        "impulse",
        "kineticist",
        element,
        damageType,
      ].filter(Boolean);
      const common = {
        slug: "strike",
        tacticSlug: "elemental-blast",
        actionCost,
        source: "strike",
        confidence: "medium",
        executable: "open-item",
        detected: true,
        item: null,
        elementalBlastItem: item,
        elementalBlastConfig: config,
        elementalBlastActionCost: actionCost,
        attackTrait: true,
        damageProfile: {
          average: averageDamage,
          type: damageType,
          types: [damageType],
        },
        averageDamage,
        traits: commonTraits,
        variants: [],
        reasons: [t("Reason.ElementalBlast", "Elemental Blast is available.")],
      };

      return [{
        ...common,
        id: `elemental-blast-${element}-${damageType}-melee-${actionCost}a`,
        name: elementalBlastModeLabel(label, "melee", actionCost),
        range: { max: 5 },
        traits: [
          ...commonTraits,
          ...(Array.isArray(infusion?.traits?.melee) ? infusion.traits.melee : []),
        ],
      }, {
        ...common,
        id: `elemental-blast-${element}-${damageType}-ranged-${actionCost}a`,
        name: elementalBlastModeLabel(label, "ranged", actionCost),
        range: rangedRange,
        traits: [
          ...commonTraits,
          ...(Array.isArray(infusion?.traits?.ranged) ? infusion.traits.ranged : []),
        ],
      }].map((action) => {
        const availability = generatedStrikeAvailability(context, action);
        return {
          ...action,
          available: availability.available,
          unavailableReason: availability.reason,
          preferredTarget: availability.target,
        };
      });
    });
  });
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
  // Ray moved to foundry.canvas.geometry.Ray in v13; prefer it so we don't hit the deprecated global.
  const Ray = globalThis.foundry?.canvas?.geometry?.Ray ?? globalThis.foundry?.utils?.Ray ?? globalThis.Ray;
  return Ray ? new Ray(from, to) : { A: from, B: to };
}

function wallCollisionBlocked(from, to, types) {
  const walls = globalThis.canvas?.walls;
  if (typeof walls?.checkCollision !== "function") return false;
  // No walls on the scene means no collision — skip the (expensive) sweep entirely. This is the
  // common open-battlefield case and removes thousands of checkCollision calls per plan rebuild.
  // Foundry always exposes placeables as an array, so an explicitly-empty one means "no walls".
  if (Array.isArray(walls.placeables) && walls.placeables.length === 0) return false;

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

// Wall collision for a fixed grid segment is stable until the walls change, and the same segments
// are swept on every plan rebuild (each token select / move). These caches persist ACROSS builds —
// the first rebuild in a walled scene pays for the sweeps, later ones reuse them — and are cleared
// only when walls or the scene change (see clearMovementCollisionCache, wired in main.js). Moving
// other tokens never invalidates them: Foundry "move" collision tests walls, not tokens.
const COLLISION_CACHE_LIMIT = 50000;
const movementCollisionCache = new Map();
const attackCollisionCache = new Map();

export function clearMovementCollisionCache() {
  movementCollisionCache.clear();
  attackCollisionCache.clear();
}

// Self-contained safety net so the persistent collision cache can't serve results from a different
// scene/wall set (a new canvas, scene swap, or walls added/removed) even if the invalidation hooks
// don't fire (headless, tests). In-place wall *moves* keep this fingerprint stable, so the explicit
// create/update/deleteWall hooks still matter for those.
let lastCollisionCanvas;
let lastCollisionFingerprint;
function syncCollisionCacheForScene() {
  const canvas = globalThis.canvas;
  const fingerprint = `${canvas?.scene?.id ?? ""}|${(canvas?.walls?.placeables ?? []).length}`;
  if (canvas !== lastCollisionCanvas || fingerprint !== lastCollisionFingerprint) {
    clearMovementCollisionCache();
    lastCollisionCanvas = canvas;
    lastCollisionFingerprint = fingerprint;
  }
}

function segmentKey(from, to) {
  return `${from.x},${from.y}>${to.x},${to.y}`;
}

function computeMovementPathBlocked(from, to, token) {
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

function movementPathBlocked(from, to, token = null) {
  const key = `${token?.id ?? token?.document?.id ?? ""}|${segmentKey(from, to)}`;
  const cached = movementCollisionCache.get(key);
  if (cached !== undefined) return cached;
  const blocked = computeMovementPathBlocked(from, to, token);
  if (movementCollisionCache.size < COLLISION_CACHE_LIMIT) movementCollisionCache.set(key, blocked);
  return blocked;
}

function attackPathBlocked(from, to) {
  const key = segmentKey(from, to);
  const cached = attackCollisionCache.get(key);
  if (cached !== undefined) return cached;
  const blocked = wallCollisionBlocked(from, to, ["sight", "move", "movement"])
    || wallSegmentsBlockMovement(from, to);
  if (attackCollisionCache.size < COLLISION_CACHE_LIMIT) attackCollisionCache.set(key, blocked);
  return blocked;
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

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function centerOccupiedByOtherToken(context, center, footprint) {
  const candidateRectangle = rectangleForCenter(center, footprint);
  const others = [...contextAllies(context), ...contextEnemies(context)];
  return others.some((other) => {
    const otherCenter = centerPoint(other);
    if (!otherCenter) return false;
    const metrics = movementGridMetrics();
    const otherRectangle = rectangleForCenter(otherCenter, tokenFootprintPixels(other, metrics));
    return rectanglesOverlap(candidateRectangle, otherRectangle);
  });
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

// Reachable-square BFS depends only on (origin, distance) within one candidate build (the actor,
// walls and terrain are fixed). The readers run it once per strike per target, so memoize it for the
// build — collapsing dozens of identical wall-collision sweeps into a couple. Cleared per build in
// readActionSources. Cached arrays are only ever read (filter/sort/some), never mutated.
const reachableCentersCache = new Map();

function movementReachableCenters(origin, distanceFeet, metrics, token = null, context = null) {
  const cacheKey = `${movementPointKey(origin)}|${distanceFeet}`;
  const cached = reachableCentersCache.get(cacheKey);
  if (cached) return cached;

  const cells = Math.floor(distanceFeet / metrics.sceneDistance);
  const maxOffset = cells * metrics.pixelSize;
  const maxDistance = distanceFeet + 0.0001;
  const centers = [];
  const bestCosts = new Map([[movementPointKey(origin), 0]]);
  const queue = [{ center: origin, cost: 0, diagonalCount: 0 }];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const center of movementNeighbors(current.center, metrics)) {
      if (Math.abs(center.x - origin.x) > maxOffset || Math.abs(center.y - origin.y) > maxOffset) continue;
      if (movementPathBlocked(current.center, center, token)) continue;

      // Use PF2e's stateful diagonal cost (every 2nd diagonal is 10 ft) so the chosen attack
      // square matches what a Stride actually costs. Measuring each step independently
      // undercounted diagonals and produced destinations beyond the actor's Speed.
      const movement = pf2eMovementSegmentCost(current.center, center, {
        gridSize: metrics.pixelSize,
        gridDistance: metrics.sceneDistance,
        startingDiagonalCount: current.diagonalCount,
        token,
        actor: token?.actor ?? null,
      });
      const cost = current.cost + movement.cost;
      if (!Number.isFinite(cost) || cost > maxDistance) continue;

      const key = movementPointKey(center);
      if ((bestCosts.get(key) ?? Infinity) <= cost) continue;
      bestCosts.set(key, cost);
      centers.push(center);
      queue.push({ center, cost, diagonalCount: movement.diagonalCount });
    }
  }

  const footprint = tokenFootprintPixels(token ?? context?.token, metrics);
  const filtered = context ? centers.filter((center) => !centerOccupiedByOtherToken(context, center, footprint)) : centers;
  reachableCentersCache.set(cacheKey, filtered);
  return filtered;
}

function hasMovementCollisionLayer(token = null) {
  return typeof globalThis.canvas?.walls?.checkCollision === "function"
    || typeof token?.checkCollision === "function"
    || (globalThis.canvas?.walls?.placeables ?? []).some?.(wallBlocksMovement);
}

// Memoize the perimeter-filtered attack squares per build. For a ranged reach every reachable
// square passes the reach test and runs an attack-path wall check, and several readers (ranged
// retreat, skirmish, stride-strike) request the same (origin, distance, reach, target) — without
// this the same wall sweeps run many times over. Cleared per build alongside the BFS memo.
const reachableAttackCentersCache = new Map();

function reachableAttackCenters(context, target, distanceFeet, reachFeet) {
  const origin = centerPoint(context?.token);
  const targetCenter = centerPoint(target);
  if (!origin || !targetCenter) return [];

  const cacheKey = `${movementPointKey(origin)}|${distanceFeet}|${reachFeet}|${targetKey(target) ?? movementPointKey(targetCenter)}`;
  const cached = reachableAttackCentersCache.get(cacheKey);
  if (cached) return cached;

  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const metrics = movementGridMetrics();
  const attackerFootprint = tokenFootprintPixels(context?.token, metrics);
  const targetRectangle = rectangleForCenter(targetCenter, tokenFootprintPixels(target, metrics));
  const result = movementReachableCenters(origin, distanceFeet, metrics, collisionToken, context)
    .filter((center) => {
      const attackerRectangle = rectangleForCenter(center, attackerFootprint);
      return gridReachDistanceFeet(attackerRectangle, targetRectangle, metrics) <= reachFeet
        && canAttackTargetPerimeter(attackerRectangle, targetRectangle, metrics);
    });
  reachableAttackCentersCache.set(cacheKey, result);
  return result;
}

function canMoveIntoReach(context, target, distanceFeet, reachFeet) {
  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const origin = centerPoint(context?.token);
  const targetCenter = centerPoint(target);
  if (!origin || !targetCenter) return true;
  if (!hasMovementCollisionLayer(collisionToken)) return true;
  return reachableAttackCenters(context, target, distanceFeet, reachFeet).length > 0;
}

function bestReachableAttackCenter(context, target, distanceFeet, reachFeet, options = {}) {
  return reachableAttackCenters(context, target, distanceFeet, reachFeet)
    .toSorted((left, right) =>
      compareTacticalCenters(context, left, right, {
        target,
        preferFartherFromTarget: options.preferFartherFromTarget === true,
      }),
    )[0] ?? null;
}

function canReturnToOrigin(context, fromCenter, distanceFeet) {
  const origin = centerPoint(context?.token);
  if (!origin || !fromCenter) return false;

  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const metrics = movementGridMetrics();
  const originKey = movementPointKey(origin);
  return movementReachableCenters(fromCenter, distanceFeet, metrics, collisionToken, context)
    .some((center) => movementPointKey(center) === originKey);
}

function drawStrikeTarget(context, range, readyStrikes) {
  const targets = contextTargets(context);
  const enemies = contextEnemies(context);
  return [...targets, ...enemies].find((target) =>
    canAttackTarget(target)
    && !readyStrikeCanReach(readyStrikes, target)
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
        name: t("Action.DrawStrike", "Draw {weapon} -> Strike", { weapon: weapon.name }),
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
        reasons: [t("Reason.DrawEnablesStrike", "Draw {weapon} enables a Strike against {target}.", { weapon: weapon.name, target: target.name })],
      }];
    });
}

function isHeldWeapon(weapon) {
  if (!weapon || weapon.type !== "weapon") return false;
  if (systemValue(weapon.system?.category) === "unarmed") return false;
  return weapon.isHeld === true || weaponCarryType(weapon) === "held" || weaponHandsHeld(weapon) > 0;
}

// Stand-alone Draw (Interact, 1 action) for each sheathed/stowed weapon — distinct from the
// Draw -> Strike combo, which also requires a reachable target.
function readDrawWeaponActions(actor) {
  return readWeaponItems(actor).filter(isDrawableWeapon).map((weapon) => {
    const slug = slugify(weapon.slug ?? weapon.system?.slug ?? weapon.name);
    return {
      id: `draw-weapon-${weapon.id ?? slug}`,
      name: t("Action.Draw", "Draw {weapon}", { weapon: weapon.name }),
      slug: `draw-${slug}`,
      actionCost: 1,
      actionType: "action",
      source: "system-inferred",
      confidence: "medium",
      executable: "draw-weapon",
      detected: true,
      available: true,
      item: weapon,
      role: "setup",
      activityProfile: { includes: ["draw", "interact"], drawsWeapon: true, weaponName: weapon.name },
      targetingProfile: { self: true },
      reasons: [t("Reason.DrawToReady", "Draw {weapon} to ready it.", { weapon: weapon.name })],
      traits: [],
      attackTrait: false,
    };
  });
}

// Sheathe (Interact, 1 action) for each held weapon — stows it back into its worn slot.
function readSheatheWeaponActions(actor) {
  return readWeaponItems(actor).filter(isHeldWeapon).map((weapon) => {
    const slug = slugify(weapon.slug ?? weapon.system?.slug ?? weapon.name);
    return {
      id: `sheathe-weapon-${weapon.id ?? slug}`,
      name: t("Action.Sheathe", "Sheathe {weapon}", { weapon: weapon.name }),
      slug: `sheathe-${slug}`,
      actionCost: 1,
      actionType: "action",
      source: "system-inferred",
      confidence: "low",
      executable: "sheathe-weapon",
      detected: true,
      available: true,
      item: weapon,
      role: "utility",
      activityProfile: { includes: ["interact"], sheathesWeapon: true, weaponName: weapon.name },
      targetingProfile: { self: true },
      reasons: [t("Reason.SheatheToStow", "Sheathe {weapon} to stow it.", { weapon: weapon.name })],
      traits: [],
      attackTrait: false,
    };
  });
}

// Release (free action) for each held weapon — drops it to the ground.
function readReleaseWeaponActions(actor) {
  return readWeaponItems(actor).filter(isHeldWeapon).map((weapon) => {
    const slug = slugify(weapon.slug ?? weapon.system?.slug ?? weapon.name);
    return {
      id: `release-weapon-${weapon.id ?? slug}`,
      name: t("Action.Release", "Release {weapon}", { weapon: weapon.name }),
      slug: `release-${slug}`,
      actionCost: 0,
      actionType: "free",
      source: "system-inferred",
      confidence: "low",
      executable: "drop-weapon",
      detected: true,
      available: true,
      item: weapon,
      role: "utility",
      activityProfile: { includes: ["release"], dropsWeapon: true, free: true, weaponName: weapon.name },
      targetingProfile: { self: true },
      reasons: [t("Reason.ReleaseToGround", "Release {weapon}, dropping it to the ground.", { weapon: weapon.name })],
      traits: [],
      attackTrait: false,
    };
  });
}

// The weapon's reload value as a number (0, 1, 2, 3), or null when the weapon has no reload at all
// (melee/thrown). A reload-0 ammunition weapon (e.g. a bow) IS reloadable but reloading is free,
// which is distinct from a melee weapon that carries no reload value — so an empty/"-"/absent value
// returns null rather than collapsing to 0.
function weaponReloadValue(weapon) {
  for (const raw of [weapon?.reload, systemValue(weapon?.system?.reload), systemValue(weapon?.system?.reload?.value)]) {
    if (raw === undefined || raw === null) continue;
    const text = String(raw).trim().toLowerCase();
    if (text === "" || text === "-" || text === "—" || text === "none") return null;
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    const word = text.match(/\b(zero|one|two|three)\b/)?.[1];
    if (word) return word === "zero" ? 0 : WORD_NUMBERS[word];
  }
  return null;
}

function readReloadWeaponActions(actor) {
  return readWeaponItems(actor)
    .filter(isHeldWeapon)
    .map((weapon) => ({ weapon, reload: weaponReloadValue(weapon) }))
    // Include reload-0 ammunition weapons (shown as a free step) but exclude melee/thrown weapons,
    // which have no reload value at all.
    .filter(({ reload }) => reload !== null)
    .map(({ weapon, reload }) => {
      const slug = slugify(weapon.slug ?? weapon.system?.slug ?? weapon.name);
      // Reload 0 reloads as part of firing: keep it in the plan for clarity, but as a free action
      // that does not draw from the action budget.
      const free = reload <= 0;
      return {
        id: `reload-weapon-${weapon.id ?? slug}`,
        name: t("Action.Reload", "Reload {weapon}", { weapon: weapon.name }),
        slug: `reload-${slug}`,
        actionCost: free ? 0 : Math.max(1, Math.min(3, reload)),
        actionType: free ? "free" : "action",
        source: "system-inferred",
        confidence: free ? "low" : "medium",
        executable: "reload-weapon",
        detected: true,
        available: true,
        item: weapon,
        role: "setup",
        activityProfile: { includes: ["reload"], reload: true, free, weaponName: weapon.name },
        targetingProfile: { self: true },
        setupFor: ["strike", "damage"],
        reasons: [free
          ? t("Reason.ReloadFree", "{weapon} reloads as part of firing (no action).", { weapon: weapon.name })
          : t("Reason.ReloadWeapon", "Reload {weapon}.", { weapon: weapon.name })],
        traits: [],
        attackTrait: false,
      };
    });
}

function actorHasDropProneAction(actor) {
  const items = [
    ...collectionValues(actor?.itemTypes?.action),
    ...collectionValues(actor?.itemTypes?.feat),
    ...collectionValues(actor?.itemTypes?.feature),
    ...collectionValues(actor?.items),
  ];
  return items.some((item) => slugify(item?.slug ?? item?.system?.slug ?? item?.name) === "drop-prone");
}

// Drop Prone (1 action) for actors that do not already carry their own — gated off when prone.
function readDropProneAction(actor, context) {
  if (actorHasDropProneAction(actor)) return [];
  const prone = hasCondition(contextProfile(context), "prone");
  return [{
    id: "generic-drop-prone",
    name: pf2eActionName("drop-prone", "Drop Prone"),
    slug: "drop-prone",
    actionCost: 1,
    actionType: "action",
    source: "system-inferred",
    confidence: "low",
    executable: "drop-prone",
    detected: true,
    available: !prone,
    unavailableReason: prone ? t("Reason.AlreadyProne", "Already prone.") : "",
    item: null,
    uuid: "Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60", // Prone — this action has no standalone entry.
    role: "defense",
    activityProfile: { appliesConditions: ["prone"] },
    targetingProfile: { self: true },
    reasons: [t("Reason.DropProneCover", "Drop Prone for cover against ranged attackers.")],
    traits: [],
    attackTrait: false,
  }];
}

function strikeMeleeReach(strike) {
  const reach = Number(strike?.range?.max);
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

function rangedStrikeReach(strike) {
  const reach = Number(strike?.range?.max ?? strike?.range?.increment);
  return Number.isFinite(reach) && reach > 5 ? reach : 0;
}

function isRangedStrike(strike) {
  if (rangedStrikeReach(strike) <= 5) return false;
  const traits = normalizedTraits(strike?.traits ?? strike?.item?.system?.traits?.value)
    .map((trait) => String(trait ?? "").toLowerCase());
  return traits.includes("ranged")
    || traits.some((trait) => trait.startsWith("thrown-"))
    || Number(strike?.range?.max ?? strike?.range?.increment) > 10;
}

// Find a target this strike can reach by Striding, and how many Strides it takes.
// A single Stride covers Speed; two Strides cover double Speed, letting the actor
// simulate closing a gap that one move can't (the "move-move-strike" turn).
function strideStrikePlan(context, profile, strike, readyStrikes, maxStrides = 2) {
  const reach = strikeMeleeReach(strike);
  const speed = movementRange(profile);
  const oneStride = speed + reach;
  const twoStrides = speed * 2 + reach;
  for (const target of [...contextTargets(context), ...contextEnemies(context)].filter(canAttackTarget)) {
    const distance = target?.distance ?? Infinity;
    if (readyStrikeCanReach(readyStrikes, target)) continue;
    if (maxStrides >= 1 && distance <= oneStride) {
      const attackCenter = bestReachableAttackCenter(context, target, speed, reach);
      if (attackCenter) return { target, strides: 1, attackCenter };
      if (canMoveIntoReach(context, target, speed, reach)) return { target, strides: 1 };
    }
    if (maxStrides >= 2 && distance <= twoStrides) {
      const attackCenter = bestReachableAttackCenter(context, target, speed * 2, reach);
      if (attackCenter) return { target, strides: 2, attackCenter };
      if (canMoveIntoReach(context, target, speed * 2, reach)) return { target, strides: 2 };
    }
  }
  return null;
}

function readStrideStrikeActivities(context, readyStrikes) {
  const profile = contextProfile(context);
  const standFirst = canStandBeforeMovement(profile);
  if (!standFirst && movementBlockingCondition(profile, { slug: "stride" })) return [];

  const seenTargets = new Set();
  return readyStrikes.flatMap((strike) => {
    const reach = strikeMeleeReach(strike);
    const plan = strideStrikePlan(context, profile, strike, readyStrikes, standFirst ? 1 : 2);
    if (!plan) return [];
    const { target, strides, attackCenter } = plan;
    const actionCost = strides + 1 + (standFirst ? 1 : 0);
    if (actionCost > 3) return [];

    const targetKey = target.id ?? target.name;
    if (seenTargets.has(targetKey)) return [];
    seenTargets.add(targetKey);

    const slug = slugify(strike.name ?? strike.slug ?? "strike");
    const movePrefix = `${standFirst ? t("Action.StandArrow", "Stand -> ") : ""}${t("Action.StrideArrow", "Stride -> ").repeat(strides)}`;
    return [{
      id: `${standFirst ? "stand-" : ""}stride-strike-${strike.id ?? slug}`,
      name: `${movePrefix}${strike.name}`,
      slug: `${standFirst ? "stand-" : ""}stride-strike-${slug}`,
      actionCost,
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
        includes: [...(standFirst ? ["stand"] : []), ...Array(strides).fill("stride"), "strike"],
        includesStrike: true,
        removesCondition: standFirst ? "prone" : null,
        strideCount: strides,
        strikeReach: reach,
        attackCenter,
      },
      targetingProfile: {
        enemy: true,
        reachAfterMove: true,
        preferredTargetId: target.id ?? null,
        preferredTargetName: target.name ?? null,
      },
      attackTrait: true,
      setupFor: [],
      reasons: [standFirst
        ? t("Reason.StandStrideStrike", "Stand, Stride into reach, and Strike {target}.", { target: target.name })
        : strides > 1
          ? t("Reason.StrideTwiceStrike", "Stride twice into reach and Strike {target}.", { target: target.name })
          : t("Reason.StrideStrike", "Stride into reach and Strike {target}.", { target: target.name })],
    }];
  });
}

function targetThreatReach(target) {
  const reach = Number(target?.reach ?? target?.meleeReach ?? target?.profile?.reach ?? target?.profile?.meleeReach);
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

function distanceFromCenterToTarget(context, center, target) {
  const targetCenter = centerPoint(target);
  if (!center || !targetCenter) return Infinity;

  const metrics = movementGridMetrics();
  const attackerRectangle = rectangleForCenter(center, tokenFootprintPixels(context?.token, metrics));
  const targetRectangle = rectangleForCenter(targetCenter, tokenFootprintPixels(target, metrics));
  return gridReachDistanceFeet(attackerRectangle, targetRectangle, metrics);
}

function rangedRetreatStrikePlan(context, profile, strike) {
  if (!isRangedStrike(strike)) return null;

  const origin = centerPoint(context?.token);
  const reach = rangedStrikeReach(strike);
  const speed = movementRange(profile);
  if (!origin || reach <= 5 || speed <= 0) return null;

  for (const target of uniqueTargets(context)) {
    if (!actionCanReach(strike, target)) continue;

    const threatReach = targetThreatReach(target);
    const currentDistance = distanceFromCenterToTarget(context, origin, target);
    if (!Number.isFinite(currentDistance) || currentDistance > threatReach) continue;

    const attackCenter = reachableAttackCenters(context, target, speed, reach)
      .filter((center) => distanceFromCenterToTarget(context, center, target) > threatReach)
      .toSorted((left, right) => {
        const tactical = compareTacticalCenters(context, left, right, { target, preferFartherFromTarget: true });
        if (tactical !== 0) return tactical;
        const leftDistance = distanceFromCenterToTarget(context, left, target);
        const rightDistance = distanceFromCenterToTarget(context, right, target);
        if (leftDistance !== rightDistance) return rightDistance - leftDistance;
        return (left.cost ?? Infinity) - (right.cost ?? Infinity);
      })[0] ?? null;

    if (attackCenter) return { target, attackCenter, threatReach };
  }

  return null;
}

function readRangedRetreatStrikeActivities(context, readyStrikes) {
  const profile = contextProfile(context);
  if (movementBlockingCondition(profile, { slug: "stride" })) return [];

  const seenTargets = new Set();
  return readyStrikes.flatMap((strike) => {
    const plan = rangedRetreatStrikePlan(context, profile, strike);
    if (!plan) return [];
    const { target, attackCenter, threatReach } = plan;

    const targetKeyValue = targetKey(target);
    if (targetKeyValue && seenTargets.has(targetKeyValue)) return [];
    if (targetKeyValue) seenTargets.add(targetKeyValue);

    const reach = rangedStrikeReach(strike);
    const slug = slugify(strike.name ?? strike.slug ?? "strike");
    return [{
      id: `stride-away-strike-${strike.id ?? slug}`,
      name: t("Action.StrideAwayStrike", "Stride Away -> {strike}", { strike: strike.name }),
      slug: `stride-away-strike-${slug}`,
      actionCost: 2,
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
        includes: ["stride", "strike"],
        includesStrike: true,
        retreatBeforeStrike: true,
        strideCount: 1,
        strikeReach: reach,
        threatReach,
        attackCenter,
      },
      targetingProfile: {
        enemy: true,
        reachAfterMove: true,
        retreatBeforeStrike: true,
        preferredTargetId: target.id ?? null,
        preferredTargetName: target.name ?? null,
      },
      attackTrait: true,
      setupFor: [],
      reasons: [t("Reason.StrideAwayStrike", "Stride away from {target}, then Strike with {strike}.", { target: target.name, strike: strike.name })],
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
  for (const target of [...contextTargets(context), ...contextEnemies(context)].filter(canAttackTarget)) {
    if (readyStrikeCanReach(readyStrikes, target) || (target?.distance ?? Infinity) <= reach) continue;

    const coverState = originCoverFromTarget(context, target);
    if (!coverState) continue;

    const attackCenter = reachableAttackCenters(context, target, speed, reach)
      .filter((center) => canReturnToOrigin(context, center, speed))
      .toSorted((left, right) => compareTacticalCenters(context, left, right, { target }))[0] ?? null;
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
      name: t("Action.StrideStrikeStride", "Stride -> {strike} -> Stride", { strike: strike.name }),
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
      reasons: [t("Reason.StrideReturnCover", "Stride to attack {target}, then return to {cover} cover.", { target: target.name, cover: coverState })],
    }];
  });
}

// --- Positional move-and-strike tactics (skirmish/kite + flank) ----------------

// Actor and ally flank a target when they sit on opposite sides of the target
// center (PF2e flanking approximation): the dot product of the two offset
// vectors measured from the target center is negative.
function flanksTarget(attackerCenter, allyCenter, targetCenter) {
  if (!attackerCenter || !allyCenter || !targetCenter) return false;
  const ax = attackerCenter.x - targetCenter.x;
  const ay = attackerCenter.y - targetCenter.y;
  const bx = allyCenter.x - targetCenter.x;
  const by = allyCenter.y - targetCenter.y;
  if ((ax === 0 && ay === 0) || (bx === 0 && by === 0)) return false;
  return ax * bx + ay * by < 0;
}

function allyThreatensTarget(ally, target, metrics) {
  const allyCenter = centerPoint(ally);
  const targetCenter = centerPoint(target);
  if (!allyCenter || !targetCenter) return false;
  const allyRectangle = rectangleForCenter(allyCenter, tokenFootprintPixels(ally, metrics));
  const targetRectangle = rectangleForCenter(targetCenter, tokenFootprintPixels(target, metrics));
  return gridReachDistanceFeet(allyRectangle, targetRectangle, metrics) <= targetThreatReach(ally);
}

// Find an enemy that already has an ally adjacent, plus a Stride-reachable square
// on the opposite side so the actor's melee Strike lands against an off-guard target.
function flankStrikePlan(context, profile, strike) {
  if (isRangedStrike(strike)) return null;

  const reach = strikeMeleeReach(strike);
  const speed = movementRange(profile);
  if (reach <= 0 || speed <= 0) return null;

  const metrics = movementGridMetrics();
  const allies = contextAllies(context).filter((ally) => centerPoint(ally));
  if (!allies.length) return null;

  for (const target of uniqueTargets(context)) {
    const targetCenter = centerPoint(target);
    if (!targetCenter) continue;

    const flankAllies = allies.filter((ally) => allyThreatensTarget(ally, target, metrics));
    if (!flankAllies.length) continue;

    const attackCenter = reachableAttackCenters(context, target, speed, reach)
      .filter((center) => flankAllies.some((ally) => flanksTarget(center, centerPoint(ally), targetCenter)))
      .toSorted((left, right) => compareTacticalCenters(context, left, right, { target }))[0] ?? null;
    if (!attackCenter) continue;

    const ally = flankAllies.find((candidate) => flanksTarget(attackCenter, centerPoint(candidate), targetCenter))
      ?? flankAllies[0];
    return { target, attackCenter, ally };
  }

  return null;
}

function readFlankStrikeActivities(context, readyStrikes) {
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
      name: t("Action.FlankStrike", "Flank -> {strike}", { strike: strike.name }),
      slug: `flank-strike-${slug}`,
      actionCost: 2,
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
        positionalTactic: "flank",
        includes: ["stride", "strike"],
        includesStrike: true,
        strideCount: 1,
        strikeReach: reach,
        attackCenter,
        meleeStrike: strike,
        flankAllyId: ally?.id ?? ally?.token?.id ?? null,
        targetOffGuard: true,
      },
      targetingProfile: {
        enemy: true,
        reachAfterMove: true,
        preferredTargetId: target.id ?? null,
        preferredTargetName: target.name ?? null,
      },
      attackTrait: true,
      setupFor: [],
      reasons: [t("Reason.FlankStrike", "Stride to flank {target} with {ally}, then Strike for an off-guard hit.", { target: target.name, ally: ally?.name ?? t("Reason.AnAlly", "an ally") })],
    }];
  });
}

function actorHpPercent(profile) {
  const nested = Number(profile?.hp?.percent);
  if (Number.isFinite(nested)) return nested;
  const flat = Number(profile?.hpPercent);
  if (Number.isFinite(flat)) return flat;
  return 1;
}

// Mirror of scoring's damageAverage so the reader can compare finisher options
// without importing the scorer (keeps the reader layer self-contained).
function candidateAverageDamage(candidate) {
  const values = [
    candidate?.damageProfile?.average,
    candidate?.activityProfile?.averageDamage,
    candidate?.averageDamage,
  ];
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) {
      const multiplier = candidate?.activityProfile?.damageScalesWithActions
        ? Math.max(1, Number(candidate?.actionCost) || 1)
        : 1;
      return number * multiplier;
    }
  }
  return 0;
}

const OFFENSIVE_SPELL_ROLES = new Set(["damage", "save-damage", "area-damage"]);

function isOffensiveRangedSpell(spell, meleeReach) {
  if (spell?.available !== true) return false;
  if (!OFFENSIVE_SPELL_ROLES.has(spell?.role)) return false;
  if (spell?.targetingProfile?.enemy !== true) return false;
  const range = Number(spell?.targetingProfile?.maxRange);
  return Number.isFinite(range) && range > meleeReach;
}

// Normalize ranged Strikes and offensive ranged spells into a single finisher list.
function skirmishFinishers(readyStrikes, spells, meleeReach) {
  const finishers = [];
  for (const strike of readyStrikes) {
    if (!isRangedStrike(strike)) continue;
    const reach = rangedStrikeReach(strike);
    if (reach <= 5) continue;
    finishers.push({ kind: "strike", ref: strike, reach, actionCost: 1, average: candidateAverageDamage(strike) });
  }
  for (const spell of spells) {
    if (!isOffensiveRangedSpell(spell, meleeReach)) continue;
    finishers.push({
      kind: "spell",
      ref: spell,
      reach: Number(spell.targetingProfile.maxRange),
      actionCost: Math.max(1, Number(spell.actionCost) || 1),
      average: candidateAverageDamage(spell),
    });
  }
  return finishers;
}

function bestMeleeDamage(readyStrikes) {
  return readyStrikes
    .filter((strike) => !isRangedStrike(strike))
    .reduce((best, strike) => Math.max(best, candidateAverageDamage(strike)), 0);
}

// A retreat square outside the target's threat from which the finisher still reaches.
function retreatSquareForFinisher(context, target, finisher, speed, threatReach) {
  return reachableAttackCenters(context, target, speed, finisher.reach)
    .filter((center) => distanceFromCenterToTarget(context, center, target) > threatReach)
    .toSorted((left, right) => {
      const tactical = compareTacticalCenters(context, left, right, { target, preferFartherFromTarget: true });
      if (tactical !== 0) return tactical;
      const leftDistance = distanceFromCenterToTarget(context, left, target);
      const rightDistance = distanceFromCenterToTarget(context, right, target);
      if (leftDistance !== rightDistance) return rightDistance - leftDistance;
      return (left.cost ?? Infinity) - (right.cost ?? Infinity);
    })[0] ?? null;
}

function bestFinisherForTarget(context, target, finishers, speed, threatReach) {
  let best = null;
  for (const finisher of finishers) {
    const attackCenter = retreatSquareForFinisher(context, target, finisher, speed, threatReach);
    if (!attackCenter) continue;
    const better = !best
      || finisher.average > best.average
      || (finisher.average === best.average && finisher.actionCost < best.actionCost);
    if (better) best = { ...finisher, attackCenter };
  }
  return best;
}

// Skirmish / kite: the actor stands in an enemy's melee threat but fights better at
// range (fragile or ranged-primary). Recommend an optional melee Strike, a Stride out
// of threat, and a ranged finisher (Strike or offensive spell), fit to the action budget.
function skirmishKitePlan(context, profile, readyStrikes, spells, budget) {
  const origin = centerPoint(context?.token);
  const speed = movementRange(profile);
  if (!origin || speed <= 0) return null;

  const actorMelee = meleeReach(profile);
  const finishers = skirmishFinishers(readyStrikes, spells, actorMelee);
  if (!finishers.length) return null;

  const fragile = actorHpPercent(profile) < 0.5;
  const bestMelee = bestMeleeDamage(readyStrikes);

  for (const target of uniqueTargets(context)) {
    const threatReach = targetThreatReach(target);
    const currentDistance = distanceFromCenterToTarget(context, origin, target);
    if (!Number.isFinite(currentDistance) || currentDistance > threatReach) continue;

    const finisher = bestFinisherForTarget(context, target, finishers, speed, threatReach);
    if (!finisher) continue;

    const rangedPrimary = finisher.average > 0 && finisher.average >= bestMelee;
    if (!fragile && !rangedPrimary) continue;

    const meleeStrike = readyStrikes.find((strike) =>
      !isRangedStrike(strike) && currentDistance <= strikeMeleeReach(strike),
    ) ?? null;
    const includeMelee = Boolean(meleeStrike) && (1 + 1 + finisher.actionCost) <= budget;
    if (!includeMelee && (1 + finisher.actionCost) > budget) continue;

    return {
      target,
      finisher,
      attackCenter: finisher.attackCenter,
      threatReach,
      meleeStrike: includeMelee ? meleeStrike : null,
    };
  }

  return null;
}

function readSkirmishKiteActivities(context, readyStrikes, spells) {
  const profile = contextProfile(context);
  if (movementBlockingCondition(profile, { slug: "stride" })) return [];

  const budget = actionBudget(context).totalActions;
  if (budget < 2) return [];

  const plan = skirmishKitePlan(context, profile, readyStrikes, spells, budget);
  if (!plan) return [];

  const { target, finisher, attackCenter, threatReach, meleeStrike } = plan;
  const finisherName = finisher.ref.name ?? finisher.ref.slug ?? (finisher.kind === "spell" ? pf2eActionName("cast-a-spell", "Cast a Spell") : pf2eActionName("strike", "Strike"));
  const slug = slugify(finisherName);
  const verb = finisher.kind === "spell" ? t("Reason.CastVerb", "Cast") : finisherName;
  const namePrefix = meleeStrike ? `${meleeStrike.name} -> ` : "";

  return [{
    id: `skirmish-${finisher.kind}-${finisher.ref.id ?? slug}`,
    name: t("Action.SkirmishKite", "{prefix}Stride Away -> {finisher}", { prefix: namePrefix, finisher: finisherName }),
    slug: `skirmish-${finisher.kind}-${slug}`,
    actionCost: (meleeStrike ? 1 : 0) + 1 + finisher.actionCost,
    actionType: "action",
    source: "system-inferred",
    confidence: "medium",
    executable: "open-item",
    detected: true,
    available: true,
    item: finisher.ref.item ?? null,
    preferredTarget: target,
    role: "mobility-attack",
    activityProfile: {
      positionalTactic: "skirmish",
      meleeStrike,
      finisher: { kind: finisher.kind, ref: finisher.ref, actionCost: finisher.actionCost },
      includes: [...(meleeStrike ? ["strike"] : []), "stride", ...(finisher.kind === "strike" ? ["strike"] : [])],
      includesStrike: true,
      retreatBeforeStrike: true,
      strideCount: 1,
      strikeReach: finisher.reach,
      threatReach,
      attackCenter,
    },
    targetingProfile: {
      enemy: true,
      reachAfterMove: true,
      retreatBeforeStrike: true,
      preferredTargetId: target.id ?? null,
      preferredTargetName: target.name ?? null,
    },
    attackTrait: true,
    setupFor: [],
    reasons: [meleeStrike
      ? t("Reason.KiteMelee", "Strike {target}, Stride out of reach, then {verb} from range.", { target: target.name, verb })
      : t("Reason.KiteRanged", "Stride out of {target}'s reach, then {verb} from range.", { target: target.name, verb })],
  }];
}

// Combines the positional move-and-strike tactics. Spells are passed in by the
// caller so the skirmish finisher can be a ranged Strike or an offensive spell.
function readPositionalTacticActivities(context, readyStrikes, spells = []) {
  return [
    ...readSkirmishKiteActivities(context, readyStrikes, spells),
    ...readFlankStrikeActivities(context, readyStrikes),
  ];
}

function readActorItemActions(actor, context) {
  const typedItems = [
    ...collectionValues(actor?.itemTypes?.action),
    ...collectionValues(actor?.itemTypes?.feat),
    ...collectionValues(actor?.itemTypes?.feature),
    ...collectionValues(actor?.itemTypes?.consumable),
    ...collectionValues(actor?.itemTypes?.ammo),
    ...collectionValues(actor?.itemTypes?.armor),
    ...collectionValues(actor?.itemTypes?.backpack),
    ...collectionValues(actor?.itemTypes?.book),
    ...collectionValues(actor?.itemTypes?.equipment),
    ...collectionValues(actor?.itemTypes?.weapon),
  ];
  const typedIds = new Set(typedItems.map((item) => item?.id).filter(Boolean));
  const fallbackItems = collectionValues(actor?.items)
    .filter((item) => !typedIds.has(item?.id))
    .filter((item) => ACTIVATABLE_ITEM_TYPES.has(item?.type));

  return [...typedItems, ...fallbackItems].flatMap((item) => {
    if (!item) return [];
    const slug = slugify(item.slug ?? item.system?.slug ?? item.name);
    if (slug === "elemental-blast" && elementalBlastConfigs(actor).length) return [];
    const curated = findCustomAction(slug);
    const parsedCost = readActionCost(item);
    const inferred = curated ? null : classifySystemAction(item, parsedCost);
    const tactic = curated ?? inferred;
    const actionCost = curated?.actionCost ?? parsedCost.actionCost;
    const baseName = curated?.name ?? item.name;
    const name = parsedCost.interactDrawCost > 0 ? `Interact -> ${baseName}` : baseName;
    const itemAvailability = readItemAvailability(item);
    const trigger = readTrigger(item);
    const triggerAvailability = readTriggerAvailability(trigger, context);
    const traits = readTraitSlugs(item);
    const activityProfile = addItemTraitProfile(
      addConsumableInteractProfile(tactic?.activityProfile, parsedCost),
      traits,
    );
    if (hideNonCombatSystemAction(slug, traits, tactic)) return [];
    const movementAvailability = readMovementAvailability(context, { slug, traits, activityProfile });
    const genericAvailability = genericActionAvailability(slug, context);
    const shieldBlockAvailability = readShieldBlockAvailability(slug, item, context);
    // Reactions are standing options the player should see on their own turn — the trigger
    // fires later, so it describes WHEN to use the reaction rather than gating availability.
    // Triggered free actions stay gated (their trigger marks a fleeting moment to act).
    const isReaction = parsedCost.type === "reaction" || actionCost === "reaction";
    const available = actionCost !== null
      && actionCost !== Infinity
      && itemAvailability.available
      && (isReaction || triggerAvailability.available)
      && shieldBlockAvailability.available
      && movementAvailability.available
      && genericAvailability.available;

    if (!tactic && parsedCost.passive) return [];
    if (!curated && actionCost === null) return [];

    return [{
      id: `item-${item.id ?? slug}`,
      name,
      slug,
      actionCost,
      actionType: parsedCost.type,
      activationActionCost: parsedCost.activationActionCost ?? actionCost,
      interactDrawCost: parsedCost.interactDrawCost ?? 0,
      source: curated ? "custom-curated" : (inferred ? "system-inferred" : "custom-unknown"),
      confidence: tactic?.confidence ?? "low",
      executable: tactic?.executable ?? "open-item",
      detected: true,
      available,
      unavailableReason: itemAvailability.reason
        || (isReaction ? "" : triggerAvailability.reason)
        || shieldBlockAvailability.reason
        || movementAvailability.reason
        || genericAvailability.reason,
      item,
      trigger,
      role: tactic?.role ?? "unknown",
      activityProfile,
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

// Strip Foundry enrichment (@UUID[...]{Leap}, @Damage[...], @Check[...]{Reflex}) down to readable
// text so anything we surface never shows raw @UUID markup. Keeps the {Label} when there is one.
function stripEnrichment(value) {
  return String(value ?? "")
    .replace(/@[A-Za-z]+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@[A-Za-z]+\[[^\]]*\]/g, "")
    .replace(/@[A-Za-z]+\{([^}]*)\}/g, "$1");
}

function readTrigger(item) {
  const explicit = systemValue(item?.system?.trigger ?? item?.trigger);
  if (explicit) return normalizeWhitespace(stripEnrichment(explicit));

  // One source only: item.system.description and item.description are the same content, and joining
  // them duplicated the whole block into any extracted trigger.
  const html = descriptionHtml(item) || String(systemValue(item?.description) ?? "");

  const triggerMatch = html.match(/<strong>\s*Trigger\s*<\/strong>\s*([^<]+)/i);
  if (triggerMatch?.[1]) return normalizeWhitespace(stripEnrichment(triggerMatch[1]));

  // Plain-text fallback: require "Trigger" to be a real label — capitalized and at a boundary (start
  // or after a period/newline), stopping at the next section or sentence end. Without this a stray
  // mid-sentence "...doesn't trigger reactions..." matched and swallowed the entire description.
  const text = stripEnrichment(htmlToText(html));
  const textMatch = text.match(/(?:^|[.\n]\s+)Trigger\s+(.+?)(?:\s+Requirements\b|\s+Frequency\b|\s+Effect\b|\.|$)/);
  return textMatch?.[1] ? normalizeWhitespace(textMatch[1]) : "";
}

function readTriggerAvailability(trigger, context) {
  if (!trigger) return availability(true, "");

  if (triggerMatchesContext(trigger, context)) return availability(true, "");

  return availability(false, t("Avail.TriggerNotActive", "Trigger is not active: {trigger}", { trigger }));
}

function readShieldBlockAvailability(slug, item, context) {
  if (!isShieldBlockAction(slug, item)) return availability(true, "");
  if (shieldBlockDefenseActive(context)) return availability(true, "");
  return availability(false, t("Avail.ShieldBlockNeedsShield", "Shield Block requires Raise a Shield or an active Shield spell."));
}

function isShieldBlockAction(slug, item) {
  return slug === "shield-block" || slugify(item?.name) === "shield-block";
}

function actorHasShieldBlockAction(actor) {
  const items = [
    ...collectionValues(actor?.itemTypes?.action),
    ...collectionValues(actor?.itemTypes?.feat),
    ...collectionValues(actor?.itemTypes?.feature),
    ...collectionValues(actor?.items),
  ];
  return items.some((item) => isShieldBlockAction(slugify(item?.slug ?? item?.system?.slug ?? item?.name), item));
}

function shieldEffectEntries(context) {
  const profile = contextProfile(context);
  const actor = contextActor(context);
  return [
    ...collectionValues(profile?.effects),
    ...collectionValues(context?.actor?.profile?.effects),
    ...collectionValues(context?.profile?.effects),
    ...collectionValues(actor?.itemTypes?.effect),
    ...collectionValues(actor?.items).filter((item) => item?.type === "effect"),
  ];
}

function effectSlugKeys(effect) {
  return [
    effect?.slug,
    effect?.name,
    effect?.sourceId,
  ].map(slugify).filter(Boolean);
}

// Matches the Shield spell's effect ("Spell Effect: Shield", slug spell-effect-shield) while
// tolerating rank/variant suffixes (e.g. spell-effect-shield-rank-1). Deliberately does NOT
// match "effect-shield-immunity" (the post-Shield-Block cooldown, which BLOCKS using it).
function isShieldSpellEffectKey(key) {
  if (typeof key !== "string") return false;
  if (key === "effect-shield") return true;
  if (key.startsWith("effect-shield-immunity")) return false;
  return key.startsWith("spell-effect-shield");
}

function isRaisedShieldEffectKey(key) {
  return key === "effect-raise-a-shield"
    || key === "raise-a-shield"
    || key === "raised-shield";
}

function shieldSpellDefenseActive(context) {
  const profile = contextProfile(context);
  if (profile?.combatState?.shieldSpellActive === true) return true;

  return shieldEffectEntries(context).some((effect) =>
    effectSlugKeys(effect).some(isShieldSpellEffectKey),
  );
}

function shieldBlockDefenseActive(context) {
  const profile = contextProfile(context);
  if (profile?.combatState?.raisedShieldActive === true || profile?.combatState?.shieldSpellActive === true) {
    return true;
  }

  return shieldEffectEntries(context).some((effect) =>
    effectSlugKeys(effect).some((key) => isRaisedShieldEffectKey(key) || isShieldSpellEffectKey(key)),
  );
}

function readShieldSpellBlockActions(actor, context) {
  if (!shieldSpellDefenseActive(context)) return [];
  if (actorHasShieldBlockAction(actor)) return [];

  const trigger = t("Reason.ShieldBlockTrigger", "You would take damage from an attack while your Shield spell is active.");
  // This is a standing reaction the Shield spell makes available: it should appear whenever the
  // shield is active, not only when an incoming-attack event is already in context (which never
  // happens on the caster's own turn). The trigger is shown for reference, not as a gate.
  const shieldBlockAvailability = readShieldBlockAvailability("shield-block", { name: "Shield Block" }, context);
  return [{
    id: "spell-shield-block",
    name: pf2eActionName("shield-block", "Shield Block"),
    slug: "shield-block",
    actionCost: "reaction",
    actionType: "reaction",
    activationActionCost: "reaction",
    source: "spell-inferred",
    confidence: "high",
    executable: "chat-guidance",
    detected: true,
    available: shieldBlockAvailability.available,
    unavailableReason: shieldBlockAvailability.reason,
    item: null,
    trigger,
    role: "defense",
    activityProfile: { reaction: true, spell: true, shieldBlock: true },
    targetingProfile: { self: true },
    saveProfile: null,
    damageProfile: null,
    gatingProfile: null,
    setupFor: [],
    reasons: [t("Reason.ShieldBlockActive", "Shield spell grants Shield Block while active.")],
    traits: [],
    attackTrait: false,
  }];
}

function isGenericAvailable(action, context) {
  const profile = contextProfile(context);
  const targets = contextTargets(context);
  const enemies = contextEnemies(context);
  const targetableTargets = targets.filter(canAttackTarget);
  const targetableEnemies = enemies.filter(canAttackTarget);
  const actionTargets = action.slug === "demoralize"
    ? targetableTargets.filter((target) => !hasDemoralizeImmunity(target))
    : targetableTargets;
  const actionEnemies = action.slug === "demoralize"
    ? targetableEnemies.filter((target) => !hasDemoralizeImmunity(target))
    : targetableEnemies;
  const allies = contextAllies(context);
  const movementAvailability = readMovementAvailability(context, action);

  if (action.playerFacing && isNpcProfile(profile)) {
    return availability(false, t("Avail.NpcNoRecall", "NPCs do not need Recall Knowledge recommendations."));
  }
  if (!movementAvailability.available) {
    return movementAvailability;
  }
  if (action.slug === "raise-a-shield") {
    return availability(Boolean(profile.hasShield), t("Avail.NoShield", "No shield equipped."));
  }
  if (action.requiresTarget) {
    const targetExists = Boolean(actionTargets.length);
    if (!targetExists && action.slug === "demoralize" && targetableTargets.length) {
      return availability(false, t("Avail.DemoralizeImmune", "Target is temporarily immune to Demoralize."));
    }
    if (!targetExists) return availability(false, t("Avail.NoEnemySelected", "No enemy target selected."));
  }
  if (Number.isFinite(action.maxRange)) {
    const targetPool = action.requiresTarget ? actionTargets : [...actionTargets, ...actionEnemies];
    const inRange = targetPool.some((target) => (target?.distance ?? Infinity) <= action.maxRange);
    if (!inRange) return availability(false, t("Avail.NoTargetWithin", "No target within {range} feet.", { range: action.maxRange }));
  }
  if (action.requiresEnemyInReach) {
    const enemyInReach = targetableTargets.some((target) => (target?.distance ?? Infinity) <= meleeReach(profile));
    if (!enemyInReach) return availability(false, t("Avail.NoEnemyInReach", "No enemy in reach."));
  }
  if (action.requiresFreeHand && freeHands(profile) < 1) {
    return availability(false, t("Avail.NoFreeHand", "No free hand to manipulate an object."));
  }
  if (action.requiresNearbyEnemy) {
    const nearbyEnemy = targetableTargets.some((target) => (target?.distance ?? Infinity) <= movementRange(profile));
    if (!nearbyEnemy) return availability(false, t("Avail.NoEnemyClose", "No enemy close enough."));
  }
  if (action.requiresSeekTarget) {
    if (!hasSeekTarget(context, enemies)) {
      return availability(false, t("Avail.NoHiddenTarget", "No hidden or undetected target detected."));
    }
  }
  if (action.requiresCombatSignal) {
    if (!hasCombatSignal(context, targetableTargets)) {
      return availability(false, t("Avail.NoDeceptionEffect", "No combat-relevant deception or mental effect detected."));
    }
  }
  if (action.requiresTumbleThroughOpportunity) {
    if (!hasTumbleThroughOpportunity(context, targetableTargets)) {
      return availability(false, t("Avail.NoPathThroughEnemy", "No useful path through enemy detected."));
    }
  }
  if (action.requiresTerrain) {
    if (!hasTerrain(context, action.requiresTerrain)) {
      return availability(false, t("Avail.NoTerrain", "No {terrain} terrain detected.", { terrain: action.requiresTerrain }));
    }
  }
  if (action.requiresObstacleInReach) {
    if (!hasObjectInReach(context, profile, ["obstacles", "objects", "hazards", "doors"])) {
      return availability(false, t("Avail.NoObstacle", "No obstacle or object in reach."));
    }
  }
  if (action.requiresObjectInReach) {
    if (!hasObjectInReach(context, profile, ["objects"])) {
      return availability(false, t("Avail.NoObject", "No object in reach."));
    }
  }
  if (action.requiresProne) {
    if (!hasCondition(profile, "prone")) {
      return availability(false, t("Avail.NotProne", "Actor is not prone."));
    }
  }
  if (action.requiresSickened) {
    if (!hasCondition(profile, "sickened")) {
      return availability(false, t("Avail.NotSickened", "Actor is not sickened."));
    }
  }
  if (action.requiresCover) {
    if (action.slug === "take-cover") {
      if (!hasCondition(profile, "prone") && !hasAdjacentCover(context, profile)) {
        return availability(false, t("Avail.NoWallCover", "No adjacent wall or cover."));
      }
    } else if (!hasCoverOrConcealment(profile, context)) {
      return availability(false, t("Avail.NoCoverConcealment", "No cover or concealment detected."));
    }
  }
  if (action.requiresHiddenOrCover) {
    if (!hasCoverOrConcealment(profile, context) && !hasCondition(profile, "hidden")) {
      return availability(false, t("Avail.NoHiddenCover", "No hidden state, cover, or concealment detected."));
    }
  }
  if (action.requiresGrabbedOrRestrained) {
    if (![...ESCAPE_CONDITIONS].some((condition) => hasCondition(profile, condition))) {
      return availability(false, t("Avail.NotGrabbed", "Actor is not grabbed, restrained, or immobilized."));
    }
  }
  if (action.requiresDyingAlly) {
    if (!allies.some((ally) => hasCondition(ally, "dying"))) {
      return availability(false, t("Avail.NoDyingAlly", "No dying ally detected."));
    }
  }
  if (action.requiresDyingOrBleedingAlly) {
    if (!allies.some((ally) => hasCondition(ally, "dying") || hasCondition(ally, "persistent-bleed"))) {
      return availability(false, t("Avail.NoDyingBleedingAlly", "No dying or bleeding ally detected."));
    }
  }
  if (action.requiresCompanionOrMinion) {
    if (!hasCompanionOrMinion(context, profile)) {
      return availability(false, t("Avail.NoCompanion", "No companion or minion detected."));
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
  if (!["crawl", "step", "stride"].includes(slug)) return false;
  if (!hasMovementCollisionChecker(context)) return false;

  const origin = centerPoint(context?.token);
  if (!origin) return false;

  const distance = ["crawl", "step"].includes(slug) ? 5 : movementRange(profile);
  const metrics = movementGridMetrics();
  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  return !movementReachableCenters(origin, distance, metrics, collisionToken, context).length;
}

function readMovementAvailability(context, action) {
  if (!actionUsesMovement(action)) return availability(true, "");

  const profile = contextProfile(context);
  const condition = movementBlockingCondition(profile, action);
  if (condition) return availability(false, t("Avail.MoveBlocked", "Actor is {condition}; move actions are unavailable.", { condition: pf2eCondition(condition, condition) }));

  if (basicMovementBlockedByCollision(context, profile, action)) {
    return availability(false, t("Avail.NoMovePath", "No collision-free movement path."));
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
        ?? readVisionerDetectionState(enemy, observer))
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

function hasExplicitActionValue(value) {
  const raw = systemValue(value);
  return raw !== undefined && raw !== null && String(raw).trim() !== "";
}

function defaultItemActionCostOnly(item, actionType, actions) {
  const type = String(systemValue(actionType) ?? "").toLowerCase();
  if (type !== "action") return false;
  if (hasExplicitActionValue(actions)) return false;
  return !["action", "feat", "feature"].includes(item?.type);
}

export function readActionCost(item) {
  const getterCost = item?.actionCost;
  const getterType = systemValue(getterCost?.type);
  const getterValue = systemValue(getterCost?.value);
  if (getterType) {
    const parsedGetter = parseActionCost(getterType, getterValue);
    if (parsedGetter.actionCost !== null) return withConsumableInteractCost(item, parsedGetter);
  }

  const actionType = systemValue(item?.system?.actionType);
  const actions = systemValue(item?.system?.actions);
  const parsed = parseActionCost(actionType, actions);
  if (parsed.actionCost !== null && !defaultItemActionCostOnly(item, actionType, actions)) {
    return withConsumableInteractCost(item, parsed);
  }

  const activationCost = readActivationActionCost(item);
  if (activationCost) return withConsumableInteractCost(item, activationCost);

  return withConsumableInteractCost(item, defaultItemActionCostOnly(item, actionType, actions)
    ? { actionCost: null, type: "unknown", passive: false }
    : parsed);
}

function readItemAvailability(item) {
  if (!item) return { available: false, reason: t("Avail.MissingItem", "Missing item.") };
  if (item.disabled === true || item.system?.disabled === true || item.system?.enabled === false) {
    return { available: false, reason: t("Avail.ItemDisabled", "Item is disabled.") };
  }

  const quantity = Number(systemValue(item.system?.quantity));
  if (item.type === "consumable" && Number.isFinite(quantity) && quantity <= 0) {
    return { available: false, reason: t("Avail.ConsumableZero", "Consumable quantity is 0.") };
  }

  const usesValue = Number(systemValue(item.system?.uses));
  const usesMax = Number(systemValue(item.system?.uses?.max ?? item.system?.uses?.maximum));
  if (Number.isFinite(usesValue) && (!Number.isFinite(usesMax) || usesMax > 0) && usesValue <= 0) {
    return { available: false, reason: t("Avail.NoUses", "No uses remaining.") };
  }

  const frequencyCurrent = Number(systemValue(
    item.system?.frequency?.value
    ?? item.system?.frequency?.current
    ?? item.system?.frequency?.remaining,
  ));
  if (Number.isFinite(frequencyCurrent) && frequencyCurrent <= 0) {
    return { available: false, reason: t("Avail.FrequencySpent", "Frequency is spent.") };
  }

  if (hasUnevaluatedPredicate(item)) {
    return { available: false, reason: t("Avail.UnevaluatedPredicate", "Action has unevaluated PF2e predicate.") };
  }

  return { available: true, reason: "" };
}

// Only the item's own system.predicate gates whether the action can be taken. A
// rule-element predicate merely gates when that rule's effect applies (e.g. a
// spellshape roll option on Reach Spell), not the action's usability — treating those
// as unavailable produced false "unevaluated predicate" warnings on normal feats.
function hasUnevaluatedPredicate(item) {
  const predicate = item.system?.predicate;
  if (Array.isArray(predicate)) return predicate.length > 0;
  return Boolean(predicate && typeof predicate === "object" && Object.keys(predicate).length > 0);
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

function readActivationActionCost(item) {
  const text = normalizeActivationText(htmlToText(descriptionHtml(item)));
  const match = text.match(/\bActivate\b([\s\S]{0,180})/i);
  if (!match) return null;

  const activation = match[1].trim();
  const bracket = activation.match(/\[(one-action|two-actions|three-actions|free-action|reaction)\]/i);
  if (bracket) {
    const cost = parseActivationToken(bracket[1]);
    return { actionCost: cost, type: activationType(cost), passive: false, activationInDescription: true };
  }

  const glyph = activation.match(/(?:^|\s)([123ADTRFR])(?=\s*(?:\(|Interact\b|Envision\b|Command\b|Cast\b|concentrate\b|manipulate\b|$))/i);
  if (glyph) {
    const raw = glyph[1].toUpperCase();
    const cost = /^[123]$/.test(raw) ? Number(raw) : ACTION_GLYPHS[raw];
    return { actionCost: cost, type: activationType(cost), passive: false, activationInDescription: true };
  }

  const wordCost = activation.match(/\b(one|two|three|1|2|3)[ -]actions?\b/i);
  if (wordCost) {
    const cost = WORD_NUMBERS[String(wordCost[1]).toLowerCase()] ?? Number(wordCost[1]);
    return { actionCost: cost, type: "action", passive: false, activationInDescription: true };
  }

  if (/\bfree\b/i.test(activation)) {
    return { actionCost: 0, type: "free", passive: false, activationInDescription: true };
  }
  if (/\breaction\b/i.test(activation)) {
    return { actionCost: "reaction", type: "reaction", passive: false, activationInDescription: true };
  }

  return null;
}

function parseActivationToken(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "one-action") return 1;
  if (normalized === "two-actions") return 2;
  if (normalized === "three-actions") return 3;
  if (normalized === "free-action") return 0;
  if (normalized === "reaction") return "reaction";
  return null;
}

function activationType(cost) {
  if (cost === "reaction") return "reaction";
  if (cost === 0) return "free";
  return "action";
}

function itemCarryType(item) {
  return String(item?.carryType ?? item?.system?.equipped?.carryType ?? "").toLowerCase();
}

function itemHandsHeld(item) {
  const hands = Number(item?.handsHeld ?? item?.system?.equipped?.handsHeld);
  return Number.isFinite(hands) ? hands : 0;
}

function itemUsage(item) {
  return String(systemValue(item?.system?.usage) ?? "").toLowerCase();
}

function requiresHeldConsumableUse(item) {
  return item?.type === "consumable" && itemUsage(item).includes("held");
}

function isHeldItem(item) {
  return item?.isHeld === true || itemCarryType(item) === "held" || itemHandsHeld(item) > 0;
}

function consumableInteractDrawCost(item, parsedCost) {
  if (!requiresHeldConsumableUse(item) || isHeldItem(item)) return 0;
  const actionCost = parsedCost?.actionCost;
  if (actionCost === null || actionCost === undefined) return 0;
  return Number.isFinite(Number(actionCost)) ? 1 : 0;
}

function withConsumableInteractCost(item, parsedCost) {
  const drawCost = consumableInteractDrawCost(item, parsedCost);
  if (!drawCost) return parsedCost;
  return {
    ...parsedCost,
    activationActionCost: parsedCost.actionCost,
    actionCost: Number(parsedCost.actionCost) + drawCost,
    interactDrawCost: drawCost,
  };
}

function addConsumableInteractProfile(activityProfile, parsedCost) {
  if (!parsedCost?.interactDrawCost) return activityProfile ?? null;
  const includes = new Set(Array.isArray(activityProfile?.includes) ? activityProfile.includes : []);
  includes.add("interact");
  return {
    ...(activityProfile ?? {}),
    includes: [...includes],
    interactDraw: true,
  };
}

function addItemTraitProfile(activityProfile, traits) {
  if (!Array.isArray(traits)) return activityProfile ?? null;
  const normalizedTraits = traits.map((trait) => slugify(trait));
  if (!normalizedTraits.includes("impulse") && !normalizedTraits.includes("overflow")) return activityProfile ?? null;
  const next = { ...(activityProfile ?? {}) };
  if (normalizedTraits.includes("impulse")) next.impulse = true;
  if (normalizedTraits.includes("overflow")) next.overflow = true;
  return {
    ...next,
  };
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
