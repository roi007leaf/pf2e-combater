import {
  actionBuilderKey,
  backingStrikeOverrideFields,
  builderAtomicActionsForStep,
  projectContextForDraftStepOrigin,
  SUSTAIN_A_SPELL_ACTION,
} from "../../engine/action/builder/index.js";
import { plannedTargetSelection } from "../../engine/action/executor.js";
import { buildCandidates } from "../../engine/candidates.js";
import { contextEnemies, contextTargets } from "../../engine/target-pool.js";
import { actorStrikeOptions } from "../../readers/action/reader.js";
import { actionCanReach } from "../../readers/action/reach.js";
import { contextProfile, meleeReach } from "../../readers/action/reader-helpers.js";
import { pf2eActionName, t } from "../../i18n.js";
import {
  isSustainAction,
  withBuilderActionFields,
} from "./view-model.js";

const AUTO_FILL_BASIC_MOVE_SLUGS = new Set(["stride", "step", "stand-stride"]);

export function isAutoFillGeneratedStep(step) {
  return step?.autoFillGenerated === true;
}

export function draftForAutoFillGap(draft) {
  return {
    ...(draft ?? {}),
    steps: (draft?.steps ?? []).filter((step) => !isAutoFillGeneratedStep(step)),
  };
}

export function hasLockedDraftSteps(draft) {
  return draftForAutoFillGap(draft).steps.length > 0;
}

export function draftNormalActionCost(draft) {
  return draftForAutoFillGap(draft).steps.reduce((total, step) => {
    const cost = Number(step?.actionCost ?? step?.cost ?? step?.action?.actionCost ?? step?.action?.cost ?? 0);
    return Number.isFinite(cost) && cost > 0 ? total + cost : total;
  }, 0);
}

export function isBasicAutoFillMove(stepOrSlug) {
  const slug = typeof stepOrSlug === "string"
    ? stepOrSlug
    : stepOrSlug?.slug;
  return AUTO_FILL_BASIC_MOVE_SLUGS.has(String(slug ?? "").toLowerCase());
}

export function isRedundantAutoFillMove(step) {
  return isBasicAutoFillMove(step)
    && step?.source === "generic"
    && Number(step?.score) < 0;
}

export function autoFillAppliesProne(step) {
  const slug = String(step?.slug ?? "").toLowerCase();
  return slug.includes("drop-prone") || step?.executable === "drop-prone";
}

export function autoFillTargetCenter(step) {
  const target = step?.preferredTarget ?? step?.suggestedTarget ?? step?.target;
  const embedded = target?.token?.center ?? target?.center ?? null;
  if (embedded || !target) return embedded;
  const ids = [target.id, target.uuid, target.actor?.id, target.actor?.uuid].filter(Boolean);
  if (!ids.length) return null;
  for (const token of globalThis.canvas?.tokens?.placeables ?? []) {
    const document = token?.document ?? token;
    const matches = ids.some((id) =>
      token?.id === id || token?.uuid === id || document?.id === id || document?.uuid === id
      || token?.actor?.id === id || document?.actor?.id === id);
    if (matches) return token?.center ?? null;
  }
  return null;
}

export function strideImprovesPosition(originCenter, destination, targetCenter) {
  if (!destination || !originCenter) return true;
  const gridSize = Number(globalThis.canvas?.grid?.size) || 0;
  const minGain = gridSize > 0 ? gridSize * 0.5 : 1;
  if (!targetCenter) {
    return Math.hypot(destination.x - originCenter.x, destination.y - originCenter.y) >= minGain;
  }
  const before = Math.hypot(targetCenter.x - originCenter.x, targetCenter.y - originCenter.y);
  const after = Math.hypot(targetCenter.x - destination.x, targetCenter.y - destination.y);
  return (before - after) >= minGain;
}

export function autoFillStrideOverSpeed(originCenter, destination, profile) {
  const measure = globalThis.canvas?.grid?.measurePath;
  const speed = Number(profile?.speed?.value ?? profile?.speed ?? profile?.landSpeed) || 0;
  if (!originCenter || !destination || typeof measure !== "function" || speed <= 0) return false;
  try {
    const cost = Number(measure([originCenter, destination])?.distance);
    return Number.isFinite(cost) && cost > speed + 0.01;
  } catch (_error) {
    return false;
  }
}

