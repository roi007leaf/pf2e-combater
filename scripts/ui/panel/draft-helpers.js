import {
  actionBuilderKey,
  backingStrikeOverrideFields,
  builderAtomicActionsForStep,
  projectContextForDraftStepOrigin,
  SUSTAIN_A_SPELL_ACTION,
} from "../../engine/action/builder.js";
import { plannedTargetSelection } from "../../engine/action/executor.js";
import { buildCandidates } from "../../engine/candidates.js";
import { actorStrikeOptions } from "../../readers/action/reader.js";
import { pf2eActionName, t } from "../../i18n.js";
import {
  isSustainAction,
  withBuilderActionFields,
} from "./view-model.js";

const AUTO_FILL_BASIC_MOVE_SLUGS = new Set(["stride", "step", "stand-stride"]);

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
  return draftStepActionRows(buildCandidates(stepContext)).find((action) =>
    actionLookupValues(action).some((value) => keys.has(value) || keys.has(stripDuplicateKeySuffix(value))),
  ) ?? null;
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
