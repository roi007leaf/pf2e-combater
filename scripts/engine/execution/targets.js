import { collectionValues } from "../../foundry-data.js";
import { canvasTokenById as canvasTokenByIdFromCanvas, contextTokenId } from "../../rules/canvas-geometry.js";
import { t } from "../../i18n.js";

export function tokenId(context) {
  return contextTokenId(context);
}

export function canvasTokenById(id) {
  return canvasTokenByIdFromCanvas(id);
}

export function targetTokenId(token) {
  const document = token?.document ?? token;
  return token?.id ?? token?.uuid ?? document?.id ?? document?.uuid ?? null;
}

function targetTokenName(token) {
  return token?.name ?? token?.document?.name ?? token?.actor?.name ?? token?.document?.actor?.name ?? "";
}

export function currentTargetSelection() {
  const targets = collectionValues(globalThis.game?.user?.targets).filter(Boolean);
  const targetTokenIds = targets.map((target) => targetTokenId(target)).filter(Boolean);
  const targetNames = targets.map((target) => targetTokenName(target)).filter(Boolean);
  return {
    targets,
    targetTokenIds,
    targetLabel: targetNames.length ? t("Label.Target", "Target: {name}", { name: targetNames.join(", ") }) : "",
  };
}

export function plannedTargetSelection(action) {
  const target = action?.suggestedTarget ?? action?.preferredTarget ?? action?.target ?? null;
  const ids = Array.from(new Set([
    action?.targetingProfile?.preferredTargetId,
    target?.id,
    target?.uuid,
    target?.token?.id,
    target?.token?.uuid,
  ].filter(Boolean)));
  const name = target?.name ?? target?.label ?? target?.token?.name ?? "";
  return {
    targets: target ? [target] : [],
    targetTokenIds: ids,
    targetLabel: name ? t("Label.Target", "Target: {name}", { name }) : "",
  };
}

function normalizedIds(ids) {
  return Array.isArray(ids) ? ids.filter(Boolean) : [ids].filter(Boolean);
}

function storedTargetSelection(step, action) {
  const source = { targetTokenIds: normalizedIds(step?.targetTokenIds), targetLabel: step?.targetLabel ?? "" };
  if (!source.targetTokenIds.length) return null;
  if (step?.targetSelection === "manual") return source;

  const recommendedIds = new Set(plannedTargetSelection(action).targetTokenIds);
  const matchesRecommendation = recommendedIds.size > 0
    && source.targetTokenIds.every((id) => recommendedIds.has(id));
  return matchesRecommendation ? null : source;
}

function targetSelectionSources(step, action, choices = {}) {
  if (Object.prototype.hasOwnProperty.call(choices, "targetTokenIds")) {
    return [{ targetTokenIds: normalizedIds(choices.targetTokenIds), targetLabel: choices.targetLabel ?? "" }];
  }

  const stored = storedTargetSelection(step, action);
  return [stored].filter((source) => source?.targetTokenIds?.length);
}

function targetTokenById(id) {
  const token = canvasTokenById(id);
  if (token) return token;
  return collectionValues(globalThis.game?.user?.targets).find((target) => targetTokenId(target) === id) ?? null;
}

export function targetActor(token) {
  return token?.actor ?? token?.document?.actor ?? token?.object?.actor ?? null;
}

export function targetTokenUuid(token) {
  const document = token?.document ?? token;
  return document?.uuid ?? token?.uuid ?? null;
}

function targetLabelFor(token) {
  const name = targetTokenName(token);
  return name ? t("Label.Target", "Target: {name}", { name }) : "";
}

function clearTokenTargets() {
  try {
    globalThis.canvas?.tokens?.setTargets?.([]);
  } catch (_error) {
    // Optional in Foundry test harnesses and older canvas mocks.
  }
}

function applyTokenTarget(token) {
  if (typeof token?.setTarget === "function") {
    token.setTarget(true, { releaseOthers: false });
    return true;
  }
  if (typeof token?.object?.setTarget === "function") {
    token.object.setTarget(true, { releaseOthers: false });
    return true;
  }
  if (typeof token?.document?.object?.setTarget === "function") {
    token.document.object.setTarget(true, { releaseOthers: false });
    return true;
  }
  return false;
}

export function setTarget(token) {
  clearTokenTargets();
  return applyTokenTarget(token);
}

// Replace the user's targets with the given tokens (used to target everyone in an area).
export function setTokenTargets(tokens) {
  clearTokenTargets();
  let count = 0;
  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (applyTokenTarget(token)) count += 1;
  }
  return count;
}

export function resolveTarget(step, action, choices) {
  for (const source of targetSelectionSources(step, action, choices)) {
    const token = source.targetTokenIds.map((id) => targetTokenById(id)).find(Boolean) ?? null;
    if (token) return { token, id: targetTokenId(token), label: targetLabelFor(token) || source.targetLabel };
  }
  return null;
}
