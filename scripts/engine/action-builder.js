import { confidenceLabel } from "./confidence.js";
import { actionBudget } from "./planner.js";
import { requiresAreaMarkerForAction } from "./action-executor.js";
import { pf2eActionName, t } from "../i18n.js";

export const ACTION_BUILDER_TABS = [
  { id: "one", label: "1 Action", cost: 1 },
  { id: "two", label: "2 Actions", cost: 2 },
  { id: "three", label: "3 Actions", cost: 3 },
  { id: "free", label: "Free", cost: 0 },
  { id: "reaction", label: "Reaction", cost: "reaction" },
];

const TAB_BY_COST = new Map(ACTION_BUILDER_TABS.map((tab) => [tab.cost, tab]));
const TAB_IDS = ACTION_BUILDER_TABS.map((tab) => tab.id);
// Quickened's extra action is restricted to Strike and Stride (Haste's wording). Step is NOT allowed.
const QUICKENED_BUILDER_SLUGS = new Set(["strike", "stride"]);
const DESTINATION_ACTION_SLUGS = new Set(["crawl", "stride", "step", "stand-stride"]);
const ESCAPE_REMOVED_CONDITIONS = ["grabbed", "grappled", "immobilised", "immobilized", "restrained"];
const COMPOSITE_ATOMIC_PARTS = new Set(["crawl", "draw", "interact", "stand", "step", "stride"]);
const RAISE_SHIELD_SLUGS = new Set(["raise-a-shield"]);
const SHIELD_SPELL_SLUGS = new Set(["shield"]);
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

function draftStepSlugCandidates(step) {
  const action = step?.action ?? {};
  return [
    step?.slug,
    step?.actionKey,
    step?.key,
    action?.slug,
    action?.id,
    action?.name,
  ].map(actionSlugFromName).filter(Boolean);
}

function draftStepIsUsable(step) {
  return step && !step.stale && step.execution?.status !== "failed";
}

function draftStepGrantsRaisedShield(step) {
  if (!draftStepIsUsable(step)) return false;
  return draftStepSlugCandidates(step).some((slug) => RAISE_SHIELD_SLUGS.has(slug));
}

function draftStepGrantsShieldSpell(step) {
  if (!draftStepIsUsable(step)) return false;
  const action = step?.action ?? {};
  const slugs = draftStepSlugCandidates(step);
  if (!slugs.some((slug) => SHIELD_SPELL_SLUGS.has(slug))) return false;
  return String(action?.source ?? "").startsWith("spell")
    || action?.activityProfile?.spell === true
    || action?.item?.type === "spell"
    || action?.isCantrip === true;
}

function draftShieldCombatState(draft, { beforeInstanceId = null } = {}) {
  const state = {};
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  for (const step of steps) {
    if (beforeInstanceId && step?.instanceId === beforeInstanceId) break;
    if (draftStepGrantsRaisedShield(step)) state.raisedShieldActive = true;
    if (draftStepGrantsShieldSpell(step)) state.shieldSpellActive = true;
  }
  return state;
}

