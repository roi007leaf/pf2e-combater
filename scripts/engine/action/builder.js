import { confidenceLabel } from "../confidence.js";
import { actionBudget } from "./budget.js";
import { slugify } from "./text.js";
import { actionIncludes, isDestinationActionSlug, requiresDestinationForAction } from "./requirements.js";
import { draftStepIsUsable } from "./builder-projection.js";
import { pf2eActionName, t } from "../../i18n.js";

export {
  computeAreaMarker,
  projectContextForDraftDestination,
  projectContextForDraftStepOrigin,
} from "./builder-projection.js";

export const ACTION_BUILDER_TABS = [
  { id: "one", label: "1 Action", cost: 1 },
  { id: "two", label: "2 Actions", cost: 2 },
  { id: "three", label: "3 Actions", cost: 3 },
  { id: "free", label: "Free", cost: 0 },
  { id: "reaction", label: "Reaction", cost: "reaction" },
];

const TAB_BY_COST = new Map(ACTION_BUILDER_TABS.map((tab) => [tab.cost, tab]));
const TAB_IDS = ACTION_BUILDER_TABS.map((tab) => tab.id);
const COMMAND_ANIMAL_SLUG = "command-an-animal";
const MINION_ACTION_SOURCE = "minion-action";
// Quickened's extra action is restricted to Strike and Stride (Haste's wording). Step is NOT allowed.
const QUICKENED_BUILDER_SLUGS = new Set(["strike", "stride"]);
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
function syntheticInteractAction(overrides = {}) {
  return {
    ...SYNTHETIC_INTERACT_ACTION,
    name: pf2eActionName("interact", SYNTHETIC_INTERACT_ACTION.name),
    reason: t("Reason.InteractItem", "Draw, retrieve, or manipulate an item."),
    ...overrides,
  };
}

// No longer injected into the builder tabs (the sustained-spells section handles sustaining),
// but kept as a self-contained template the section uses to build a Sustain step.
export const SUSTAIN_A_SPELL_ACTION = {
  id: "sustain-a-spell",
  name: "Sustain a Spell",
  slug: "sustain-a-spell",
  actionCost: 1,
  source: "generic",
  role: "utility",
  confidence: "medium",
  detected: true,
  available: true,
  executable: "chat-guidance",
  activityProfile: { includes: ["concentrate", "sustain"] },
  reason: "Spend 1 action to extend a sustained spell's duration.",
};

// A spell with a "sustained" duration can be kept active next round with Sustain a Spell.
// Sustain a Spell is a NEXT-turn action, so it's offered whenever the caster has a sustainable
// spell in their repertoire/available actions — not because one was cast this turn.
function hasSustainableSpellCandidate(candidates) {
  return (Array.isArray(candidates) ? candidates : []).some(
    (action) => action?.activityProfile?.sustained === true,
  );
}

// Only true casters (with a spellcasting entry) can Sustain a Spell.
function actorHasSpellcastingEntry(context) {
  const actor = context?.actor?.document ?? context?.actor ?? null;
  const entries = actor?.itemTypes?.spellcastingEntry
    ?? actor?.spellcasting?.contents
    ?? actor?.spellcasting;
  if (Array.isArray(entries)) return entries.length > 0;
  if (entries && typeof entries.size === "number") return entries.size > 0;
  if (entries && typeof entries[Symbol.iterator] === "function") return [...entries].length > 0;
  return false;
}

export function actionBuilderKey(action) {
  return action?.id
    ?? action?.uuid
    ?? action?.item?.uuid
    ?? action?.slug
    ?? action?.name
    ?? "unknown-action";
}

function normalizeCost(cost) {
  if (cost === "reaction") return "reaction";
  const numeric = Number(cost);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(1, Math.min(3, numeric));
}

function readValidCost(cost) {
  if (cost === "reaction") return "reaction";
  if (cost === null || cost === undefined || cost === "") return null;
  const numeric = Number(cost);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric === 0) return 0;
  return Math.max(1, Math.min(3, numeric));
}

function tabForCost(cost) {
  return TAB_BY_COST.get(normalizeCost(cost)) ?? TAB_BY_COST.get(1);
}

function scoreValue(action) {
  const score = Number(action?.score);
  return Number.isFinite(score) ? score : 0;
}

function actionName(action) {
  return String(action?.name ?? action?.label ?? actionBuilderKey(action));
}

