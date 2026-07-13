import { findCustomAction } from "../../catalog/custom-actions.js";
import { collectionValues, systemValue, traitSlugs } from "../../foundry-data.js";
import { parseActionText as parseActionTextValue, slugify as slugifyText } from "../../engine/action/text.js";
import { contextActorDocument } from "../../engine/actor-context.js";
import { classifySystemAction } from "../../engine/action/classifier.js";
import { canAttackTarget, contextEnemies, contextTargets } from "../../engine/target-pool.js";
import {
  addConsumableInteractProfile,
  addItemTraitProfile,
  isActivatableItem,
  parseActionCost,
  readActionCost,
  readItemAvailability,
} from "../item-action-reader.js";
import { readWeaponActions } from "../weapon-action-reader.js";
import { readSwapItemActions } from "../swap-action-reader.js";
import { readPositionalMovementActions } from "../positional/tactic-reader.js";
import {
  actorHasElementalBlastConfigs,
  readElementalBlastActions,
} from "../elemental-blast-reader.js";
import {
  readResourceRecoveryAvailability,
  readShieldBlockAvailability,
  readShieldSpellBlockActions,
} from "../defense-action-reader.js";
import {
  hideNonCombatSystemAction,
  readGenericActionAvailability,
  readGenericActions,
  readMovementAvailability,
} from "../generic-action-reader.js";
import {
  canStandBeforeMovement,
  contextProfile,
  hasCondition,
  meleeReach,
  uniqueTargets,
} from "./reader-helpers.js";
import {
  actionCanReach,
  canStrikeTargetFromCurrentPosition,
  clearActionReachBuildCache,
} from "./reach.js";
import {
  backingStrikeFilterByPreset as backingStrikeFilterPreset,
  bestReadyStrikeAverageDamageFromOptions,
  bestReadyStrikeFromOptions,
  heldMeleeBackingStrikesFromOptions,
} from "../../engine/backing-strike.js";
import { triggerMatchesContext } from "../../rules/event-context.js";
import { pf2eActionName, t } from "../../i18n.js";

export { readActionCost } from "../item-action-reader.js";
export { hasEnemyWithinRange } from "../../engine/target-pool.js";

// Wands, scrolls, and spell gems with a stored spell (system.spell) are read as proper spell
// actions by readConsumableSpellActions (spell-reader.js), which gets their real damage/targeting
// from the same curated catalog as known spells. Left in here too, they'd also match the generic
// Activate-block text parsing below and show up a second time as a plain, undifferentiated item.
const EMBEDDED_SPELL_CONSUMABLE_CATEGORIES = new Set(["scroll", "wand", "spell-gem"]);
function isEmbeddedSpellConsumable(item) {
  if (item?.type !== "consumable" || !item.system?.spell) return false;
  const category = String(item.system?.category ?? "").toLowerCase();
  return EMBEDDED_SPELL_CONSUMABLE_CATEGORIES.has(category);
}
const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
};

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

export function slugify(value) {
  return slugifyText(value);
}