function actionIncludes(action, value) {
  return Array.isArray(action?.activityProfile?.includes)
    && action.activityProfile.includes.map((entry) => String(entry).toLowerCase()).includes(value);
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
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  return name.includes(" -> ") && (
    (hasAtomicPart && includesStrike)
    || (includes.has("stand") && includes.has("stride"))
    || (action.activityProfile?.drawsWeapon === true && includesStrike)
    || action.activityProfile?.retreatBeforeStrike === true
    || action.activityProfile?.retreatAfterStrike === true
  );
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

function atomicStrikeAction(action) {
  const leafName = stripCompositePrefix(actionName(action));
  return {
    ...action,
    id: compositeStrikeActionKey(action),
    name: leafName,
    slug: "strike",
    actionCost: 1,
    cost: 1,
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
  if (tactic === "flank") {
    const melee = positionalFinisherAtom(action.activityProfile.meleeStrike, action);
    return [positionalStrideAtom(action), melee].filter(Boolean);
  }
  if (tactic === "skirmish") {
    const finisher = action.activityProfile.finisher ?? null;
    const meleeAtom = positionalFinisherAtom(action.activityProfile.meleeStrike, action);
    const finisherAtom = positionalFinisherAtom(finisher?.ref ?? null, action);
    return [
      ...(meleeAtom ? [meleeAtom] : []),
      positionalStrideAtom(action),
      ...(finisherAtom ? [finisherAtom] : []),
    ];
  }
  return null;
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

  return parts.flatMap((part) => {
    const normalized = String(part).toLowerCase();
    if (["crawl", "stand", "step", "stride"].includes(normalized)) return atomicMovementAction(normalized) ?? [];
    if (normalized === "draw" || normalized === "interact") return [syntheticInteractAction()];
    if (normalized === "strike") return [atomicStrikeAction(action)];
    return [];
  });
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

function builderActionRows(actions, { includeSyntheticInteract = true } = {}) {
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
    if (isCompositeAtomicAction(action)) {
      needsInteract ||= needsSyntheticInteract(action);
      continue;
    }
    rows.push(action);
  }

  if (includeSyntheticInteract && needsInteract && !hasInteractAction(rows)) rows.push(syntheticInteractAction());
  return rows;
}

function valuesArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function requiresDestinationForAction(action) {
  if (!action) return false;

  // Move-and-strike activities (e.g. Sudden Charge) auto-plot their movement toward the
  // target and delegate any manual movement to separately-added uncounted Strides, so
  // the activity itself must not prompt for a destination even though it contains strides.
  // Checked first so a stale requiresDestination flag baked into an older draft step (added
  // before this rule) is overridden.
  if (action?.activityProfile?.includesStrike === true || actionIncludes(action, "strike")) return false;

  if (action.requiresDestination === true) return true;

  // Teleportation (e.g. Translocate) picks a destination like a Stride, but is delivered instantly
  // by the executor rather than animated movement.
  if (action?.activityProfile?.teleport === true) return true;

  const slug = String(action?.slug ?? "").toLowerCase();
  const source = String(action?.source ?? "").toLowerCase();
  const role = String(action?.role ?? "").toLowerCase();

  // Pure movement actions always need a destination.
  if (DESTINATION_ACTION_SLUGS.has(slug) || source === "movement" || role === "movement") return true;

  return actionIncludes(action, "stride")
    || actionIncludes(action, "step")
    || Number(action?.activityProfile?.strideCount) > 0;
}

// A Strike auto-filled with no reachable target and nothing to fix it is never useful: it is out
// of range from where it executes AND no earlier step moves the actor closer. (A Strike that
// follows a Stride is left alone — the move may bring it into range.) `projectedAction` is the
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

function numericPoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function targetCenter(target) {
  return numericPoint(target?.center) ?? numericPoint(target?.token?.center);
}

// Caster's own live center point, read fresh from context rather than any stale
// scoring-time value — mirrors the token-center convention used elsewhere in the engine
// layer (e.g. action-executor.js's `point(token?.center) ?? point(context?.token?.center)`).
function casterCenter(context) {
  return numericPoint(context?.token?.center);
}

function numericOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function areaMarkerDistance(action) {
  return numericOr(action?.targetingProfile?.distance ?? action?.targetingProfile?.radius, 5);
}

function areaMarkerWidth(action) {
  return numericOr(action?.targetingProfile?.width, 5);
}

function areaMarkerLabel(shape, distance) {
  return `${shape.charAt(0).toUpperCase()}${shape.slice(1)} ${distance} ft`;
}

// Turns a scored action's areaPlacementCenter/areaPlacementAimPoint (scoring.js) into a
// full marker object shaped like area-picker.js's initialAreaMarker output, so a computed
// marker behaves identically to a manually-placed one everywhere downstream. Pure and
// canvas-free beyond reading context.token's own position. Returns null when the action
// isn't area-shaped or when there's no valid placement to offer (caller falls back to
// manual placement).
export function computeAreaMarker(context, action) {
  if (!requiresAreaMarkerForAction(action)) return null;

  const type = String(action?.targetingProfile?.type ?? "").toLowerCase();
  const activityProfile = action?.activityProfile ?? {};
  const distance = areaMarkerDistance(action);
  const width = areaMarkerWidth(action);
  const originTokenId = context?.token?.id ?? context?.token?.uuid ?? null;

  if (type === "emanation") {
    const center = casterCenter(context);
    if (!center) return null;
    return {
      shape: "emanation",
      center,
      distance,
      width,
      rotation: 0,
      originTokenId,
      label: areaMarkerLabel("emanation", distance),
    };
  }

  if (type === "burst") {
    const center = numericPoint(activityProfile.areaPlacementCenter);
    if (!center) return null;
    return {
      shape: "burst",
      center,
      distance,
      width,
      rotation: 0,
      originTokenId,
      label: areaMarkerLabel("burst", distance),
    };
  }

  if (type === "cone" || type === "line") {
    const aimPoint = numericPoint(activityProfile.areaPlacementAimPoint);
    const origin = casterCenter(context);
    if (!aimPoint || !origin) return null;
    const rotation = Math.round((Math.atan2(aimPoint.y - origin.y, aimPoint.x - origin.x) * 180) / Math.PI);
    return {
      shape: type,
      center: origin,
      distance,
      width,
      rotation,
      originTokenId,
      label: areaMarkerLabel(type, distance),
    };
  }

  return null;
}

function gridCellCount(value) {
  return Math.max(1, Math.ceil(Number(value ?? 1) || 1));
}

// Footprint cell centers for a token centered on `center`, mirroring combat-context's
// distance measurement so projected distances match the unprojected ones.
function footprintCentersAt(center, width, height) {
  const size = Number(globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size) || 1;
  const cols = gridCellCount(width);
  const rows = gridCellCount(height);
  if ((cols === 1 && rows === 1) || cols * rows > 64) return [center];
  const x0 = center.x - (cols * size) / 2;
  const y0 = center.y - (rows * size) / 2;
  const centers = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      centers.push({ x: x0 + (col + 0.5) * size, y: y0 + (row + 0.5) * size });
    }
  }
  return centers;
}