export function strideStepTowardPlannedTarget(step, atomicSteps, index) {
  if (step?.preferredTarget || step?.suggestedTarget) return step;
  for (let next = index + 1; next < atomicSteps.length; next += 1) {
    const selection = plannedTargetSelection(atomicSteps[next]);
    if (selection.targets.length) return { ...step, preferredTarget: selection.targets[0] };
  }
  return step;
}

function stripDuplicateKeySuffix(value) {
  return String(value ?? "").replace(/#\d+$/u, "");
}

function draftStepLookupKeys(step) {
  return new Set([
    step?.actionKey,
    step?.key,
    actionBuilderKey(step),
    stripDuplicateKeySuffix(step?.actionKey),
    step?.slug,
    step?.id,
    step?.action?.slug,
    step?.action?.id,
    step?.action?.item?.uuid,
  ].map((value) => String(value ?? "").trim()).filter(Boolean));
}

function actionLookupValues(action) {
  return [
    action?.key,
    action?.baseKey,
    actionBuilderKey(action),
    stripDuplicateKeySuffix(actionBuilderKey(action)),
    action?.id,
    action?.uuid,
    action?.item?.uuid,
    action?.slug,
    action?.name,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
}

function draftStepActionRows(candidateBuild) {
  const candidates = Array.isArray(candidateBuild?.candidates) ? candidateBuild.candidates : [];
  const rejected = Array.isArray(candidateBuild?.rejected) ? candidateBuild.rejected : [];
  return [
    ...candidates,
    ...rejected.map((entry) => {
      const action = entry?.action ?? entry;
      if (!action) return null;
      const reason = action.disabledReason ?? action.unavailableReason ?? entry?.reason ?? t("Reject.NotAvailable", "Action is not available in current context.");
      return {
        ...action,
        available: false,
        disabled: true,
        unavailableReason: reason,
        disabledReason: reason,
      };
    }),
  ].filter(Boolean).map(withBuilderActionFields);
}

function targetIdCandidates(entity) {
  return [entity?.id, entity?.uuid, entity?.token?.id, entity?.token?.uuid, entity?.actor?.id, entity?.actor?.uuid]
    .filter(Boolean)
    .map(String);
}

function sameTargetIdentity(left, right) {
  if (!left || !right) return false;
  const leftIds = new Set(targetIdCandidates(left));
  return targetIdCandidates(right).some((id) => leftIds.has(id));
}

// Resolves this step's own already-committed target (targetTokenIds) from the projected
// context's live target/enemy pool, so its distance reflects the PROJECTED position (e.g. after an
// earlier Stride in the same plan), not whatever it was when the step was first added.
function stepTargetFromContext(context, step) {
  const ids = new Set((Array.isArray(step?.targetTokenIds) ? step.targetTokenIds : []).map(String));
  if (!ids.size) return null;
  const pool = [...contextTargets(context), ...contextEnemies(context)];
  return pool.find((entry) => targetIdCandidates(entry).some((id) => ids.has(id))) ?? null;
}

// Generic melee maneuvers (Grapple, Trip, Disarm, Shove, Reposition) report their own reach
// requirement this way (see readGenericActionAvailability), rather than a Strike's range.max.
function requiresMeleeReach(action) {
  return action?.requiresEnemyInReach === true || action?.targetingProfile?.requiresEnemyInReach === true;
}

// A Strike's range comes from the action itself (actionCanReach); a generic melee maneuver has no
// range of its own -- it's gated on the actor's own melee reach, exactly like
// readGenericActionAvailability's own "enemy in reach" check (reader-helpers.js), so a maneuver
// re-validated here reads the same way the candidate builder itself would score it.
function candidateReachesTarget(context, action, target) {
  return action.source === "strike"
    ? actionCanReach(action, target)
    : Number.isFinite(target?.distance) && target.distance <= meleeReach(contextProfile(context));
}

export function findProjectedDraftAction(context, draft, step) {
  if (isSustainAction(step)) {
    return {
      ...SUSTAIN_A_SPELL_ACTION,
      name: pf2eActionName("sustain-a-spell", SUSTAIN_A_SPELL_ACTION.name),
      reason: t("Reason.SustainExtend", "Spend 1 action to extend a sustained spell's duration."),
      key: "sustain-a-spell",
      baseKey: "sustain-a-spell",
    };
  }
  const stepContext = projectContextForDraftStepOrigin(context, draft, step?.instanceId);
  if (step?.groupId) {
    const original = buildCandidates(stepContext).candidates.find((candidate) =>
      (candidate.activityProfile?.requiresDistinctTargets || candidate.activityProfile?.requiresBackingStrike)
      && String(candidate.name ?? "").split(" -> ")[0] === step.groupLabel);
    if (original) {
      const atoms = builderAtomicActionsForStep(original);
      const targetIds = Array.isArray(step.targetTokenIds) ? step.targetTokenIds.map(String) : [];
      const matchedAtom = Number.isFinite(step.atomIndex)
        ? atoms[step.atomIndex]
        : atoms.find((atom) => targetIds.includes(String(atom.preferredTarget?.id)));
      const atom = matchedAtom ?? (atoms.length ? atoms[0] : null);
      if (atom && step.weaponId) {
        const stepActorDocument = stepContext.actor?.document ?? stepContext.actor ?? null;
        const chosenWeapon = actorStrikeOptions(stepActorDocument, stepContext)
          .find((option) => option.id === step.weaponId);
        if (chosenWeapon) {
          const leafName = String(atom.name ?? "").split(" -> ")[0];
          return { ...atom, ...backingStrikeOverrideFields(chosenWeapon, leafName) };
        }
      }
      if (atom) return atom;
    }
  }
  const keys = draftStepLookupKeys(step);
  const matched = draftStepActionRows(buildCandidates(stepContext)).find((action) =>
    actionLookupValues(action).some((value) => keys.has(value) || keys.has(stripDuplicateKeySuffix(value))),
  ) ?? null;
  if (!matched || (matched.source !== "strike" && !requiresMeleeReach(matched))) return matched;

  // The freshly-matched candidate independently re-derives its own "best" target on every render,
  // which can drift from the specific target this step already committed to (targetTokenIds) once
  // the board changes -- e.g. an earlier Stride in the same plan executes and repositions the actor,
  // and a DIFFERENT enemy now happens to be conveniently in range. Left alone, that silently shows
  // this step as available against an enemy it isn't even labeled for, or (symmetrically) flags a
  // manually-retargeted step as unavailable using a stale, no-longer-relevant reason. Re-validate
  // against the step's own stored target whenever one is set and differs from what fresh scoring
  // naturally picked. This also affects generic melee maneuvers (Grapple, Trip, Disarm, Shove,
  // Reposition): their availability is gated on contextTargets() -- the user's RETICLE target pool
  // -- so a step committed to an enemy that isn't the current reticle target reads as unavailable
  // against that unrelated enemy's distance instead of its own.
  const stepTarget = stepTargetFromContext(stepContext, step);
  if (!stepTarget || sameTargetIdentity(matched.preferredTarget, stepTarget)) return matched;

  const reachable = candidateReachesTarget(stepContext, matched, stepTarget);
  const reason = reachable
    ? ""
    : matched.source === "strike"
      ? t("Avail.NoTargetInRange", "No target in range.")
      : t("Avail.NoEnemyInReach", "No enemy in reach.");
  return {
    ...matched,
    preferredTarget: stepTarget,
    suggestedTarget: stepTarget,
    available: reachable,
    unavailableReason: reason,
    disabledReason: reason,
  };
}

export function projectedDraftStepActions(context, draft) {
  if (!context) return {};
  const actions = {};
  for (const step of Array.isArray(draft?.steps) ? draft.steps : []) {
    if (!step?.instanceId) continue;
    const action = findProjectedDraftAction(context, draft, step);
    if (action) actions[step.instanceId] = action;
  }
  return actions;
}

export function draftStepId() {
  return globalThis.foundry?.utils?.randomID?.()
    ?? `draft-step-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
