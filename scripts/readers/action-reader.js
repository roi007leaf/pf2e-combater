import { findCustomAction } from "../catalog/custom-actions.js";
import { GENERIC_ACTIONS } from "../catalog/generic-actions.js";
import { classifySystemAction } from "../engine/action-classifier.js";
import { isSeekRelevantVisibility, readVisionerDetectionState } from "../integrations/visioner.js";

const ACTION_ITEM_TYPES = new Set(["action", "feat", "feature", "consumable"]);
const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
};

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
  const generatedStrikes = readGeneratedStrikes(actor);
  return [
    ...readGenericActions(context),
    ...generatedStrikes,
    ...readDrawStrikeActivities(actor, context, generatedStrikes),
    ...readStrideStrikeActivities(context, generatedStrikes),
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

function readGeneratedStrikes(actor) {
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
        range: readStrikeRange(strike, traits),
        detected: true,
        available: true,
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
      const available = actionCost !== null
        && actionCost !== Infinity
        && triggerAvailability.available;

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
        unavailableReason: triggerAvailability.reason,
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
        traits: readGeneratedActionTraits(action),
        attackTrait: readGeneratedActionTraits(action).includes("attack"),
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
  return strikes.some((strike) => actionCanReach(strike, target));
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
    if (readyStrikeCanReach(readyStrikes, target) || distance <= reach) continue;
    if (distance <= oneStride) return { target, strides: 1 };
    if (distance <= twoStrides) return { target, strides: 2 };
  }
  return null;
}

function readStrideStrikeActivities(context, readyStrikes) {
  const profile = contextProfile(context);
  const seenTargets = new Set();
  return readyStrikes.flatMap((strike) => {
    if (strikeMeleeReach(strike) > 10) return [];

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
    const available = actionCost !== null
      && actionCost !== Infinity
      && itemAvailability.available
      && triggerAvailability.available;

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
      unavailableReason: itemAvailability.reason || triggerAvailability.reason,
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
      traits: readTraitSlugs(item),
      attackTrait: readTraitSlugs(item).includes("attack"),
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

  if (action.playerFacing && isNpcProfile(profile)) {
    return availability(false, "NPCs do not need Recall Knowledge recommendations.");
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
    if (!hasCoverOrConcealment(profile, context)) {
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

function isNpcProfile(profile) {
  return ["npc", "hazard", "loot"].includes(String(profile?.actorType ?? profile?.type ?? "").toLowerCase());
}

function hasTerrain(context, key) {
  const terrain = context?.battlefield?.terrain ?? context?.terrain ?? {};
  if (terrain === key) return true;
  if (Array.isArray(terrain)) return terrain.includes(key);
  return Boolean(terrain?.[key]);
}

function hasObjectInReach(context, profile, buckets) {
  const reach = meleeReach(profile);
  return buckets.some((bucket) => {
    const values = context?.battlefield?.[bucket] ?? context?.[bucket] ?? [];
    return Array.isArray(values) && values.some((entry) => (entry?.distance ?? Infinity) <= reach);
  });
}

function hasSeekTarget(context, enemies) {
  const observer = context?.token ?? context?.combatant?.token ?? null;
  return enemies.some((enemy) => {
    const visionerState = enemy?.visionerDetectionState
      ?? enemy?.visibility
      ?? readVisionerDetectionState(observer, enemy);
    if (isSeekRelevantVisibility(visionerState)) return true;
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