function measurePathFeet(from, to) {
  try {
    const path = globalThis.canvas?.grid?.measurePath?.([from, to]);
    const distance = path?.distance ?? path;
    if (Number.isFinite(distance)) return distance;
  } catch (_error) {
    // Fall back to a grid-cell measurement when Foundry's measurePath is unavailable.
  }
  // Chebyshev (grid-reach) fallback so diagonal adjacency reads as one cell, not 1.41 cells —
  // matching how the readers compute reach. Euclidean here is what made a melee Strike after a
  // diagonal Stride report "No target in range".
  const size = Number(globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size) || 1;
  const gridDistance = Number(globalThis.canvas?.scene?.grid?.distance ?? globalThis.canvas?.grid?.distance) || size;
  const cells = Math.round(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / size);
  return cells * gridDistance;
}

// Footprint/grid-aware distance from an actor centered on `origin` to a target, taking the
// nearest cells of both footprints (consistent with combat-context's measureDistance).
function footprintDistanceFeet(origin, originToken, target) {
  const center = targetCenter(target);
  if (!origin || !center) return null;
  const fromCenters = footprintCentersAt(origin, originToken?.width, originToken?.height);
  const toCenters = footprintCentersAt(center, target?.width ?? target?.token?.width, target?.height ?? target?.token?.height);
  let shortest = Infinity;
  for (const from of fromCenters) {
    for (const to of toCenters) {
      shortest = Math.min(shortest, measurePathFeet(from, to));
    }
  }
  return Number.isFinite(shortest) ? shortest : null;
}

function draftActionSlug(step) {
  const raw = step?.slug
    ?? step?.action?.slug
    ?? step?.actionKey
    ?? step?.key
    ?? "";
  return String(raw).toLowerCase().split("#")[0];
}

function draftStepRemovedConditions(step) {
  const slug = draftActionSlug(step);
  const profile = step?.action?.activityProfile ?? {};
  const included = new Set(valuesArray(profile.includes).map((entry) => String(entry).toLowerCase()));
  const removed = new Set(valuesArray(profile.removesCondition)
    .concat(valuesArray(profile.removesConditions))
    .map((entry) => String(entry).toLowerCase())
    .filter(Boolean));

  if (slug === "stand" || slug === "stand-stride" || included.has("stand")) removed.add("prone");
  if (slug === "escape") {
    for (const condition of ESCAPE_REMOVED_CONDITIONS) removed.add(condition);
  }
  return removed;
}

function draftStepAddedConditions(step) {
  const slug = draftActionSlug(step);
  const profile = step?.action?.activityProfile ?? {};
  const added = new Set(valuesArray(profile.appliesCondition)
    .concat(valuesArray(profile.appliesConditions))
    .concat(valuesArray(profile.appliedCondition))
    .map((entry) => String(entry).toLowerCase())
    .filter(Boolean));

  if (slug.includes("drop-prone") || step?.action?.executable === "drop-prone") added.add("prone");
  return added;
}

function draftConditionChanges(draft, { beforeInstanceId = null } = {}) {
  const added = new Set();
  const removed = new Set();
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  for (const step of steps) {
    if (beforeInstanceId && step?.instanceId === beforeInstanceId) break;
    for (const condition of draftStepRemovedConditions(step)) {
      added.delete(condition);
      removed.add(condition);
    }
    for (const condition of draftStepAddedConditions(step)) {
      removed.delete(condition);
      added.add(condition);
    }
  }
  return { added, removed };
}

