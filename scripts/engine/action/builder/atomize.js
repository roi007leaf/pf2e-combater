// Splits one composite action (a feat/activity bundling e.g. Stride+Stride+Strike) into the
// separate atomic steps the panel actually plans and executes -- reload-before-strike, consumable
// activation, positional (Flank/Skirmish) tactics, and generic multi-part composites all funnel
// through builderAtomicActionsForStep, the single entry point external callers use.
import { slugify } from "../text.js";
import { pf2eActionName, t } from "../../../i18n.js";
import { actionBuilderKey, actionName } from "./shared.js";
import { npcReloadWeaponKey } from "../../npc-reload-state.js";

const COMPOSITE_ATOMIC_PARTS = new Set(["crawl", "draw", "interact", "stand", "step", "stride"]);
const GENERATED_COMPOSITE_PREFIXES = [
  "stand-stride-strike-",
  "stride-strike-stride-",
  "stride-away-strike-",
  "stride-strike-",
  "draw-strike-",
];
const SYNTHETIC_INTERACT_ACTION = {
  id: "interact",
  name: "Interact",
  slug: "interact",
  actionCost: 1,
  source: "generic",
  role: "utility",
  confidence: "medium",
  detected: true,
  available: true,
  executable: "chat-guidance",
  activityProfile: { includes: ["interact"] },
  reason: "Draw, retrieve, or manipulate an item.",
};

// Localized copy of the synthetic Interact action; resolved at call time so i18n is ready
// (the const above keeps English fields as the headless/self-test fallback).
export function syntheticInteractAction(overrides = {}) {
  return {
    ...SYNTHETIC_INTERACT_ACTION,
    name: pf2eActionName("interact", SYNTHETIC_INTERACT_ACTION.name),
    reason: t("Reason.InteractItem", "Draw, retrieve, or manipulate an item."),
    ...overrides,
  };
}

function syntheticReloadAction(action, reloadCost) {
  const weaponName = String(action?.name ?? action?.item?.name ?? "weapon").replace(/^Reload\s*->\s*/i, "").trim();
  const weaponKey = npcReloadWeaponKey(action) ?? action?.item?.id ?? action?.weapon?.id;
  return {
    id: weaponKey ? `reload-weapon-${weaponKey}` : `${action?.id ?? action?.slug ?? "strike"}-reload`,
    name: pf2eActionName("reload", "Reload"),
    slug: `reload-${slugify(weaponName) || "weapon"}`,
    actionCost: reloadCost,
    source: "generic",
    role: "utility",
    confidence: action?.confidence ?? "medium",
    detected: true,
    available: true,
    executable: "reload-weapon",
    item: action?.item ?? null,
    activityProfile: {
      includes: ["reload"],
      reload: true,
      reloadCost,
      weaponId: weaponKey,
      weaponName,
    },
    reason: t("Reason.ReloadBeforeStrike", "Reload before firing {name}.", { name: weaponName }),
  };
}

function reloadBeforeStrikeAtoms(action) {
  const reloadCost = Number(action?.reloadCost ?? action?.activityProfile?.reloadCost);
  const totalCost = Number(action?.actionCost ?? action?.cost);
  if (action?.activityProfile?.reloadBeforeStrike !== true
    || !Number.isFinite(reloadCost)
    || reloadCost <= 0
    || !Number.isFinite(totalCost)
    || totalCost <= reloadCost) {
    return null;
  }

  const strikeName = String(action?.name ?? "").replace(/^Reload\s*->\s*/i, "").trim() || action?.name;
  return [
    syntheticReloadAction(action, reloadCost),
    {
      ...action,
      id: `${action?.id ?? action?.slug ?? "strike"}-strike`,
      name: strikeName,
      actionCost: Math.max(1, totalCost - reloadCost),
      cost: Math.max(1, totalCost - reloadCost),
      reloadCost: 0,
      activityProfile: {
        ...(action?.activityProfile ?? {}),
        reloadBeforeStrike: false,
        reloadCost: 0,
      },
    },
  ];
}

export function actionIncludedParts(action) {
  return new Set(Array.isArray(action?.activityProfile?.includes)
    ? action.activityProfile.includes.map((entry) => String(entry).toLowerCase())
    : []);
}