function draftUsage(steps) {
  const usableSteps = Array.isArray(steps) ? steps : [];
  return usableSteps.reduce((usage, step) => {
    if (step?.stale) return usage;
    const cost = draftStepCost(step);
    if (cost === "reaction") {
      usage.reaction += 1;
    } else if (cost > 0) {
      usage.normal += cost;
      if (quickenedEligible(step?.action, cost)) usage.quickenedEligibleCost += cost;
    }
    return usage;
  }, { normal: 0, reaction: 0, quickenedEligibleCost: 0 });
}

function draftStepCost(step) {
  return firstValidCost(step?.actionCost, step?.cost, step?.action?.actionCost, step?.action?.cost);
}

function firstValidCost(...costs) {
  for (const cost of costs) {
    const normalized = readValidCost(cost);
    if (normalized !== null) return normalized;
  }
  return 0;
}

function quickenedEligible(action, cost) {
  return cost === 1 && (QUICKENED_BUILDER_SLUGS.has(action?.slug) || action?.source === "strike");
}

// Quickened Casting (and similar "reduce your next spell's action cost" setups) is flagged by the
// classifier but otherwise inert until a step here actually applies the discount.
function isActionDiscountStep(step) {
  return step?.action?.activityProfile?.actionDiscount === true;
}

// Matches the granting ability's own wording: "an arcane spontaneous spell." Rank caps ("8th level
// or lower") aren't enforced -- see the design doc for why this is an accepted simplification.
function isDiscountEligibleSpell(step) {
  const action = step?.action;
  if (!action || !String(action.source ?? "").startsWith("spell")) return false;
  return String(action.spellcastingEntryTradition ?? "").toLowerCase() === "arcane"
    && String(action.spellcastingEntryType ?? "").toLowerCase() === "spontaneous";
}

// The discount is spent on the very next usable step regardless of whether it qualifies (mirrors
// the ability's "if your next action is X" wording -- an unrelated next action wastes it). Runs
// after decoration so it's recomputed fresh every render; nothing is mutated on the stored draft.
function applyQuickenedCastingDiscount(steps) {
  let pending = false;
  return steps.map((step) => {
    if (!draftStepIsUsable(step)) return step;
    let updated = step;
    if (pending && isDiscountEligibleSpell(step) && typeof step.actionCost === "number" && step.actionCost >= 1) {
      const discounted = Math.max(1, step.actionCost - 1);
      updated = { ...step, actionCost: discounted, cost: discounted, quickenedCastingDiscount: true };
    }
    pending = isActionDiscountStep(step);
    return updated;
  });
}

const QUICKENING_SLUGS = new Set(["haste"]);

// A drafted action grants quickened (an extra Stride/Strike) when it's Haste, when the engine
// flagged it as granting an extra action, or when it explicitly applies the "quickened" condition.
function actionGrantsQuickened(action) {
  if (!action) return false;
  if (QUICKENING_SLUGS.has(String(action.slug ?? "").toLowerCase())) return true;
  const profile = action.activityProfile ?? {};
  if (profile.extraAction === true) return true;
  const conditionLists = [profile.appliesConditions, action.appliesConditions];
  return conditionLists.some((list) =>
    Array.isArray(list) && list.map((entry) => String(entry).toLowerCase()).includes("quickened"),
  );
}

// The quickening step benefits the current combatant only when it targets them: the chosen target
// is the current token, or it's a self-only action with no explicit target (i.e. cast on the caster).
function quickeningStepTargetsCurrent(step, currentTokenId) {
  const ids = Array.isArray(step?.targetTokenIds) ? step.targetTokenIds : [];
  if (currentTokenId && ids.includes(currentTokenId)) return true;
  if (!ids.length) {
    const targeting = step?.action?.targetingProfile ?? {};
    return targeting.self === true && targeting.ally !== true && targeting.enemy !== true;
  }
  return false;
}

// During planning the quickened condition isn't applied yet, so anticipate the extra action when a
// drafted quickening spell targets the current combatant (e.g. self-cast Haste).
function draftAnticipatesQuickened(resolvedSteps, context) {
  const currentTokenId = context?.token?.id ?? null;
  return (Array.isArray(resolvedSteps) ? resolvedSteps : []).some(
    (step) =>
      step
      && !step.stale
      && actionGrantsQuickened(step.action)
      && quickeningStepTargetsCurrent(step, currentTokenId),
  );
}