function removeConditions(conditions, removed) {
  if (!conditions || !removed?.size) return conditions;

  if (Array.isArray(conditions)) {
    return conditions.filter((condition) => !removed.has(String(condition?.slug ?? condition).toLowerCase()));
  }

  const next = { ...conditions };
  if (Array.isArray(next.slugs)) {
    next.slugs = next.slugs.filter((slug) => !removed.has(String(slug).toLowerCase()));
  }
  if (next.values && typeof next.values === "object") {
    next.values = { ...next.values };
    for (const condition of removed) delete next.values[condition];
  }
  return next;
}

function removeProfileConditions(profile, removed) {
  if (!profile || !removed?.size) return profile;
  return {
    ...profile,
    conditions: removeConditions(profile.conditions, removed),
  };
}

function addConditions(conditions, added) {
  if (!added?.size) return conditions;

  if (Array.isArray(conditions)) {
    const existing = new Set(conditions.map((condition) => String(condition?.slug ?? condition).toLowerCase()));
    return [
      ...conditions,
      ...[...added].filter((condition) => !existing.has(condition)),
    ];
  }

  const next = { ...(conditions ?? {}) };
  const slugs = Array.isArray(next.slugs) ? [...next.slugs] : [];
  const values = { ...(next.values ?? {}) };
  for (const condition of added) {
    if (!slugs.includes(condition)) slugs.push(condition);
    values[condition] = Math.max(1, Number(values[condition]) || 0);
  }
  return { ...next, slugs, values };
}

function addProfileConditions(profile, added) {
  if (!profile || !added?.size) return profile;
  return {
    ...profile,
    conditions: addConditions(profile.conditions, added),
  };
}

function conditionChangeSets(changes) {
  if (changes instanceof Set) return { removed: changes, added: new Set() };
  return {
    removed: changes?.removed instanceof Set ? changes.removed : new Set(),
    added: changes?.added instanceof Set ? changes.added : new Set(),
  };
}

function projectProfileConditions(profile, changes) {
  const { removed, added } = conditionChangeSets(changes);
  return addProfileConditions(removeProfileConditions(profile, removed), added);
}

function projectConditionState(context, changes) {
  const { removed, added } = conditionChangeSets(changes);
  if (!removed.size && !added.size) return context;
  const nextProfile = projectProfileConditions(context?.profile, changes);
  const actorProfile = projectProfileConditions(context?.actor?.profile, changes);
  return {
    ...context,
    ...(nextProfile ? { profile: nextProfile } : {}),
    actor: context?.actor
      ? {
        ...context.actor,
        ...(actorProfile ? { profile: actorProfile } : {}),
      }
      : context?.actor,
  };
}

function projectShieldCombatProfile(profile, shieldState) {
  if (!profile || (!shieldState?.raisedShieldActive && !shieldState?.shieldSpellActive)) return profile;
  return {
    ...profile,
    combatState: {
      ...(profile.combatState ?? {}),
      ...(shieldState.raisedShieldActive ? { raisedShieldActive: true } : {}),
      ...(shieldState.shieldSpellActive ? { shieldSpellActive: true } : {}),
    },
  };
}

function projectShieldCombatState(context, shieldState) {
  if (!shieldState?.raisedShieldActive && !shieldState?.shieldSpellActive) return context;
  const nextProfile = projectShieldCombatProfile(context?.profile ?? {}, shieldState);
  const actorProfile = projectShieldCombatProfile(context?.actor?.profile ?? {}, shieldState);
  return {
    ...context,
    profile: nextProfile,
    actor: context?.actor
      ? {
        ...context.actor,
        profile: actorProfile,
      }
      : context?.actor,
  };
}

function projectTargetDistance(target, origin, originToken) {
  const center = targetCenter(target);
  if (!center) return target;
  const distance = footprintDistanceFeet(origin, originToken, target);
  return Number.isFinite(distance) ? { ...target, distance } : target;
}

function projectTargetList(targets, origin, originToken) {
  return Array.isArray(targets)
    ? targets.map((target) => projectTargetDistance(target, origin, originToken))
    : targets;
}

function draftStepLooksLikeDestinationStep(step) {
  if (step?.requiresDestination === true) return true;
  if (requiresDestinationForAction(step?.action)) return true;
  const slug = String(step?.slug ?? step?.action?.slug ?? "").toLowerCase();
  const key = String(step?.actionKey ?? step?.key ?? "").toLowerCase();
  return DESTINATION_ACTION_SLUGS.has(slug)
    || DESTINATION_ACTION_SLUGS.has(key)
    || slug.includes("stride")
    || key.includes("stride")
    || slug.includes("step")
    || key.includes("step");
}

