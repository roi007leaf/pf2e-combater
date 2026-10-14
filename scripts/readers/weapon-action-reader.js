import { collectionValues, systemValue, traitSlugs } from "../foundry-data.js";
import { slugify } from "../engine/action/text.js";
import { canAttackTarget, contextEnemies, contextTargets } from "../engine/target-pool.js";
import { readItemAvailability } from "./item-action-reader.js";
import { readyStrikeCanReach } from "./action/reach.js";
import { isRangedStrike } from "./positional/tactic-helpers.js";
import { t } from "../i18n.js";
import { npcWeaponNeedsReload } from "../engine/npc-reload-state.js";

const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
};

function readWeaponRange(weapon) {
  const traits = traitSlugs(weapon);
  const systemRange = weapon?.system?.range;
  const increment = Number(systemValue(systemRange?.increment ?? systemRange));
  const max = Number(systemValue(systemRange?.max));
  if (Number.isFinite(max) && max > 0) return { max, traits };
  if (Number.isFinite(increment) && increment > 0) return { increment, max: increment * 6, traits };

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

  // An ordinary melee weapon (rapier, longsword) has no range data at all: it reaches 5 ft.
  return { max: 5, traits };
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

// Hands a weapon needs to wield: "held-in-two-hands" (or hands 2) needs both, anything else one.
function weaponHandsRequired(weapon) {
  const hands = weapon?.hands ?? weapon?.system?.usage?.hands;
  if (Number(hands) >= 2) return 2;
  const usage = String(weapon?.system?.usage?.value ?? weapon?.usage?.value ?? "");
  return usage === "held-in-two-hands" ? 2 : 1;
}

// Free hands left after everything already held (weapons, shields, other held gear).
function actorFreeHands(actor) {
  const held = collectionValues(actor?.items).reduce((total, item) => {
    const hands = Number(item?.system?.equipped?.handsHeld ?? item?.handsHeld);
    if (Number.isFinite(hands) && hands > 0) return total + hands;
    return (item?.system?.equipped?.carryType ?? item?.carryType) === "held" ? total + 1 : total;
  }, 0);
  return Math.max(0, 2 - held);
}

function isDrawableWeapon(weapon, freeHands = 2) {
  if (!weapon || weapon.type !== "weapon") return false;
  if (weaponHandsRequired(weapon) > freeHands) return false;
  const category = systemValue(weapon.system?.category);
  if (category === "unarmed") return false;
  if (weapon?.isHeld === true || weaponHandsHeld(weapon) > 0) return false;
  if (weaponCarryType(weapon) === "dropped") return false;
  return readItemAvailability(weapon).available;
}

function drawStrikeTarget(context, weapon, range, readyStrikes) {
  // Any reaching Strike makes drawing a ranged weapon pointless, but a held pistol doesn't replace
  // a sheathed rapier: drawing a melee weapon is only redundant if a melee Strike already reaches.
  // A bare fist never makes a real weapon redundant: it's the fallback the weapon replaces.
  const sameKindStrikes = (isRangedStrike({ range, item: weapon })
    ? readyStrikes
    : readyStrikes.filter((ready) => !isRangedStrike(ready)))
    .filter((ready) => ready?.item?.slug !== "basic-unarmed");
  const targets = contextTargets(context);
  const enemies = contextEnemies(context);
  const open = [...targets, ...enemies].filter((target) => canAttackTarget(target) && !readyStrikeCanReach(sameKindStrikes, target));
  const inRange = open.find((target) => (target?.distance ?? Infinity) <= range.max);
  if (inRange || isRangedStrike({ range, item: weapon })) return inRange ?? null;
  // A sheathed melee weapon still beats a fist after a Stride: offer it to the approach planner.
  return sameKindStrikes.some((ready) => ready?.item?.slug !== "basic-unarmed") ? null
    : open.toSorted((left, right) => (left?.distance ?? Infinity) - (right?.distance ?? Infinity))[0] ?? null;
}

// The weapon's own Strike (its melee usage, not a thrown alternate), ready or not.
function weaponStrike(weapon, allStrikes) {
  const id = weapon?.id ?? weapon?._id;
  return (allStrikes ?? []).find((strike) => (strike?.item?.id ?? strike?.item?._id) === id && strike?.altUsage !== "thrown") ?? null;
}

function readDrawStrikeActivities(actor, context, readyStrikes, allStrikes = []) {
  const freeHands = actorFreeHands(actor);
  return readWeaponItems(actor)
    .filter((weapon) => isDrawableWeapon(weapon, freeHands))
    .flatMap((weapon) => {
      const range = readWeaponRange(weapon);
      if (!range) return [];

      const target = drawStrikeTarget(context, weapon, range, readyStrikes);
      if (!target) return [];

      const slug = slugify(weapon.slug ?? weapon.system?.slug ?? weapon.name);
      // Out of reach: unavailable here, so the approach planner puts a Stride in front of it.
      const reaches = (target?.distance ?? Infinity) <= range.max;
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
        available: reaches,
        ...(reaches ? {} : { unavailableReason: t("Avail.NoEnemyInReach", "No enemy in reach.") }),
        item: weapon,
        ...(weaponStrike(weapon, allStrikes)?.damageProfile ? { damageProfile: weaponStrike(weapon, allStrikes).damageProfile } : {}),
        ...(weaponStrike(weapon, allStrikes)?.averageDamage ? { averageDamage: weaponStrike(weapon, allStrikes).averageDamage } : {}),
        ...(weaponStrike(weapon, allStrikes)?.startsUnloaded ? { startsUnloaded: true } : {}),
        // The weapon's own Strike: a Sudden Charge after a plain Draw of this weapon lands with it.
        ...(weaponStrike(weapon, allStrikes) ? { drawnStrike: weaponStrike(weapon, allStrikes) } : {}),
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

function readDrawWeaponActions(actor, allStrikes = []) {
  const freeHands = actorFreeHands(actor);
  return readWeaponItems(actor).filter((weapon) => isDrawableWeapon(weapon, freeHands)).map((weapon) => {
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
      // The weapon's own Strike: a Sudden Charge after this Draw lands with it.
      ...(weaponStrike(weapon, allStrikes) ? { drawnStrike: weaponStrike(weapon, allStrikes) } : {}),
      targetingProfile: { self: true },
      reasons: [t("Reason.DrawToReady", "Draw {weapon} to ready it.", { weapon: weapon.name })],
      traits: [],
      attackTrait: false,
    };
  });
}

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
      combatUse: "browse-only",
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

function weaponReloadValue(weapon) {
  for (const raw of [weapon?.reload, systemValue(weapon?.system?.reload), systemValue(weapon?.system?.reload?.value)]) {
    if (raw === undefined || raw === null) continue;
    const text = String(raw).trim().toLowerCase();
    if (text === "" || text === "-" || text === "\u2014" || text === "none") return null;
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    const word = text.match(/\b(zero|one|two|three)\b/)?.[1];
    if (word) return word === "zero" ? 0 : WORD_NUMBERS[word];
  }
  return null;
}

function weaponHasLoadedAmmo(weapon) {
  const subitems = weapon?.subitems;
  return typeof subitems?.some === "function" && subitems.some((item) => item?.type === "ammo");
}

function readReloadWeaponActions(actor) {
  const npcActor = actor?.type === "npc" || actor?.isOfType?.("npc") === true;
  return readWeaponItems(actor)
    .filter(isHeldWeapon)
    .map((weapon) => ({ weapon, reload: weaponReloadValue(weapon) }))
    .filter(({ reload }) => reload !== null && reload > 0)
    .map(({ weapon, reload }) => ({
      weapon,
      reload,
      available: npcActor
        ? npcWeaponNeedsReload(actor, { item: weapon, reload })
        : !weaponHasLoadedAmmo(weapon),
    }))
    .filter(({ available }) => npcActor || available)
    .map(({ weapon, reload, available }) => {
      const slug = slugify(weapon.slug ?? weapon.system?.slug ?? weapon.name);
      return {
        id: `reload-weapon-${weapon.id ?? slug}`,
        name: t("Action.Reload", "Reload {weapon}", { weapon: weapon.name }),
        slug: `reload-${slug}`,
        actionCost: Math.max(1, Math.min(3, reload)),
        actionType: "action",
        source: "system-inferred",
        confidence: "medium",
        executable: "reload-weapon",
        detected: true,
        available,
        unavailableReason: available
          ? ""
          : t("Avail.WeaponAlreadyLoaded", "{weapon} is already loaded.", { weapon: weapon.name }),
        item: weapon,
        role: "setup",
        reload,
        autoFillEligible: !npcActor,
        activityProfile: { includes: ["reload"], reload: true, reloadCost: reload, free: false, weaponId: weapon.id, weaponName: weapon.name },
        targetingProfile: { self: true },
        setupFor: ["strike", "damage"],
        reasons: [t("Reason.ReloadWeapon", "Reload {weapon}.", { weapon: weapon.name })],
        traits: [],
        attackTrait: false,
      };
    });
}

// The stowed weapon's own Strike, for the attacks after "Draw X -> Strike" in the same turn. Only
// valid once the plan has drawn that weapon (the planner checks requiresDrawnWeaponId). Reload
// weapons are left out: their second shot needs a Reload the composite already accounts for.
function readAfterDrawStrikes(actor, readyStrikes, allStrikes) {
  const freeHands = actorFreeHands(actor);
  const drawable = new Set(readWeaponItems(actor).filter((weapon) => isDrawableWeapon(weapon, freeHands)).map((weapon) => weapon.id));
  const readyIds = new Set((readyStrikes ?? []).map((strike) => strike?.item?.id).filter(Boolean));
  return (allStrikes ?? [])
    .filter((strike) => !readyIds.has(strike?.item?.id) && strike?.altUsage !== "thrown" && drawable.has(strike?.item?.id)
      && !(Number(strike?.reload ?? strike?.item?.system?.reload?.value) > 0))
    .map((strike) => ({
      ...strike,
      id: `${strike.id ?? strike.slug}-after-draw`,
      ready: true,
      available: true,
      requiresDrawnWeaponId: strike.item.id,
      // Browse already lists "Draw X -> Strike"; this row only resolves the planner's follow-up.
      hideFromBuilder: true,
    }));
}

export function readWeaponActions(actor, context, readyStrikes, allStrikes = []) {
  // NPC Strikes are always ready in PF2e; inventory weapons stored as "worn" need no Draw.
  if (actor?.type === "npc" || actor?.isOfType?.("npc") === true) return readReloadWeaponActions(actor);
  return [
    ...readDrawStrikeActivities(actor, context, readyStrikes, allStrikes),
    ...readDrawWeaponActions(actor, allStrikes),
    ...readAfterDrawStrikes(actor, readyStrikes, allStrikes),
    ...readSheatheWeaponActions(actor),
    ...readReleaseWeaponActions(actor),
    ...readReloadWeaponActions(actor),
  ];
}