export function readActionSources(context, spells = []) {
  clearActionReachBuildCache();
  const actor = contextActorDocument(context);
  const generatedStrikes = actorStrikeOptions(actor, context);
  // readGeneratedActivities reads actor.system.actions, which for a PC is normally just its
  // Strikes -- feat-driven multiattacks like Flurry of Blows live as Items and only surface via
  // readActorItemActions. Both feed the stride+multiattack combo builder below, so both are
  // computed up front (hoisted the same way generatedStrikes already is) instead of only being
  // spread in at their original, later position.
  const generatedActivities = readGeneratedActivities(actor, context);
  const itemActions = readActorItemActions(actor, context);
  return [
    ...readGenericActions(context),
    ...readStandStrideActivities(context),
    ...generatedStrikes,
    ...readElementalBlastActions(actor, context),
    ...readWeaponActions(actor, context, generatedStrikes),
    ...readSwapItemActions(actor),
    ...readDropProneAction(actor, context),
    ...readPositionalMovementActions(context, generatedStrikes, [...generatedActivities, ...itemActions], spells),
    ...generatedActivities,
    ...readShieldSpellBlockActions(actor, context),
    ...itemActions,
  ];
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

export function actorStrikeOptions(actor, context = null) {
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
      const range = readStrikeRange(strike, traits, actor);
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
        attackEffects: Array.isArray(strike.item?.system?.attackEffects?.value) ? strike.item.system.attackEffects.value : [],
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

export function backingStrikeFilterByPreset(preset) {
  return backingStrikeFilterPreset(preset);
}

export function heldMeleeBackingStrikes(actor, context) {
  return heldMeleeBackingStrikesFromOptions(actorStrikeOptions(actor, context));
}

export function bestReadyStrike(actor, context, filter) {
  return bestReadyStrikeFromOptions(actorStrikeOptions(actor, context), filter);
}

export function bestReadyStrikeAverageDamage(actor, context) {
  return bestReadyStrikeAverageDamageFromOptions(actorStrikeOptions(actor, context));
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
    ...traitSlugs(action?.item),
  ];
  return [...new Set(traitValues.filter(Boolean).map((trait) => String(trait)))];
}

function readStrikeTraits(strike) {
  const traitValues = [
    ...(Array.isArray(strike.traits) ? strike.traits.map((trait) => trait.slug ?? trait.name ?? trait) : []),
    ...(Array.isArray(strike.weaponTraits) ? strike.weaponTraits.map((trait) => trait.slug ?? trait.name ?? trait) : []),
    ...traitSlugs(strike.item),
  ];
  return [...new Set(traitValues.filter(Boolean).map((trait) => String(trait)))];
}

function nativeStrikeReach(actor, strike) {
  try {
    const reach = actor?.getReach?.({ action: "attack", weapon: strike?.item ?? null });
    if (Number.isFinite(Number(reach)) && Number(reach) >= 0) return Number(reach);
  } catch (_error) {
    // Fall through to the prepared item/actor data shapes used by older PF2e releases and tests.
  }

  const candidates = [
    strike?.reach,
    strike?.item?.reach,
    actor?.system?.attributes?.reach?.base,
    actor?.system?.attributes?.reach?.value,
    actor?.system?.attributes?.reach,
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const reach = Number(systemValue(candidate));
    if (Number.isFinite(reach) && reach >= 0) return reach;
  }
  return null;
}

function readStrikeRange(strike, traits, actor) {
  const item = strike.item;
  const systemRange = item?.system?.range;
  const increment = Number(systemValue(systemRange?.increment ?? systemRange));
  const max = Number(systemValue(systemRange?.max));
  if (Number.isFinite(max) && max > 0) return { max };
  if (Number.isFinite(increment) && increment > 0) return { increment, max: increment };

  const traitReach = traits
    .map((trait) => trait.match(/^reach-(\d+)$/)?.[1])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (traitReach.length) return { max: Math.max(...traitReach) };
  const nativeReach = nativeStrikeReach(actor, strike);
  if (nativeReach !== null) return { max: nativeReach };
  if (traits.includes("reach")) return { max: 10 };
  return { max: 5 };
}

function parseReloadCost(value) {
  const raw = systemValue(value);
  if (raw === undefined || raw === null) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;

  const text = String(raw ?? "").toLowerCase().trim();
  // PF2e generated Strike data can use "-" as a display placeholder even when the backing
  // weapon carries a real reload value. Treat placeholders as unknown so readStrikeReload keeps
  // checking item.system.reload; if no source has a value, its final fallback still returns 0.
  if (!text || text === "-") return null;
  if (text === "none") return 0;

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

function generatedStrikeAvailability(context, action) {
  if (!context) return availability(true, "");

  const targets = uniqueTargets(context).filter((target) => actionCanReach(action, target));
  if (!targets.length) return availability(false, t("Avail.NoTargetInRange", "No target in range."));

  const target = targets.find((candidate) => canStrikeTargetFromCurrentPosition(context, action, candidate));
  if (target) return { ...availability(true, ""), target };

  return availability(false, t("Avail.AttackPathBlocked", "Attack path to target is blocked."));
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
    reasons: [t("Reason.DropProneCover", "Drop Prone to set up Take Cover's ranged defense bonus.")],
    traits: [],
    attackTrait: false,
  }];
}

function readActorItemActions(actor, context) {
  const typedItems = [
    ...collectionValues(actor?.itemTypes?.action),
    ...collectionValues(actor?.itemTypes?.feat),
    ...collectionValues(actor?.itemTypes?.feature),
    ...collectionValues(actor?.itemTypes?.consumable).filter((item) => !isEmbeddedSpellConsumable(item)),
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
    .filter((item) => !isEmbeddedSpellConsumable(item))
    .filter(isActivatableItem);

  return [...typedItems, ...fallbackItems].flatMap((item) => {
    if (!item) return [];
    const slug = slugify(item.slug ?? item.system?.slug ?? item.name);
    if (slug === "elemental-blast" && actorHasElementalBlastConfigs(actor)) return [];
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
    const traits = traitSlugs(item);
    const activityProfile = addItemTraitProfile(
      addConsumableInteractProfile(tactic?.activityProfile, parsedCost),
      traits,
    );
    if (hideNonCombatSystemAction(slug, traits, tactic)) return [];
    const movementAvailability = readMovementAvailability(context, { slug, traits, activityProfile });
    const genericAvailability = readGenericActionAvailability(slug, context);
    const shieldBlockAvailability = readShieldBlockAvailability(slug, item, context);
    const resourceRecoveryAvailability = readResourceRecoveryAvailability({ activityProfile }, context);
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
      && genericAvailability.available
      && resourceRecoveryAvailability.available;

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
        || genericAvailability.reason
        || resourceRecoveryAvailability.reason,
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

function availability(available, reason) {
  return { available, reason };
}

export function parseActionText(value) {
  return parseActionTextValue(value);
}