function lastDraftDestination(draft, { beforeInstanceId = null } = {}) {
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  const uncounted = Array.isArray(draft?.uncounted) ? draft.uncounted : [];
  const inUncounted = beforeInstanceId != null
    && uncounted.some((step) => step?.instanceId === beforeInstanceId);

  let destination = null;
  const scan = (list, stopAtBefore) => {
    for (const step of list) {
      if (stopAtBefore && beforeInstanceId && step?.instanceId === beforeInstanceId) break;
      if (!draftStepLooksLikeDestinationStep(step)) continue;
      const stepDestination = numericPoint(step?.destination);
      if (stepDestination) destination = stepDestination;
    }
  };

  // Uncounted steps run after the plan, so an uncounted stride starts where the
  // plan's movement ended (scan all plan steps) and then chains off any earlier
  // uncounted stride. Plan steps only chain within the plan.
  if (inUncounted) {
    scan(steps, false);
    scan(uncounted, true);
  } else {
    scan(steps, true);
  }
  return destination;
}

function projectContextToOrigin(context, destination, conditionChanges = new Set(), shieldState = {}) {
  if (!context) return context;
  const stateContext = projectShieldCombatState(projectConditionState(context, conditionChanges), shieldState);
  if (!destination) return stateContext;

  const battlefield = stateContext.battlefield ?? {};
  const originToken = stateContext.token ?? null;
  return {
    ...stateContext,
    token: {
      ...(stateContext.token ?? {}),
      center: destination,
      plannedCenter: destination,
    },
    battlefield: {
      ...battlefield,
      targets: projectTargetList(battlefield.targets, destination, originToken),
      enemies: projectTargetList(battlefield.enemies, destination, originToken),
      allies: projectTargetList(battlefield.allies, destination, originToken),
    },
    targets: projectTargetList(stateContext.targets, destination, originToken),
    enemies: projectTargetList(stateContext.enemies, destination, originToken),
    allies: projectTargetList(stateContext.allies, destination, originToken),
  };
}

export function projectContextForDraftDestination(context, draft) {
  return projectContextToOrigin(
    context,
    lastDraftDestination(draft),
    draftConditionChanges(draft),
    draftShieldCombatState(draft),
  );
}

export function projectContextForDraftStepOrigin(context, draft, instanceId) {
  const options = { beforeInstanceId: instanceId };
  return projectContextToOrigin(
    context,
    lastDraftDestination(draft, options),
    draftConditionChanges(draft, options),
    draftShieldCombatState(draft, options),
  );
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
  if (action?.available === false || action?.disabled === true) {
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

function favoriteApplies(favorites, key, baseKey, baseKeyCounts) {
  if (favorites.has(key)) return true;
  return baseKeyCounts.get(baseKey) === 1 && favorites.has(baseKey);
}

function decorateAction(action, { key, baseKey, favorites, baseKeyCounts, normalRemaining, quickenedRemaining, reactionPlanned }) {
  const cost = normalizeCost(action?.actionCost ?? action?.cost);
  const tab = tabForCost(cost);
  const availabilityWarning = action?.available === false || action?.disabled === true ? actionUnavailableReason(action) : "";
  const disabled = disabledState(action, cost, { normalRemaining, quickenedRemaining, reactionPlanned });
  const confidence = action?.confidence ?? "low";
  return {
    ...action,
    key,
    baseKey,
    tabId: tab.id,
    cost,
    favorite: favoriteApplies(favorites, key, baseKey, baseKeyCounts),
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
        disabled: false,
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

function showDisabledInBuilder(action) {
  return Boolean(action);
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
  return Array.isArray(draft?.steps)
    ? draft.steps.map((step) => decorateDraftStep(step, actionByKey, uniqueBaseKeys, draftStepActions))
    : [];
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
  // The dedicated sustained-spells section handles sustaining, so no "Sustain a Spell" action
  // is injected into the builder tabs.
  const normalizedCandidates = builderActionRows(candidates ?? []);
  const draftOnlyActions = builderActionRows(normalizeDraftOnlyActions(unavailableActions, rejected), { includeSyntheticInteract: false });
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

  for (const action of decoratedActions) {
    tabs[action.tabId].all.push(action);
  }
  for (const action of decoratedDraftOnlyActions.filter(showDisabledInBuilder)) {
    tabs[action.tabId].all.push(action);
  }

  for (const tab of Object.values(tabs)) {
    tab.favorites = tab.all.filter((action) => action.favorite);
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