// Same source as actionIncludedParts, but keeps every repeated entry instead of deduping into a
// Set. Composite steps that need N Strides encode that as N "stride" entries in `includes`
// (see strideCount in action-reader.js's readStrideStrikeActivities) — anything iterating this
// list to build one atomic action per entry must not collapse repeats down to one.
function actionIncludedPartsList(action) {
  return Array.isArray(action?.activityProfile?.includes)
    ? action.activityProfile.includes.map((entry) => String(entry).toLowerCase())
    : [];
}

function stripInteractPrefix(name) {
  const value = String(name ?? "").trim();
  return value.replace(/^Interact\s*->\s*/i, "").trim() || value;
}

function stripCompositePrefix(name) {
  const parts = String(name ?? "").split(/\s*->\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? String(name ?? "").trim();
}

function actionSlugFromName(name) {
  return slugify(name);
}

export function hasConsumableInteractDraw(action) {
  const drawCost = Number(action?.interactDrawCost);
  return Number.isFinite(drawCost) && drawCost > 0;
}

export function builderActivationAction(action) {
  if (!hasConsumableInteractDraw(action)) return null;
  const drawCost = Number(action.interactDrawCost);
  const activationCost = Number(action.activationActionCost ?? Number(action.actionCost) - drawCost);
  if (!Number.isFinite(activationCost) || activationCost <= 0) return null;

  const baseKey = actionBuilderKey(action);
  const includes = actionIncludedParts(action);
  includes.delete("interact");
  return {
    ...action,
    id: `${baseKey}-activation`,
    name: stripInteractPrefix(actionName(action)),
    actionCost: activationCost,
    cost: activationCost,
    interactDrawCost: 0,
    activityProfile: {
      ...(action.activityProfile ?? {}),
      includes: [...includes],
      interactDraw: false,
    },
    displayOnlyActivation: true,
  };
}

export function isCompositeAtomicAction(action) {
  if (!action) return false;
  if (hasConsumableInteractDraw(action)) return true;

  const id = String(actionBuilderKey(action)).toLowerCase();
  const slug = String(action.slug ?? "").toLowerCase();
  const name = actionName(action);
  if (slug === "stand-stride" || id === "stand-stride") return true;

  if (GENERATED_COMPOSITE_PREFIXES.some((prefix) => slug.startsWith(prefix) || id.startsWith(prefix))) return true;

  const includes = actionIncludedParts(action);
  const hasAtomicPart = [...COMPOSITE_ATOMIC_PARTS].some((part) => includes.has(part));
  const includesStrike = action.activityProfile?.includesStrike === true || includes.has("strike");
  return action.activityProfile?.requiresDistinctTargets === true
    || action.activityProfile?.requiresBackingStrike === true
    || (name.includes(" -> ") && (
      (hasAtomicPart && includesStrike)
      || (includes.has("stand") && includes.has("stride"))
      || (action.activityProfile?.drawsWeapon === true && includesStrike)
      || action.activityProfile?.retreatBeforeStrike === true
      || action.activityProfile?.retreatAfterStrike === true
    ));
}

function compositeStrikeActionKey(action) {
  const values = [
    String(actionBuilderKey(action)).toLowerCase(),
    String(action?.slug ?? "").toLowerCase(),
  ];
  for (const value of values) {
    for (const prefix of GENERATED_COMPOSITE_PREFIXES) {
      if (!value.startsWith(prefix)) continue;
      const suffix = value.slice(prefix.length);
      if (!suffix) continue;
      return suffix.startsWith("strike-") ? suffix : `strike-${suffix}`;
    }
  }

  const leafName = stripCompositePrefix(actionName(action));
  const leafSlug = actionSlugFromName(leafName);
  return leafSlug ? `strike-${leafSlug}` : actionBuilderKey(action);
}

function atomicMovementAction(part) {
  const slug = String(part ?? "").toLowerCase();
  const labels = {
    crawl: "Crawl",
    stand: "Stand",
    step: "Step",
    stride: "Stride",
  };
  if (!labels[slug]) return null;
  return {
    id: slug,
    name: labels[slug],
    slug,
    actionCost: 1,
    source: "generic",
    role: "mobility",
    confidence: "medium",
    detected: true,
    available: true,
    executable: "chat-guidance",
    activityProfile: {
      includes: slug === "stand" ? ["move"] : ["move", slug],
      ...(slug === "stand" ? { removesCondition: "prone" } : {}),
      ...(slug === "crawl" ? { crawlDistance: 5 } : {}),
    },
  };
}

export function backingStrikeOverrideFields(backingStrike, leafName) {
  if (!backingStrike) return { name: leafName };
  return {
    name: `${leafName} -> ${backingStrike.name}`,
    executable: backingStrike.executable,
    source: backingStrike.source,
    item: backingStrike.item,
    strike: backingStrike.strike,
    variants: backingStrike.variants,
    attack: backingStrike.attack,
    damage: backingStrike.damage,
    damageProfile: backingStrike.damageProfile,
    averageDamage: backingStrike.averageDamage,
    critical: backingStrike.critical,
    traits: backingStrike.traits,
    weaponTraits: backingStrike.weaponTraits,
    range: backingStrike.range,
    reload: backingStrike.reload,
  };
}

function atomicStrikeAction(action, targetOverride, costOverride, strikeOccurrence) {
  const leafName = stripCompositePrefix(actionName(action));
  const backingStrike = action.activityProfile?.requiresDualBackingStrike
    ? action.activityProfile?.backingStrikes?.[strikeOccurrence ?? 0]
    : (action.activityProfile?.requiresDistinctTargets || action.activityProfile?.requiresBackingStrike)
      ? action.activityProfile?.backingStrike
      : null;
  const cost = Number.isFinite(costOverride) ? costOverride : 1;
  const distinctTargetSlug = action.activityProfile?.requiresDistinctTargets ? String(action.slug ?? "").trim() : "";
  // distinctTargetsFor (scoring.js) hands back raw battlefield-enemy entries, which have no
  // `.type` field — unlike suggestedTargetFor's targetRef(target, "enemy") wrapping for an
  // ordinary Strike. action-preview.js's hover highlight gates on suggestedTarget.type ===
  // "enemy", so a distinct-target atom silently failed that check and never highlighted its
  // target on hover, even though its own target label resolved correctly.
  const distinctTarget = targetOverride ? { type: "enemy", ...targetOverride } : null;
  return {
    ...action,
    ...backingStrikeOverrideFields(backingStrike, leafName),
    id: compositeStrikeActionKey(action),
    slug: distinctTargetSlug || "strike",
    actionCost: cost,
    cost,
    ...(distinctTarget ? { preferredTarget: distinctTarget, suggestedTarget: distinctTarget } : {}),
    activityProfile: {
      ...(action.activityProfile ?? {}),
      includes: ["strike"],
      includesStrike: true,
      strideCount: 0,
      retreatBeforeStrike: false,
      retreatAfterStrike: false,
      drawsWeapon: false,
    },
    requiresDestination: false,
  };
}

// Stride atom whose destination is the pre-computed flank/retreat square. Carrying the
// destination directly means auto-fill copies it as-is and skips the target-aimed
// "did this Stride get closer?" filter — the whole point of a deliberate flank/kite move.
function positionalStrideAtom(action) {
  const stride = atomicMovementAction("stride");
  const attackCenter = action?.activityProfile?.attackCenter ?? null;
  const rawStrikeReach = action?.activityProfile?.strikeReach;
  const strikeReach = rawStrikeReach === null || rawStrikeReach === undefined || rawStrikeReach === ""
    ? NaN
    : Number(rawStrikeReach);
  return {
    ...stride,
    preferredTarget: action?.preferredTarget ?? stride.preferredTarget ?? null,
    requiresDestination: true,
    ...(attackCenter ? { destination: attackCenter } : {}),
    activityProfile: {
      ...(stride.activityProfile ?? {}),
      ...(attackCenter ? { attackCenter } : {}),
      ...(Number.isFinite(strikeReach) ? { strikeReach } : {}),
      ...(strikeReach === 0 ? { allowTargetOverlap: true } : {}),
      positionalStride: true,
    },
    targetingProfile: action?.targetingProfile ?? stride.targetingProfile ?? null,
  };
}

// A finisher/prepend atom is the stored Strike or spell candidate, re-pointed at the
// composite's target so it resolves against the right enemy.
function positionalFinisherAtom(ref, action) {
  if (!ref) return null;
  return { ...ref, preferredTarget: action?.preferredTarget ?? ref.preferredTarget ?? null };
}

function positionalTacticAtoms(action) {
  const tactic = action?.activityProfile?.positionalTactic;
  let atoms = null;
  if (tactic === "flank") {
    const melee = positionalFinisherAtom(action.activityProfile.meleeStrike, action);
    atoms = [positionalStrideAtom(action), melee].filter(Boolean);
  } else if (tactic === "skirmish") {
    const finisher = action.activityProfile.finisher ?? null;
    const meleeAtom = positionalFinisherAtom(action.activityProfile.meleeStrike, action);
    const finisherAtom = positionalFinisherAtom(finisher?.ref ?? null, action);
    atoms = [
      ...(meleeAtom ? [meleeAtom] : []),
      positionalStrideAtom(action),
      ...(finisherAtom ? [finisherAtom] : []),
    ];
  } else {
    return null;
  }

  // A positional tactic (Flank, Skirmish) is one 2-3 action activity (Stride(s) + Strike(s))
  // bundled into a single composite -- the exact same shape as a requiresBackingStrike feat like
  // Sudden Charge, so group its atoms the same way: one shared groupId/groupLabel so the panel
  // nests them under one header, with the composite's own full action cost on the first atom only.
  // Without this, the panel showed a bare "Stride" and a bare weapon Strike as two disconnected-
  // looking rows with no visible link between them -- and specifically, the Strike atom's own MAP
  // badge/target chip (MAP and target only ever apply to an attack, never a plain Stride) looked
  // like they'd been slapped onto "just movement" instead of visibly belonging to the nested Strike.
  if (atoms.length < 2) return atoms;
  const groupId = action.id ?? action.slug;
  const groupLabel = action.name;
  const totalCost = Number(action.actionCost ?? action.cost ?? 1);
  return atoms.map((atom, index) => ({
    ...atom,
    actionCost: index === 0 ? totalCost : 0,
    cost: index === 0 ? totalCost : 0,
    groupId,
    groupLabel,
    atomIndex: index,
    groupItem: action.item ?? null,
    groupUuid: action.uuid ?? null,
    groupTraits: action.traits ?? [],
  }));
}

// stride-strike / stride-multiattack / stride-away-strike / stride-strike-stride readers all
// pre-compute a reach-validated activityProfile.attackCenter for the Stride(s) that close (or open)
// the distance -- but only the LAST Stride before the attack lands on that exact square; an earlier
// Stride in a 2-Stride approach has no known intermediate stopping point, and a retreat Stride after
// the attack (stride-strike-stride's return-to-cover) targets a different, unrecorded square.
function finalApproachMovementIndex(parts) {
  const firstNonMoveIndex = parts.findIndex((part) => !["crawl", "stand", "step", "stride"].includes(String(part).toLowerCase()));
  if (firstNonMoveIndex <= 0) return -1;
  for (let index = firstNonMoveIndex - 1; index >= 0; index -= 1) {
    if (["step", "stride"].includes(String(parts[index]).toLowerCase())) return index;
  }
  return -1;
}

export function builderAtomicActionsForStep(action) {
  const reloadAtoms = reloadBeforeStrikeAtoms(action);
  if (reloadAtoms) return reloadAtoms;

  const activation = builderActivationAction(action);
  if (activation) {
    return [
      syntheticInteractAction({ actionCost: Number(action.interactDrawCost) || 1 }),
      activation,
    ];
  }

  const positional = positionalTacticAtoms(action);
  if (positional) return positional;

  if (!isCompositeAtomicAction(action)) return action ? [action] : [];

  const parts = actionIncludedPartsList(action);
  if (!parts.length) return [action];

  const distinctTargets = action.activityProfile?.requiresDistinctTargets ? action.activityProfile?.distinctTargets : null;
  if (action.activityProfile?.requiresDistinctTargets && !distinctTargets?.length) return action ? [action] : [];

  const attackCenter = action.activityProfile?.attackCenter ?? null;
  const approachMovementIndex = attackCenter ? finalApproachMovementIndex(parts) : -1;

  let strikeOccurrence = 0;
  const atoms = parts.flatMap((part, partIndex) => {
    const normalized = String(part).toLowerCase();
    if (["crawl", "stand", "step", "stride"].includes(normalized)) {
      const baseAtom = atomicMovementAction(normalized);
      const atom = normalized === "stride" && action?.movementAction
        ? { ...baseAtom, movementAction: action.movementAction }
        : baseAtom;
      if (!atom) return [];
      if (["step", "stride"].includes(normalized) && partIndex === approachMovementIndex) {
        const rawStrikeReach = action.activityProfile?.strikeReach;
        const strikeReach = rawStrikeReach === null || rawStrikeReach === undefined || rawStrikeReach === ""
          ? NaN
          : Number(rawStrikeReach);
        return [{
          ...atom,
          destination: attackCenter,
          preferredTarget: action?.preferredTarget ?? atom.preferredTarget ?? null,
          targetingProfile: action?.targetingProfile ?? atom.targetingProfile ?? null,
          activityProfile: {
            ...atom.activityProfile,
            attackCenter,
            ...(Number.isFinite(strikeReach) ? { strikeReach } : {}),
            ...(strikeReach === 0 ? { allowTargetOverlap: true } : {}),
          },
        }];
      }
      return [atom];
    }
    if (normalized === "draw" || normalized === "interact") return [syntheticInteractAction()];
    if (normalized === "strike") {
      const occurrenceIndex = strikeOccurrence;
      const targetOverride = distinctTargets ? distinctTargets[strikeOccurrence] : undefined;
      const costOverride = action.activityProfile?.requiresDistinctTargets
        ? (strikeOccurrence === 0 ? Number(action.actionCost ?? action.cost ?? 1) : 0)
        : undefined;
      strikeOccurrence += 1;
      return [atomicStrikeAction(action, targetOverride, costOverride, occurrenceIndex)];
    }
    return [];
  });

  // A backed move-and-strike feat (e.g. Sudden Charge: Stride twice, then a real weapon Strike)
  // costs its own stated total once, not once per atom -- the first atom carries the full cost,
  // every atom after it is free, mirroring how a distinct-target composite's own atoms already
  // share cost. Every atom (Strides included, not just the Strike atomicStrikeAction already
  // stamps) gets the SAME group id/label and its own position index, since Strides and Strikes are
  // built by two different functions that otherwise share no identity -- this is what lets the
  // panel nest them under one header and re-match a persisted step back to its exact atom later.
  if (action.activityProfile?.requiresBackingStrike && atoms.length > 1) {
    const groupId = compositeStrikeActionKey(action);
    const groupLabel = String(action.name ?? "").split(" -> ").pop();
    // readStrideMultiattackActivities prepends Stride atom(s) it generated at suggestion time onto
    // an ability -- those leading atoms are genuinely separate PF2e actions, so they keep their own
    // normal cost and stay out of the group instead of folding into "1 group, cost on the first
    // atom" with Rush/Sudden Charge's intrinsic movement and Strike.
    const precedingMoveAtomCount = Number(action.activityProfile?.precedingMoveAtomCount) || 0;
    const leadingAtoms = atoms.slice(0, precedingMoveAtomCount);
    const groupedAtoms = atoms.slice(precedingMoveAtomCount);
    const totalCost = precedingMoveAtomCount > 0
      ? Number(action.activityProfile?.abilityActionCost ?? action.actionCost ?? action.cost ?? 1)
      : Number(action.actionCost ?? action.cost ?? 1);
    return [
      ...leadingAtoms,
      ...groupedAtoms.map((atom, index) => ({
        ...atom,
        actionCost: index === 0 ? totalCost : 0,
        cost: index === 0 ? totalCost : 0,
        groupId,
        groupLabel,
        atomIndex: index,
        // The atom's own .item/.traits get overridden to whatever weapon backs THAT strike
        // (atomicStrikeAction/backingStrikeOverrideFields) -- capture the ability's own identity
        // here, before that override, so the group header can open and show traits for the
        // ability itself (e.g. Flurry of Blows: Monk, Flourish) instead of the backing weapon.
        groupItem: action.item ?? null,
        groupUuid: action.uuid ?? null,
        groupTraits: action.traits ?? [],
      })),
    ];
  }
  return atoms;
}
