import { collectionValues, systemValue, traitSlugs } from "../foundry-data.js";
import { slugify } from "../engine/action/text.js";
import { canAttackTarget, contextEnemies, contextTargets } from "../engine/target-pool.js";
import { readItemAvailability } from "./item-action-reader.js";
import { readyStrikeCanReach } from "./action/reach.js";
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

export function readWeaponActions(actor, context, readyStrikes) {
  return [
    ...readDrawStrikeActivities(actor, context, readyStrikes),
    ...readDrawWeaponActions(actor),
    ...readSheatheWeaponActions(actor),
    ...readReleaseWeaponActions(actor),
    ...readReloadWeaponActions(actor),
  ];
}