function actionIncludedParts(action) {
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

function hasConsumableInteractDraw(action) {
  const drawCost = Number(action?.interactDrawCost);
  return Number.isFinite(drawCost) && drawCost > 0;
}

function builderActivationAction(action) {
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

function isCompositeAtomicAction(action) {
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
  return {
    ...stride,
    preferredTarget: action?.preferredTarget ?? stride.preferredTarget ?? null,
    requiresDestination: true,
    ...(attackCenter ? { destination: attackCenter } : {}),
    activityProfile: {
      ...(stride.activityProfile ?? {}),
      ...(attackCenter ? { attackCenter } : {}),
      positionalStride: true,
    },
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
function finalApproachStrideIndex(parts) {
  const firstNonMoveIndex = parts.findIndex((part) => !["crawl", "stand", "step", "stride"].includes(String(part).toLowerCase()));
  if (firstNonMoveIndex <= 0) return -1;
  for (let index = firstNonMoveIndex - 1; index >= 0; index -= 1) {
    if (String(parts[index]).toLowerCase() === "stride") return index;
  }
  return -1;
}

export function builderAtomicActionsForStep(action) {
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
  const approachStrideIndex = attackCenter ? finalApproachStrideIndex(parts) : -1;

  let strikeOccurrence = 0;
  const atoms = parts.flatMap((part, partIndex) => {
    const normalized = String(part).toLowerCase();
    if (["crawl", "stand", "step", "stride"].includes(normalized)) {
      const atom = atomicMovementAction(normalized);
      if (!atom) return [];
      if (normalized === "stride" && partIndex === approachStrideIndex) {
        return [{ ...atom, destination: attackCenter, activityProfile: { ...atom.activityProfile, attackCenter } }];
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
    // an ability with no movement of its own -- those leading atoms are a genuinely separate PF2e
    // action from the multiattack, so they keep their own normal cost and stay out of the group,
    // instead of folding into "1 group, cost on the first atom" like Sudden Charge's intrinsic Stride.
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

function needsSyntheticInteract(action) {
  if (hasConsumableInteractDraw(action)) return true;
  const includes = actionIncludedParts(action);
  return includes.has("draw") || includes.has("interact") || action.activityProfile?.drawsWeapon === true;
}

function hasInteractAction(actions) {
  return actions.some((action) => String(action?.slug ?? "").toLowerCase() === "interact"
    || actionBuilderKey(action) === "interact");
}

function builderActionRows(actions, { includeSyntheticInteract = true, keepComposites = false } = {}) {
  const rows = [];
  let needsInteract = false;
  for (const action of Array.isArray(actions) ? actions : []) {
    if (!action) continue;
    const activation = builderActivationAction(action);
    if (activation) {
      needsInteract = true;
      rows.push(activation);
      continue;
    }
    // A composite (e.g. Rush, Sudden Charge) can't be queued through this row's plain single-step
    // add -- it needs builderAtomicActionsForStep's Stride/Strike split -- so it's normally kept out
    // of the addable candidate list entirely. keepComposites is for the browse-only "why is this
    // rejected" display, where the row is informational (or, per the caller, still added through
    // that same atomizer) rather than a raw single-step push.
    if (!keepComposites && isCompositeAtomicAction(action)) {
      needsInteract ||= needsSyntheticInteract(action);
      continue;
    }
    rows.push(action);
  }

  if (includeSyntheticInteract && needsInteract && !hasInteractAction(rows)) rows.push(syntheticInteractAction());
  return rows;
}

function minionActionBudget(action, plan = action?.activityProfile?.minionPlan) {
  const value = Number(plan?.actionBudget ?? action?.activityProfile?.minionActionBudget ?? 2);
  return Math.max(1, Math.min(3, Number.isFinite(value) ? Math.round(value) : 2));
}

function isMinionCommandAction(action) {
  return String(action?.slug ?? "").toLowerCase() === COMMAND_ANIMAL_SLUG
    && action?.activityProfile?.minionPlan;
}

function minionPlanFromDraftStep(step) {
  return step?.activityProfile?.minionPlan ?? step?.action?.activityProfile?.minionPlan ?? null;
}

function minionDraftPlanForAction(draft, action) {
  const plan = action?.activityProfile?.minionPlan;
  const minionId = String(plan?.minionId ?? "");
  const minionName = String(plan?.minionName ?? "").toLowerCase();
  const commandKey = String(actionBuilderKey(action));
  for (const step of draft?.steps ?? []) {
    const stepPlan = minionPlanFromDraftStep(step);
    if (!stepPlan) continue;
    const sameMinion = minionId
      ? String(stepPlan.minionId ?? "") === minionId
      : String(stepPlan.minionName ?? "").toLowerCase() === minionName;
    if (!sameMinion) continue;
    const stepKeys = [
      step?.actionKey,
      step?.key,
      step?.action?.key,
      step?.action?.baseKey,
      step?.action?.slug,
      step?.slug,
    ].map((value) => String(value ?? ""));
    if (stepKeys.includes(commandKey) || stepKeys.includes(COMMAND_ANIMAL_SLUG)) return stepPlan;
  }
  return null;
}

function uniqueMinionOptions(plan) {
  const seen = new Set();
  const options = [];
  for (const value of [
    ...(Array.isArray(plan?.actionOptions) ? plan.actionOptions : []),
    ...(Array.isArray(plan?.steps) ? plan.steps : []),
  ]) {
    const name = String(value ?? "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    options.push(name);
  }
  return options;
}

function minionBrowseRole(option) {
  const slug = slugify(option);
  if (["stride", "step", "leap", "stand", "drop-prone"].includes(slug)) return "mobility";
  if (slug === "seek") return "utility";
  return "damage";
}

function minionBrowseRow(commandAction, option, index, draft) {
  const plan = commandAction.activityProfile.minionPlan;
  const existingPlan = minionDraftPlanForAction(draft, commandAction);
  const budget = minionActionBudget(commandAction, existingPlan ?? plan);
  const used = Array.isArray(existingPlan?.steps) ? existingPlan.steps.length : 0;
  const hasOpenCommand = Boolean(existingPlan && used < budget);
  const minion = String(plan.minionName ?? t("MinionPlan.Minion", "Companion")).trim()
    || t("MinionPlan.Minion", "Companion");
  const actionName = String(option ?? "").trim() || t("Panel.UnknownAction", "Unknown action");
  const commandKey = actionBuilderKey(commandAction);
  return {
    ...commandAction,
    id: `${commandKey}::minion::${slugify(actionName)}::${index}`,
    name: t("MinionPlan.BrowseActionName", "{minion}: {action}", { minion, action: actionName }),
    slug: `minion-${slugify(actionName)}`,
    source: MINION_ACTION_SOURCE,
    role: minionBrowseRole(actionName),
    score: scoreValue(commandAction) + Math.max(0, 100 - index) / 100000,
    actionCost: 1,
    cost: 1,
    tabCost: 1,
    budgetCost: hasOpenCommand ? 0 : 1,
    hideFromBuilder: false,
    hideUncounted: true,
    minionCommandKey: commandKey,
    minionCommandAction: commandAction,
    minionActionName: actionName,
    minionActionBudget: budget,
    minionPlanFull: Boolean(existingPlan && used >= budget),
    reason: hasOpenCommand
      ? t("MinionPlan.BrowseAppendReason", "Add {action} to {minion}'s commanded turn.", { action: actionName, minion })
      : t("MinionPlan.BrowseStartReason", "Spend 1 action to command {minion}; add {action} as its first minion action.", { action: actionName, minion }),
    activityProfile: {
      ...(commandAction.activityProfile ?? {}),
      minionBrowseAction: true,
      minionActionName: actionName,
      minionActionBudget: budget,
      minionPlan: { ...plan, actionBudget: budget },
    },
  };
}

function expandMinionCommandRows(actions, draft) {
  const rows = [];
  for (const action of actions) {
    if (!isMinionCommandAction(action)) {
      rows.push(action);
      continue;
    }
    const budget = minionActionBudget(action);
    const commandAction = {
      ...action,
      name: t("MinionPlan.CommandAction", "Command Companion"),
      hideFromBuilder: true,
      activityProfile: {
        ...(action.activityProfile ?? {}),
        minionActionBudget: budget,
        minionPlan: {
          ...action.activityProfile.minionPlan,
          actionBudget: budget,
        },
      },
    };
    rows.push(commandAction);
    uniqueMinionOptions(commandAction.activityProfile.minionPlan)
      .forEach((option, index) => rows.push(minionBrowseRow(commandAction, option, index, draft)));
  }
  return rows;
}

// A Strike auto-filled with no reachable target and nothing to fix it is never useful: it is out
// of range from where it executes AND no earlier step moves the actor closer. (A Strike that
// follows a Stride is left alone; the move may bring it into range.) `projectedAction` is the
// step's action resolved from its projected origin; `hasEarlierMove` is whether any prior draft
// step is a movement step.
export function isUnreachableStrikeStep(projectedAction, hasEarlierMove) {
  if (!projectedAction) return false;
  const isStrike = projectedAction.source === "strike"
    || projectedAction.attackTrait === true
    || projectedAction.activityProfile?.includesStrike === true;
  if (!isStrike || projectedAction.available !== false) return false;
  const reason = String(projectedAction.unavailableReason ?? projectedAction.disabledReason ?? "").toLowerCase();
  const noReachableTarget = reason.includes("range") || reason.includes("no target");
  return noReachableTarget && !hasEarlierMove;
}

function targetLabel(action) {
  const target = action?.suggestedTarget ?? action?.preferredTarget ?? action?.target;
  const name = target?.name ?? target?.label;
  return name ? t("Label.Target", "Target: {name}", { name }) : "";
}

function actionUnavailableReason(action) {
  return action?.disabledReason
    || action?.unavailableReason
    || action?.rejectionReason
    || action?.reason
    || t("Disabled.NoLongerAvailable", "Action is no longer available.");
}

// `overBudget` marks actions that do not fit the turn's action economy (no actions
// left, or a reaction already planned). The normal-plan "+" refuses these; the
// off-budget uncounted "+" ignores it. `disabled` stays false either way so
// the row remains visible and interactive (e.g. hover preview, uncounted add).
function disabledState(action, cost, { normalRemaining, quickenedRemaining, reactionPlanned }) {
  if (action?.minionPlanFull === true) {
    return {
      disabled: false,
      disabledReason: t("MinionPlan.NoActionsLeft", "Companion has no actions left."),
      overBudget: true,
    };
  }

  // A rejected candidate (e.g. no attackable enemy target right now) keeps `available` true --
  // only the ITEM's own usability is false/true, not whether this moment's context has a valid
  // target -- so normalizeDraftOnlyActions' pre-computed disabledReason is the only signal that
  // this row needs its warning surfaced instead of falling through to the budget checks below,
  // which would silently overwrite it with an empty reason.
  if (action?.available === false || action?.disabled === true || action?.disabledReason) {
    return {
      disabled: false,
      disabledReason: actionUnavailableReason(action),
      overBudget: false,
    };
  }

  if (cost === "reaction" && reactionPlanned) {
    return {
      disabled: false,
      disabledReason: t("Disabled.ReactionPlanned", "Reaction already planned."),
      overBudget: true,
    };
  }

  const remainingActions = quickenedEligible(action, cost)
    ? normalRemaining + quickenedRemaining
    : normalRemaining;
  if (typeof cost === "number" && cost > 0 && cost > remainingActions) {
    return {
      disabled: false,
      disabledReason: t("Disabled.NotEnoughActions", "Not enough actions remaining."),
      overBudget: true,
    };
  }

  return { disabled: false, disabledReason: "", overBudget: false };
}

function favoriteEntryKey(favorites, key, baseKey, baseKeyCounts) {
  if (favorites.has(key)) return key;
  if (baseKeyCounts.get(baseKey) === 1 && favorites.has(baseKey)) return baseKey;
  return null;
}

function decorateAction(action, { key, baseKey, favorites, baseKeyCounts, normalRemaining, quickenedRemaining, reactionPlanned }) {
  const cost = normalizeCost(action?.tabCost ?? action?.actionCost ?? action?.cost);
  const budgetCost = normalizeCost(action?.budgetCost ?? action?.actionCost ?? action?.cost);
  const tab = tabForCost(cost);
  const availabilityWarning = action?.available === false || action?.disabled === true ? actionUnavailableReason(action) : "";
  const disabled = disabledState(action, budgetCost, { normalRemaining, quickenedRemaining, reactionPlanned });
  const confidence = action?.confidence ?? "low";
  const favoriteEntry = favoriteEntryKey(favorites, key, baseKey, baseKeyCounts);
  return {
    ...action,
    key,
    baseKey,
    tabId: tab.id,
    cost,
    budgetCost,
    favorite: favoriteEntry !== null,
    favoriteEntryKey: favoriteEntry,
    ...disabled,
    availabilityWarning,
    targetLabel: targetLabel(action),
    reason: action?.reason ?? action?.reasons?.[0] ?? "",
    confidenceLabel: confidenceLabel(confidence),
    confidenceClass: String(confidence),
  };
}

function stableActionIdentity(action, baseKey) {
  return [
    action?.item?.uuid,
    action?.uuid,
    action?.source,
    action?.slug,
    action?.name,
    action?.label,
    action?.actionCost,
    action?.cost,
    baseKey,
  ].map((part) => String(part ?? "")).join("\u0000");
}

function assignActionKeys(actions) {
  const baseKeyCounts = new Map();
  const entries = actions.map((action, index) => {
    const baseKey = actionBuilderKey(action);
    baseKeyCounts.set(baseKey, (baseKeyCounts.get(baseKey) ?? 0) + 1);
    return { action, baseKey, index, identity: stableActionIdentity(action, baseKey) };
  });

  const entriesByBaseKey = new Map();
  for (const entry of entries) {
    if (!entriesByBaseKey.has(entry.baseKey)) entriesByBaseKey.set(entry.baseKey, []);
    entriesByBaseKey.get(entry.baseKey).push(entry);
  }

  const keyByIndex = new Map();
  for (const [baseKey, duplicateEntries] of entriesByBaseKey) {
    const stableEntries = duplicateEntries.toSorted((left, right) => {
      const identityDelta = left.identity.localeCompare(right.identity);
      if (identityDelta !== 0) return identityDelta;
      return left.index - right.index;
    });
    stableEntries.forEach((entry, duplicateIndex) => {
      keyByIndex.set(entry.index, duplicateIndex === 0 ? baseKey : `${baseKey}#${duplicateIndex + 1}`);
    });
  }

  const keyedActions = entries.map((entry) => ({
    action: entry.action,
    baseKey: entry.baseKey,
    key: keyByIndex.get(entry.index),
  }));
  return { keyedActions, baseKeyCounts };
}

function normalizeDraftOnlyActions(unavailableActions, rejected) {
  return [...(unavailableActions ?? []), ...(rejected ?? [])]
    .map((entry) => {
      const action = entry?.action ?? entry;
      if (!action) return null;

      const rejectionReason = entry?.reason;
      const disabledReason = action.disabledReason ?? action.unavailableReason ?? rejectionReason;
      return {
        ...action,
        disabled: action.disabled ?? true,
        ...(disabledReason ? { disabledReason } : {}),
        ...(rejectionReason ? { rejectionReason } : {}),
      };
    })
    .filter(Boolean);
}

function draftResolutionMap(keyedActions, draftOnlyActions, draftFallbackActions = []) {
  const { keyedActions: keyedDraftFallbackActions } = assignActionKeys(draftFallbackActions);
  const { keyedActions: keyedDraftOnlyActions } = assignActionKeys(draftOnlyActions);
  const draftKeyedActions = [...keyedActions];
  const actionByKey = new Map(keyedActions.map(({ key, action }) => [key, action]));

  for (const entry of keyedDraftFallbackActions) {
    if (actionByKey.has(entry.key)) continue;
    draftKeyedActions.push(entry);
    actionByKey.set(entry.key, entry.action);
  }

  for (const entry of keyedDraftOnlyActions) {
    if (actionByKey.has(entry.key)) continue;
    draftKeyedActions.push(entry);
    actionByKey.set(entry.key, entry.action);
  }

  const baseKeyCounts = new Map();
  for (const { baseKey } of draftKeyedActions) {
    baseKeyCounts.set(baseKey, (baseKeyCounts.get(baseKey) ?? 0) + 1);
  }
  const uniqueBaseKeys = new Map(draftKeyedActions
    .filter(({ baseKey }) => baseKeyCounts.get(baseKey) === 1)
    .map(({ key, baseKey }) => [baseKey, key]));

  return { actionByKey, uniqueBaseKeys };
}

function emptyTabs() {
  return Object.fromEntries(TAB_IDS.map((id) => [
    id,
    {
      ...ACTION_BUILDER_TABS.find((tab) => tab.id === id),
      all: [],
      favorites: [],
      quickened: [],
      recommended: [],
    },
  ]));
}

function quickenedShelfActions(actions) {
  return actions
    .filter((action) => quickenedEligible(action, action.cost))
    .toSorted((left, right) => {
      if (left.disabled !== right.disabled) return left.disabled ? 1 : -1;
      const scoreDelta = scoreValue(right) - scoreValue(left);
      if (scoreDelta !== 0) return scoreDelta;
      return actionName(left).localeCompare(actionName(right));
    });
}

function disabledActionReason(action) {
  return String(
    action?.disabledReason
      ?? action?.unavailableReason
      ?? action?.rejectionReason
      ?? action?.reason
      ?? "",
  ).toLowerCase();
}

// Rejected/unavailable actions are only surfaced in Browse when the rejection itself is
// informative to a player deciding what to do next turn (a blocked/inapplicable movement, or
// Elemental Blast which is always shown so its disabled reason explains why). Everything else
// that's merely unavailable right now (an unprepared spell, an out-of-range strike, ...) stays
// out of the visible tabs -- it still resolves via draftOnlyActions for stale draft steps.
function showDisabledInBuilder(action) {
  if (!action?.disabled && action?.available !== false) return false;
  if (action?.tacticSlug === "elemental-blast") return true;

  const slug = String(action?.slug ?? "").toLowerCase();
  const role = String(action?.role ?? "").toLowerCase();
  const isMovementAction = isDestinationActionSlug(slug)
    || role === "mobility"
    || role === "movement"
    || actionIncludes(action, "move")
    || actionIncludes(action, "stride")
    || actionIncludes(action, "step")
    || Number(action?.activityProfile?.strideCount) > 0;
  if (isMovementAction) return true;

  const reason = disabledActionReason(action);
  return reason.includes("move actions are unavailable")
    || reason.includes("collision-free movement path")
    || reason.includes("movement path");
}

function draftStepActionOverride(step, draftStepActions) {
  if (!step?.instanceId || !draftStepActions) return null;
  if (draftStepActions instanceof Map) return draftStepActions.get(step.instanceId) ?? null;
  if (typeof draftStepActions === "object") return draftStepActions[step.instanceId] ?? null;
  return null;
}

function decorateDraftStep(step, actionByKey, uniqueBaseKeys, draftStepActions = null) {
  const key = step?.actionKey ?? step?.key ?? actionBuilderKey(step);
  const resolvedAction = actionByKey.get(key) ?? (uniqueBaseKeys.has(key) ? actionByKey.get(uniqueBaseKeys.get(key)) : null) ?? null;
  const baseAction = draftStepActionOverride(step, draftStepActions) ?? resolvedAction;
  // A re-resolved action loses the per-step movement type the player pinned (fly/burrow/...). Carry
  // it back onto the action so the destination picker, executor, and cost engine all Stride on the
  // chosen speed rather than reverting to walking.
  const movementAction = typeof step?.movementAction === "string" ? step.movementAction : null;
  const action = baseAction && movementAction ? { ...baseAction, movementAction } : baseAction;
  const stale = !action;
  const missingDestination = requiresDestinationForAction(action) && !step?.destination;
  const unavailableWarning = action?.availabilityWarning || (action?.available === false ? actionUnavailableReason(action) : "");
  const plannedCost = draftStepCost({ ...step, action });
  return {
    ...step,
    key,
    action,
    cost: plannedCost,
    actionCost: plannedCost,
    stale,
    warning: stale
      ? t("Disabled.NoLongerAvailable", "Action is no longer available.")
      : unavailableWarning || (missingDestination ? t("Warning.ChooseDestExec", "Choose destination at execution.") : ""),
  };
}

function resolveDraftSteps(draft, actionByKey, uniqueBaseKeys, draftStepActions = null) {
  if (!Array.isArray(draft?.steps)) return [];
  const decorated = draft.steps.map((step) => decorateDraftStep(step, actionByKey, uniqueBaseKeys, draftStepActions));
  return applyQuickenedCastingDiscount(decorated);
}

export function buildActionBuilderModel({
  context,
  candidates,
  draftFallbackActions = [],
  unavailableActions = [],
  rejected = [],
  plans = [],
  draft,
  draftStepActions = null,
  favorites = new Set(),
}) {
  const budget = actionBudget(context);
  const tabs = emptyTabs();
  const favoriteSet = favorites instanceof Set ? favorites : new Set(favorites ?? []);
  // Sets iterate in insertion order, which is already the user's favorite-order (see
  // action-favorites.js) -- capture it once here for sorting tab.favorites below.
  const favoriteOrder = [...favoriteSet];
  // The dedicated sustained-spells section handles sustaining, so no "Sustain a Spell" action
  // is injected into the builder tabs.
  // Composites (Rush, Sudden Charge, ...) used to be hidden from Browse entirely because a manual
  // "+" push had no way to split them into their Stride/Strike atoms -- CombaterPanel._addAction
  // now atomizes on add the same way Auto-fill does (builderAtomicActionsForStep), so nothing is
  // ever hidden from Browse just because the planner also knows how to use it.
  const normalizedCandidates = expandMinionCommandRows(
    builderActionRows(candidates ?? [], { keepComposites: true }),
    draft,
  );
  const draftOnlyActions = builderActionRows(normalizeDraftOnlyActions(unavailableActions, rejected), { includeSyntheticInteract: false, keepComposites: true });
  const { keyedActions, baseKeyCounts } = assignActionKeys(normalizedCandidates);
  const sortedKeyedActions = [...keyedActions].toSorted((left, right) => {
    const scoreDelta = scoreValue(right.action) - scoreValue(left.action);
    if (scoreDelta !== 0) return scoreDelta;
    return actionName(left.action).localeCompare(actionName(right.action));
  });
  const fallbackDraftActions = builderActionRows(
    Array.isArray(draftFallbackActions) ? draftFallbackActions.filter(Boolean) : [],
    { includeSyntheticInteract: false },
  );
  const rawDraftResolution = draftResolutionMap(keyedActions, draftOnlyActions, fallbackDraftActions);
  const resolvedDraftSteps = resolveDraftSteps(draft, rawDraftResolution.actionByKey, rawDraftResolution.uniqueBaseKeys, draftStepActions);
  const usage = draftUsage(resolvedDraftSteps);
  // Anticipate Haste-style quickened during planning: the condition isn't applied until the spell
  // executes, so a drafted quickening spell aimed at the current combatant grants the extra action now.
  const anticipatedQuickened = draftAnticipatesQuickened(resolvedDraftSteps, context) ? 1 : 0;
  const quickenedActions = Math.max(budget.quickenedActions ?? 0, anticipatedQuickened);
  const quickenedUsed = Math.min(quickenedActions, usage.quickenedEligibleCost);
  const normalUsed = usage.normal - quickenedUsed;
  const normalRemaining = Math.max(0, budget.normalActions - normalUsed);
  const quickenedRemaining = Math.max(0, quickenedActions - quickenedUsed);
  const remainingNormalActions = normalRemaining;
  const remainingQuickenedActions = quickenedRemaining;
  const remainingTotalActions = Math.max(0, budget.normalActions + quickenedActions - usage.normal);
  const remainingActions = remainingNormalActions;
  const reactionPlanned = usage.reaction > 0;
  const decoratedActions = sortedKeyedActions
    .map(({ action, key, baseKey }) => decorateAction(action, {
      key,
      baseKey,
      favorites: favoriteSet,
      baseKeyCounts,
      normalRemaining,
      quickenedRemaining,
      reactionPlanned,
    }));
  const { keyedActions: keyedDraftOnlyActions } = assignActionKeys(draftOnlyActions);
  const { keyedActions: keyedDraftFallbackActions } = assignActionKeys(fallbackDraftActions);
  const decoratedDraftFallbackActions = keyedDraftFallbackActions
    .filter(({ key }) => !decoratedActions.some((action) => action.key === key))
    .map(({ action, key, baseKey }) => decorateAction(action, {
      key,
      baseKey,
      favorites: favoriteSet,
      baseKeyCounts,
      normalRemaining,
      quickenedRemaining,
      reactionPlanned,
    }));
  const decoratedDraftOnlyActions = keyedDraftOnlyActions
    .filter(({ key }) => !decoratedActions.some((action) => action.key === key)
      && !decoratedDraftFallbackActions.some((action) => action.key === key))
    .map(({ action, key, baseKey }) => decorateAction(action, {
      key,
      baseKey,
      favorites: favoriteSet,
      baseKeyCounts,
      normalRemaining,
      quickenedRemaining,
      reactionPlanned,
    }));
  const actionByKey = new Map(decoratedActions.map((action) => [action.key, action]));
  for (const action of decoratedDraftFallbackActions) {
    if (!actionByKey.has(action.key)) actionByKey.set(action.key, action);
  }
  for (const action of decoratedDraftOnlyActions) {
    if (!actionByKey.has(action.key)) actionByKey.set(action.key, action);
  }
  const decoratedDraftResolution = draftResolutionMap(
    decoratedActions.map((action) => ({
      action,
      key: action.key,
      baseKey: action.baseKey,
    })),
    decoratedDraftOnlyActions,
    decoratedDraftFallbackActions,
  );
  const draftSteps = resolveDraftSteps(draft, actionByKey, decoratedDraftResolution.uniqueBaseKeys, draftStepActions);

  for (const action of decoratedActions.filter((entry) => entry.hideFromBuilder !== true)) {
    tabs[action.tabId].all.push(action);
  }
  for (const action of decoratedDraftOnlyActions.filter(showDisabledInBuilder)) {
    tabs[action.tabId].all.push(action);
  }

  for (const tab of Object.values(tabs)) {
    tab.favorites = tab.all
      .filter((action) => action.favorite)
      .toSorted((left, right) => favoriteOrder.indexOf(left.favoriteEntryKey) - favoriteOrder.indexOf(right.favoriteEntryKey));
    tab.quickened = [];
    tab.recommended = tab.all.filter((action) => !action.disabled).slice(0, 3);
  }
  if (quickenedRemaining > 0) {
    tabs.one.quickened = quickenedShelfActions([
      ...decoratedActions,
      ...decoratedDraftFallbackActions,
      ...decoratedDraftOnlyActions,
    ]);
  }

  return {
    context,
    actionBudget: budget,
    usage,
    remainingActions,
    remainingNormalActions,
    remainingQuickenedActions,
    remainingTotalActions,
    tabs,
    draft: {
      ...(draft ?? {}),
      steps: draftSteps,
      uncounted: resolveDraftSteps({ steps: draft?.uncounted ?? [] }, actionByKey, decoratedDraftResolution.uniqueBaseKeys, draftStepActions),
      warnings: draftSteps.filter((step) => step.warning).map((step) => step.warning),
    },
    autoFill: plans[0] ?? null,
  };
}
