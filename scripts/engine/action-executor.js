import { requiresDestinationForAction } from "./action-builder.js";
import { movementPreviewForStep } from "../ui/movement-preview.js";
import { buildAreaTimerEffectData, buildAreaTimerFlag, parseSpellDuration } from "./area-duration.js";
import { t } from "../i18n.js";

const AREA_SHAPES = new Set(["burst", "cone", "cube", "cylinder", "emanation", "line", "ring", "square"]);
const AREA_REGION_TYPES = new Set(["circle", "cone", "emanation", "line", "rectangle", "ring"]);
const SUCCESS_DEGREES = new Set(["success", "criticalSuccess", "critical-success", "critical success", 2, 3]);

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function systemValue(value) {
  if (value && typeof value === "object" && "value" in value) return value.value;
  return value;
}

function point(value) {
  const x = numeric(value?.x);
  const y = numeric(value?.y);
  if (x === null || y === null) return null;
  // Preserve a vertical-movement target elevation when present so it survives down to the move call.
  const elevation = numeric(value?.elevation);
  return elevation === null ? { x, y } : { x, y, elevation };
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return Object.values(collection);
}

export function actorDocument(context) {
  return context?.actor?.document ?? context?.combatant?.actor ?? context?.actor ?? null;
}

export function tokenId(context) {
  return context?.token?.id
    ?? context?.token?.uuid
    ?? context?.combatant?.tokenId
    ?? context?.combatant?.token?.id
    ?? context?.combatant?.token?.uuid
    ?? null;
}

export function canvasTokenById(id) {
  if (!id) return null;
  return (globalThis.canvas?.tokens?.placeables ?? []).find((token) => {
    const document = token?.document ?? token;
    return token?.id === id
      || token?.uuid === id
      || document?.id === id
      || document?.uuid === id;
  }) ?? null;
}

function actionSlug(action) {
  return String(action?.slug ?? action?.action?.slug ?? action?.actionKey ?? "").toLowerCase();
}

function slugFromName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function actionContextSlug(action) {
  return slugFromName(actionSlug(action))
    || slugFromName(action?.item?.slug)
    || slugFromName(action?.item?.name)
    || slugFromName(action?.name);
}

function movementActionForAction(action) {
  const requested = String(action?.movementAction ?? action?.action?.movementAction ?? "").toLowerCase();
  if (requested === "step") return "walk";
  if (requested) return requested;

  const slug = actionSlug(action);
  if (slug === "crawl") return "crawl";
  return "walk";
}

function actionTargeting(action) {
  return action?.targetingProfile ?? action?.action?.targetingProfile ?? {};
}

function actionIncludes(action, value) {
  return Array.isArray(action?.activityProfile?.includes)
    && action.activityProfile.includes.map((entry) => String(entry).toLowerCase()).includes(value);
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

function areaMarkerFromStep(step, choices = {}) {
  return choices.areaMarker ?? step?.areaMarker ?? null;
}

function destinationFromStep(step, choices = {}) {
  return point(choices.destination) ?? point(step?.destination);
}

function movementPlanFromStep(step, choices = {}) {
  return choices.movementPlan ?? step?.movementPlan ?? null;
}

function executionAction(step, action) {
  const merged = { ...(action ?? {}) };
  for (const key of ["actionKey", "key", "slug", "movementAction"]) {
    if ((merged[key] === undefined || merged[key] === null || merged[key] === "") && step?.[key]) {
      merged[key] = step[key];
    }
  }
  if (step?.requiresDestination === true) merged.requiresDestination = true;
  return merged;
}

export function requiresAreaMarkerForAction(action) {
  const targeting = actionTargeting(action);
  const type = String(targeting?.type ?? targeting?.shape ?? action?.area?.type ?? "").toLowerCase();
  return targeting?.area === true
    || AREA_SHAPES.has(type)
    || AREA_REGION_TYPES.has(type)
    || actionIncludes(action, "area")
    || String(action?.role ?? "").toLowerCase().includes("area");
}

export function requiresTargetForAction(action) {
  if (!action || requiresAreaMarkerForAction(action)) return false;
  const slug = actionSlug(action);
  if (["stand", "retch", "stride", "step", "crawl"].includes(slug)) return false;

  const targeting = actionTargeting(action);
  const selfOnly = targeting?.self === true && targeting?.enemy !== true && targeting?.ally !== true;
  if (selfOnly) return false;

  // Move-and-strike activities (e.g. Sudden Charge) auto-plot movement to their target and
  // resolve the strike against the suggested/current target at execution, so — like their
  // destination — they do not prompt for a manual target. A plain strike (a strike with no
  // movement component) still requires one.
  const profile = action?.activityProfile ?? {};
  const movesToStrike = (profile.includesStrike === true || actionIncludes(action, "strike"))
    && (Number(profile.strideCount) > 0 || actionIncludes(action, "stride") || actionIncludes(action, "step"));
  if (movesToStrike) return false;

  // A self-directed suggested target (Raise a Shield, Take Cover, self-buffs, etc.) is the
  // acting actor — it never requires the user to pick a target on the canvas.
  const suggested = action?.preferredTarget ?? action?.suggestedTarget ?? null;
  const hasExternalTarget = Boolean(suggested) && suggested?.type !== "self";

  return action?.executable === "strike"
    || action?.source === "strike"
    || action?.attackTrait === true
    || hasExternalTarget
    || targeting?.enemy === true
    || targeting?.ally === true
    || targeting?.reach === true
    || targeting?.maxTargets !== undefined
    || targeting?.maxRange !== undefined
    || action?.requiresEnemyInReach === true;
}

export function executionReadinessForStep(step, action = step?.action ?? step) {
  const resolvedAction = executionAction(step, action);
  const choices = [];
  if (requiresDestinationForAction(resolvedAction) && !destinationFromStep(step)) choices.push("destination");
  if (requiresTargetForAction(resolvedAction) && !resolveTarget(step, resolvedAction)) choices.push("target");
  if (requiresAreaMarkerForAction(resolvedAction) && !areaMarkerFromStep(step)) choices.push("area");
  const choiceLabels = choices.map((choice) => t(`Choice.${choice}`, choice));
  return {
    status: choices.length ? "needs-choice" : "ready",
    choices,
    warning: choices.length ? t("Exec.ChooseAtExec", "Choose {choices} at execution.", { choices: choiceLabels.join(", ") }) : "",
  };
}

export function nextPendingExecutionStep(draft) {
  return (Array.isArray(draft?.steps) ? draft.steps : [])
    .find((step) => step?.execution?.status !== "done") ?? null;
}

export function resetDraftExecution(draft) {
  const resetList = (list) => (Array.isArray(list) ? list : []).map((step) => ({
    ...step,
    execution: { status: "pending" },
  }));
  return {
    ...(draft ?? {}),
    steps: resetList(draft?.steps),
    ...(Array.isArray(draft?.uncounted) ? { uncounted: resetList(draft.uncounted) } : {}),
  };
}

function executionPatch(basePatch, status, extra = {}) {
  return {
    ...basePatch,
    execution: {
      status,
      ...(status === "done" ? { completedAt: Date.now() } : {}),
      ...(extra.result ? { result: extra.result } : {}),
      ...(extra.error ? { error: extra.error } : {}),
      ...(extra.revert ? { revert: extra.revert } : {}),
    },
  };
}

// Plain-data descriptor of how to undo an executed step. Stored on the synced draft, so
// it must stay JSON-serializable: ids, coordinates, slugs, numbers, strings only.
function revertEnvelope(ops = [], manualWarnings = []) {
  const cleanOps = (Array.isArray(ops) ? ops : []).filter(Boolean);
  if (!cleanOps.length && !manualWarnings.length) return null;
  return { ops: cleanOps, manualWarnings };
}

// Prepend a revert op (e.g. delete a placed area region) onto a branch result that may
// already carry its own revert payload. Only attaches when the step actually completed.
function attachRevertOp(result, op) {
  if (!op || result?.status !== "done" || !result?.patch?.execution) return result;
  const existing = result.patch.execution.revert ?? { ops: [], manualWarnings: [] };
  const ops = [op, ...(Array.isArray(existing.ops) ? existing.ops : [])];
  return {
    ...result,
    patch: {
      ...result.patch,
      execution: {
        ...result.patch.execution,
        revert: { ops, manualWarnings: existing.manualWarnings ?? [] },
      },
    },
  };
}

function chatMessageIdFromResult(nativeResult) {
  if (!nativeResult || typeof nativeResult !== "object") return null;
  const candidates = [
    nativeResult,
    nativeResult.message,
    Array.isArray(nativeResult) ? nativeResult[0] : null,
    Array.isArray(nativeResult.messages) ? nativeResult.messages[0] : null,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const isMessage = candidate.documentName === "ChatMessage"
      || candidate.constructor?.name === "ChatMessage"
      || candidate === nativeResult.message;
    const id = candidate.id ?? candidate._id;
    if (isMessage && id) return id;
  }
  return null;
}

function slotKeyForRank(rank) {
  const value = numeric(rank, null);
  return value === null || value < 0 ? null : `slot${value}`;
}

function identityValues(...sources) {
  return sources
    .flatMap((source) => [
      source?.id,
      source?._id,
      source?.uuid,
      source?.sourceId,
      source?.slug,
      source?.system?.slug?.value,
      source?.system?.slug,
      source?.itemId,
      source?.spellId,
      source?.spell?.id,
      source?.spell?._id,
      source?.spell?.uuid,
      source?.spell?.sourceId,
      source?.spell?.slug,
      source?.spell?.system?.slug?.value,
      source?.spell?.system?.slug,
    ])
    .filter(Boolean)
    .map((value) => String(value));
}

function slotEntries(entry) {
  const slots = entry?.system?.slots ?? {};
  return Object.entries(slots).filter(([, slot]) => slot && typeof slot === "object");
}

function findPreparedSpellSlot(entry, action) {
  const spellIds = new Set(identityValues(action, action?.item));
  if (!spellIds.size) return null;

  for (const [slotKey, slot] of slotEntries(entry)) {
    const prepared = Array.isArray(slot?.prepared) ? slot.prepared : [];
    const preparedIndex = prepared.findIndex((preparedSpell) =>
      identityValues(preparedSpell).some((id) => spellIds.has(id)),
    );
    if (preparedIndex >= 0) {
      return { slotKey, preparedIndex, preparedSpell: prepared[preparedIndex] };
    }
  }
  return null;
}

function slotSnapshot(slot) {
  if (!slot || typeof slot !== "object") return {};
  const value = numeric(systemValue(slot.value), null);
  const remaining = numeric(systemValue(slot.remaining), null);
  return {
    ...(value !== null ? { valueBefore: value } : {}),
    ...(remaining !== null ? { remainingBefore: remaining } : {}),
  };
}

function spellSlotRevertOp(actor, action) {
  if (!action?.item) return null;
  const entry = findSpellcastingEntry(actor, action);
  if (!entry) return null;

  const rank = numeric(action.castRank ?? action.rank, null);
  const rankSlotKey = slotKeyForRank(rank);
  const preparedMatch = findPreparedSpellSlot(entry, action);
  const slotKey = preparedMatch?.slotKey ?? rankSlotKey;
  const slot = slotKey ? entry?.system?.slots?.[slotKey] : null;
  const slotIdExplicit = action.slotId !== undefined && action.slotId !== null;
  const op = {
    kind: "slot",
    entryId: action.spellcastingEntryId ?? entry?.id ?? entry?._id ?? null,
    entryUuid: action.spellcastingEntryUuid ?? entry?.uuid ?? null,
    entryType: action.spellcastingEntryType ?? systemValue(entry?.system?.prepared) ?? null,
    rank,
    slotId: action.slotId ?? action.location ?? null,
    slotIdExplicit,
    slotKey,
    spellId: action.item?.id ?? action.item?._id ?? action.id ?? null,
    spellUuid: action.item?.uuid ?? action.uuid ?? null,
    spellSlug: action.item?.slug ?? action.slug ?? null,
    ...slotSnapshot(slot),
  };

  if (preparedMatch) {
    op.preparedIndex = preparedMatch.preparedIndex;
    op.preparedId = preparedMatch.preparedSpell?.id ?? preparedMatch.preparedSpell?._id ?? null;
    op.preparedUuid = preparedMatch.preparedSpell?.uuid ?? preparedMatch.preparedSpell?.spell?.uuid ?? null;
    op.preparedExpendedBefore = preparedMatch.preparedSpell?.expended === true;
  }

  return op;
}

// Best-effort revert for chat-producing actions (strikes, opened PF2e actions, casts):
// delete the produced chat message when traceable, restore a consumed spell slot when the
// API allows it, and warn for effects we cannot reliably undo (conditions on a target).
function chatActionRevert(nativeResult, action, { target = null, slotOp = null } = {}) {
  const ops = [];
  const manualWarnings = [];
  const messageId = chatMessageIdFromResult(nativeResult);
  if (messageId) ops.push({ kind: "chat", messageId });
  if (nativeResult?.consumableRevertOp) ops.push(nativeResult.consumableRevertOp);
  if (nativeResult?.frequencyRevertOp) ops.push(nativeResult.frequencyRevertOp);

  if (slotOp) {
    ops.push(slotOp);
  } else if (action?.item && (action?.slotId ?? action?.location) != null) {
    ops.push({
      kind: "slot",
      entryId: action.spellcastingEntryId ?? null,
      entryUuid: action.spellcastingEntryUuid ?? null,
      rank: action.castRank ?? action.rank ?? null,
      slotId: action.slotId ?? action.location ?? null,
      slotIdExplicit: action.slotId !== undefined && action.slotId !== null,
    });
  }

  const targetName = String(target?.label ?? "").replace(/^Target:\s*/i, "").trim();
  if (targetName) {
    manualWarnings.push(t("Exec.ManualEffects", "{action} may have applied effects to {target} — undo them manually.", { action: action?.name ?? t("Exec.ThisActionCap", "This action"), target: targetName }));
  }
  if (!messageId) {
    manualWarnings.push(t("Exec.ManualUndo", "Undo {action} manually; its chat output could not be tracked.", { action: action?.name ?? t("Exec.ThisAction", "this action") }));
  }
  return revertEnvelope(ops, manualWarnings);
}

function targetTokenById(id) {
  const token = canvasTokenById(id);
  if (token) return token;
  return collectionValues(globalThis.game?.user?.targets).find((target) => targetTokenId(target) === id) ?? null;
}

function targetActor(token) {
  return token?.actor ?? token?.document?.actor ?? token?.object?.actor ?? null;
}

function targetTokenUuid(token) {
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

function setTarget(token) {
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

function resolveTarget(step, action, choices) {
  for (const source of targetSelectionSources(step, action, choices)) {
    const token = source.targetTokenIds.map((id) => targetTokenById(id)).find(Boolean) ?? null;
    if (token) return { token, id: targetTokenId(token), label: targetLabelFor(token) || source.targetLabel };
  }
  return null;
}

function gridSize() {
  return numeric(globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size, 1) || 1;
}

function gridDistance() {
  return numeric(
    globalThis.canvas?.dimensions?.distance
    ?? globalThis.canvas?.scene?.grid?.distance
    ?? globalThis.canvas?.grid?.distance,
    5,
  ) || 5;
}

function distancePixels(distance) {
  const pixelsPerUnit = numeric(globalThis.canvas?.dimensions?.distancePixels);
  if (pixelsPerUnit && pixelsPerUnit > 0) return distance * pixelsPerUnit;
  return (distance / gridDistance()) * gridSize();
}

function pixelsPerDistanceUnit() {
  const pixelsPerUnit = numeric(globalThis.canvas?.dimensions?.distancePixels);
  if (pixelsPerUnit && pixelsPerUnit > 0) return pixelsPerUnit;

  const distance = gridDistance();
  return distance > 0 ? gridSize() / distance : 1;
}

function toScenePoint(value, scale) {
  const center = point(value);
  if (!center) return null;
  const divisor = scale > 0 ? scale : 1;
  return {
    x: center.x / divisor,
    y: center.y / divisor,
    // Elevation is in scene feet, not pixels, so it passes through unscaled.
    ...(center.elevation === undefined ? {} : { elevation: center.elevation }),
  };
}

function sceneToken(token, scale) {
  if (!token) return token;
  return {
    ...token,
    ...(token.center ? { center: toScenePoint(token.center, scale) } : {}),
    ...(token.plannedCenter ? { plannedCenter: toScenePoint(token.plannedCenter, scale) } : {}),
    ...(token.token ? { token: sceneToken(token.token, scale) } : {}),
  };
}

function sceneTargets(targets, scale) {
  return Array.isArray(targets)
    ? targets.map((target) => sceneToken(target, scale))
    : targets;
}

function sceneMovementPlan(movementPlan, scale) {
  if (!movementPlan) return null;
  return {
    ...movementPlan,
    ...(Array.isArray(movementPlan.waypoints)
      ? { waypoints: movementPlan.waypoints.map((waypoint) => toScenePoint(waypoint, scale)).filter(Boolean) }
      : {}),
    ...(movementPlan.origin ? { origin: toScenePoint(movementPlan.origin, scale) } : {}),
    ...(movementPlan.destination ? { destination: toScenePoint(movementPlan.destination, scale) } : {}),
  };
}

function movementValidationPreview(context, action, destination, movementPlan = null) {
  const scale = pixelsPerDistanceUnit();
  return movementPreviewForStep({
    ...(context ?? {}),
    token: sceneToken(context?.token, scale),
    battlefield: {
      ...(context?.battlefield ?? {}),
      targets: sceneTargets(context?.battlefield?.targets, scale),
      enemies: sceneTargets(context?.battlefield?.enemies, scale),
      allies: sceneTargets(context?.battlefield?.allies, scale),
    },
  }, {
    ...(action ?? {}),
    destination: toScenePoint(destination, scale) ?? destination,
    ...(movementPlan ? { movementPlan: sceneMovementPlan(movementPlan, scale) } : {}),
    requiresDestination: true,
  }, {
    gridSize: gridDistance(),
    collisionScale: scale,
    // Execution just needs the legality verdict, not the hover overlay's reachable-area flood-fill.
    validateOnly: true,
  });
}

function tokenFootprint(token, context) {
  const document = token?.document ?? {};
  return {
    width: Math.max(1, numeric(document.width ?? token?.width ?? context?.token?.width, 1) || 1),
    height: Math.max(1, numeric(document.height ?? token?.height ?? context?.token?.height, 1) || 1),
  };
}

function activeCombatant(combat) {
  return combat?.combatant ?? (Array.isArray(combat?.turns) ? combat.turns[combat.turn] : null) ?? null;
}

function tokenIdentityValues(token, context) {
  const document = token?.document ?? token ?? {};
  return [
    token?.id,
    token?.uuid,
    document?.id,
    document?.uuid,
    tokenId(context),
    context?.combatant?.tokenId,
    context?.combatant?.token?.id,
    context?.combatant?.token?.uuid,
  ].filter(Boolean).map(String);
}

function combatantTokenIdentityValues(combatant) {
  return [
    combatant?.tokenId,
    combatant?.token?.id,
    combatant?.token?.uuid,
    combatant?.token?.document?.id,
    combatant?.token?.document?.uuid,
  ].filter(Boolean).map(String);
}

function canMoveOnCurrentTurn(context, token) {
  const combat = context?.combat ?? context?.combatant?.combat ?? globalThis.game?.combat ?? null;
  if (!combat) return true;

  const active = activeCombatant(combat);
  const activeIds = combatantTokenIdentityValues(active);
  if (!activeIds.length) return true;

  const tokenIds = tokenIdentityValues(token, context);
  return activeIds.some((id) => tokenIds.includes(id));
}

function tokenWaypointForDestination(destination, token, context, action) {
  const size = gridSize();
  const footprint = tokenFootprint(token, context);
  const elevation = numeric(destination?.elevation);
  return {
    x: destination.x - (footprint.width * size) / 2,
    y: destination.y - (footprint.height * size) / 2,
    action: movementActionForAction(action),
    // A vertical Stride (fly/burrow) ends at the chosen elevation; flat moves leave it untouched.
    ...(elevation === null ? {} : { elevation }),
    explicit: true,
    checkpoint: true,
    snapped: true,
  };
}

// Current top-left of the token, captured before a move so revert can reposition it. Elevation is
// captured too so reverting a vertical Stride drops the token back to where it took off.
function movementOrigin(token, document, context) {
  const elevation = numeric(document?.elevation ?? token?.document?.elevation ?? context?.token?.elevation);
  const withElevation = (origin) => (origin && elevation !== null ? { ...origin, elevation } : origin);
  const docX = numeric(document?.x);
  const docY = numeric(document?.y);
  if (docX !== null && docY !== null) return withElevation({ x: docX, y: docY });
  const center = point(token?.center) ?? point(context?.token?.center);
  if (!center) return null;
  const size = gridSize();
  const footprint = tokenFootprint(token, context);
  return withElevation({
    x: center.x - (footprint.width * size) / 2,
    y: center.y - (footprint.height * size) / 2,
  });
}

function samePoint(left, right) {
  return !!left && !!right && left.x === right.x && left.y === right.y;
}

function customMovementWaypoints(destination, movementPlan) {
  if (movementPlan?.native !== false || !Array.isArray(movementPlan.waypoints)) return [];
  const waypoints = movementPlan.waypoints.map((waypoint) => point(waypoint)).filter(Boolean);
  if (destination && !samePoint(waypoints.at(-1), destination)) waypoints.push(destination);
  return waypoints;
}

// Forward path of top-left token positions (origin first, destination last). Captured so revert
// can retrace the waypoints in reverse rather than cutting a straight line back to the origin.
function movementPathPoints({ origin, destination, movementPlan, token, context, action }) {
  if (!origin) return null;
  const waypointCenters = Array.isArray(movementPlan?.waypoints)
    ? movementPlan.waypoints.map((waypoint) => point(waypoint)).filter(Boolean)
    : [];
  const centers = [...waypointCenters];
  if (destination && !samePoint(centers.at(-1), destination)) centers.push(destination);
  if (!centers.length) return [origin];
  const tail = centers.map((center) => {
    const waypoint = tokenWaypointForDestination(center, token, context, action);
    // Keep each leg's elevation so reverting a multi-height flight retraces those heights.
    return waypoint.elevation === undefined
      ? { x: waypoint.x, y: waypoint.y }
      : { x: waypoint.x, y: waypoint.y, elevation: waypoint.elevation };
  });
  return [origin, ...tail];
}

async function startPlannedMovement(document, movementPlan) {
  if (!movementPlan?.id || typeof document?.startMovement !== "function") return false;
  if (document?.movement?.state !== "planned") return false;
  if (document?.movement?.id && document.movement.id !== movementPlan.id) return false;
  return document.startMovement(movementPlan.id);
}

async function executeMovement({ context, step, action, choices }) {
  const destination = destinationFromStep(step, choices);
  const movementPlan = movementPlanFromStep(step, choices);
  if (!destination) {
    return { status: "needs-choice", choices: ["destination"], patch: {} };
  }

  const token = canvasTokenById(tokenId(context));
  const preview = movementValidationPreview(context, action, destination, movementPlan);
  if (preview.enabled && preview.explicitDestination && preview.destinationAvailable === false) {
    return {
      status: "failed",
      patch: executionPatch({ destination }, "failed", { error: preview.destinationIllegalReason || t("Exec.DestinationUnavailable", "Destination is unavailable.") }),
      error: preview.destinationIllegalReason || t("Exec.DestinationUnavailable", "Destination is unavailable."),
    };
  }

  const document = token?.document ?? context?.combatant?.token ?? context?.token?.document;
  const origin = movementOrigin(token, document, context);
  const moveTokenId = targetTokenId(token) ?? tokenId(context);
  const path = movementPathPoints({ origin, destination, movementPlan, token, context, action });
  const movementRevert = origin && moveTokenId
    ? revertEnvelope([{ kind: "movement", tokenId: moveTokenId, origin, ...(path && path.length > 1 ? { path } : {}) }])
    : null;
  if (!canMoveOnCurrentTurn(context, token)) {
    return {
      status: "failed",
      patch: executionPatch({ destination, ...(movementPlan ? { movementPlan } : {}) }, "failed", { error: t("Exec.MoveOnlyOnTurn", "Token can only move on its turn.") }),
      error: t("Exec.MoveOnlyOnTurn", "Token can only move on its turn."),
    };
  }

  const plannedStarted = await startPlannedMovement(document, movementPlan);
  if (plannedStarted) {
    return {
      status: "done",
      patch: executionPatch({ destination, ...(movementPlan ? { movementPlan } : {}) }, "done", { result: t("Exec.StartedMovement", "Started planned movement."), revert: movementRevert }),
    };
  }

  if (movementPlan?.id && document?.movement?.state === "planned") {
    return {
      status: "failed",
      patch: executionPatch({ destination, movementPlan }, "failed", { error: t("Exec.MovementStale", "Planned movement is stale. Choose destination again.") }),
      error: t("Exec.MovementStale", "Planned movement is stale. Choose destination again."),
    };
  }

  const customWaypoints = customMovementWaypoints(destination, movementPlan);
  if (customWaypoints.length && typeof document?.move === "function") {
    for (const waypointDestination of customWaypoints) {
      const waypoint = tokenWaypointForDestination(waypointDestination, token, context, action);
      const moved = await document.move(waypoint, { method: "api", showRuler: true });
      if (!moved) {
        return {
          status: "failed",
          patch: executionPatch({ destination, movementPlan }, "failed", { error: t("Exec.MovementPrevented", "Movement was prevented.") }),
          error: t("Exec.MovementPrevented", "Movement was prevented."),
        };
      }
    }
    return {
      status: "done",
      patch: executionPatch({ destination, movementPlan }, "done", { result: t("Exec.MovedToken", "Moved token."), revert: movementRevert }),
    };
  }

  const waypoint = tokenWaypointForDestination(destination, token, context, action);
  if (typeof document?.move === "function") {
    const moved = await document.move(waypoint, { method: "api", showRuler: true });
    if (!moved) {
      return {
        status: "failed",
        patch: executionPatch({ destination, ...(movementPlan ? { movementPlan } : {}) }, "failed", { error: t("Exec.MovementPrevented", "Movement was prevented.") }),
        error: t("Exec.MovementPrevented", "Movement was prevented."),
      };
    }
    return {
      status: "done",
      patch: executionPatch({ destination, ...(movementPlan ? { movementPlan } : {}) }, "done", { result: t("Exec.MovedToken", "Moved token."), revert: movementRevert }),
    };
  }

  if (typeof document?.update !== "function") {
    return {
      status: "failed",
      patch: executionPatch({ destination }, "failed", { error: t("Exec.NoTokenDocument", "Token document is not available.") }),
      error: t("Exec.NoTokenDocument", "Token document is not available."),
    };
  }

  await document.update({
    x: waypoint.x,
    y: waypoint.y,
  });
  return {
    status: "done",
    patch: executionPatch({ destination }, "done", { result: t("Exec.MovedToken", "Moved token."), revert: movementRevert }),
  };
}

export async function decreaseCondition(actor, slug, options = {}) {
  if (typeof actor?.decreaseCondition === "function") {
    await actor.decreaseCondition(slug, options);
    return true;
  }
  if (typeof actor?.toggleCondition === "function" && slug === "prone") {
    await actor.toggleCondition(slug, { active: false });
    return true;
  }
  return false;
}

export async function increaseCondition(actor, slug, options = {}) {
  if (typeof actor?.increaseCondition === "function") {
    await actor.increaseCondition(slug, options);
    return true;
  }
  if (typeof actor?.toggleCondition === "function" && slug === "prone") {
    await actor.toggleCondition(slug, { active: true });
    return true;
  }
  return false;
}

async function executeStand(actor) {
  const removed = await decreaseCondition(actor, "prone", { forceRemove: true });
  return removed
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.RemovedProne", "Removed prone."), revert: revertEnvelope([{ kind: "condition", slug: "prone" }]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotRemoveProne", "Could not remove prone.") }), error: t("Exec.CouldNotRemoveProne", "Could not remove prone.") };
}

function resultDegree(result) {
  const values = [
    result?.degreeOfSuccess,
    result?.outcome,
    result?.result?.degreeOfSuccess,
    result?.roll?.degreeOfSuccess,
  ];
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function degreeSucceeded(degree) {
  if (degree === null || degree === undefined) return null;
  if (SUCCESS_DEGREES.has(degree)) return true;
  return String(degree).toLowerCase().includes("success");
}

function isCriticalSuccessDegree(degree) {
  if (degree === 3) return true;
  return String(degree ?? "").toLowerCase().replace(/[\s_-]/g, "") === "criticalsuccess";
}

// Roll the actor's Fortitude save to chat. PF2e exposes saves as statistics with a roll(); pass a DC
// when one is known so the card shows the degree, otherwise roll flat (the GM judges it).
async function rollFortitudeSave(actor, { event, dc } = {}) {
  const save = actor?.saves?.fortitude ?? actor?.getStatistic?.("fortitude");
  if (typeof save?.roll !== "function") return null;
  try {
    return await save.roll({ event, ...(Number.isFinite(dc) ? { dc: { value: dc } } : {}) });
  } catch (_error) {
    return null;
  }
}

// Apply a settled Retch result: a success removes 1 sickened, a critical success removes 2, each
// reduction getting its own revert op. A non-success leaves sickened unchanged.
async function applyRetchResult(actor, succeeded, critical) {
  if (succeeded !== true) {
    return { status: "done", patch: executionPatch({}, "done", { result: t("Exec.RetchFailed", "Retch failed; sickened unchanged.") }) };
  }
  const reduceBy = critical ? 2 : 1;
  let removed = 0;
  for (let index = 0; index < reduceBy; index += 1) {
    if (await decreaseCondition(actor, "sickened")) removed += 1;
  }
  if (removed <= 0) {
    return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotReduceSickened", "Could not reduce sickened.") }), error: t("Exec.CouldNotReduceSickened", "Could not reduce sickened.") };
  }
  return {
    status: "done",
    patch: executionPatch({}, "done", {
      result: removed >= 2 ? t("Exec.ReducedSickened2", "Reduced sickened by 2.") : t("Exec.ReducedSickened", "Reduced sickened."),
      revert: revertEnvelope(Array.from({ length: removed }, () => ({ kind: "condition", slug: "sickened" }))),
    }),
  };
}

// Retch is a Fortitude save against the DC of the effect that sickened you (not a PF2e action), and
// only the GM knows that DC. The flow runs in three phases driven by the panel:
//   1. No DC yet            -> needs-choice "retch-dc"     (GM supplies the DC)
//   2. DC supplied (no rule)-> roll the save vs the DC, then needs-choice "retch-result" carrying the
//                              rolled degree (the player rolls; the GM then judges)
//   3. GM ruled             -> apply choices.retchSucceeded / retchCritical
async function executeRetch({ actor, action, event, choices }) {
  if (choices.retchSucceeded !== undefined) {
    return applyRetchResult(actor, choices.retchSucceeded === true, choices.retchCritical === true);
  }
  const dc = numeric(action?.dc ?? action?.difficultyClass ?? choices?.dc);
  if (!Number.isFinite(dc)) {
    return { status: "needs-choice", choices: ["retch-dc"], patch: {} };
  }
  // DC known — the player rolls the save against it (posted to chat); the GM rules on the outcome.
  const roll = await rollFortitudeSave(actor, { event, dc });
  const degree = resultDegree(roll);
  return {
    status: "needs-choice",
    choices: ["retch-result"],
    patch: {},
    rolled: {
      degree: degree ?? null,
      succeeded: degreeSucceeded(degree),
      critical: isCriticalSuccessDegree(degree),
    },
  };
}

async function executeDropProne(actor) {
  const added = await increaseCondition(actor, "prone");
  return added
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.DroppedProne", "Dropped prone."), revert: revertEnvelope([{ kind: "condition", slug: "prone", remove: true }]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotDropProne", "Could not drop prone.") }), error: t("Exec.CouldNotDropProne", "Could not drop prone.") };
}

function weaponCarryState(item) {
  const equipped = item?.system?.equipped ?? {};
  return { carryType: equipped.carryType ?? "worn", handsHeld: Number(equipped.handsHeld) || 0 };
}

async function changeWeaponCarry(actor, item, target) {
  if (typeof actor?.changeCarryType === "function") {
    await actor.changeCarryType(item, target);
    return true;
  }
  if (typeof item?.update === "function") {
    await item.update({
      "system.equipped.carryType": target.carryType,
      "system.equipped.handsHeld": target.handsHeld ?? 0,
    });
    return true;
  }
  return false;
}

async function executeDrawWeapon({ actor, action }) {
  const item = action?.item;
  if (!item) return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.NoWeaponDraw", "No weapon to draw.") }), error: t("Exec.NoWeaponDraw", "No weapon to draw.") };
  const prior = weaponCarryState(item);
  const hands = Number(item?.system?.usage?.hands) || 1;
  const changed = await changeWeaponCarry(actor, item, { carryType: "held", handsHeld: hands });
  return changed
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.Drew", "Drew {name}.", { name: item.name ?? t("Exec.Weapon", "weapon") }), revert: revertEnvelope([{ kind: "carry-type", itemUuid: item.uuid ?? null, carryType: prior.carryType, handsHeld: prior.handsHeld }]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotDraw", "Could not draw the weapon.") }), error: t("Exec.CouldNotDraw", "Could not draw the weapon.") };
}

async function executeDropWeapon({ actor, action }) {
  const item = action?.item;
  if (!item) return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.NoWeaponDrop", "No weapon to drop.") }), error: t("Exec.NoWeaponDrop", "No weapon to drop.") };
  const prior = weaponCarryState(item);
  const changed = await changeWeaponCarry(actor, item, { carryType: "dropped", handsHeld: 0 });
  return changed
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.DroppedWeapon", "Dropped {name}.", { name: item.name ?? t("Exec.Weapon", "weapon") }), revert: revertEnvelope([{ kind: "carry-type", itemUuid: item.uuid ?? null, carryType: prior.carryType, handsHeld: prior.handsHeld }]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotDropWeapon", "Could not drop the weapon.") }), error: t("Exec.CouldNotDropWeapon", "Could not drop the weapon.") };
}

async function executeSheatheWeapon({ actor, action }) {
  const item = action?.item;
  if (!item) return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.NoWeaponSheathe", "No weapon to sheathe.") }), error: t("Exec.NoWeaponSheathe", "No weapon to sheathe.") };
  const prior = weaponCarryState(item);
  const changed = await changeWeaponCarry(actor, item, { carryType: "worn", handsHeld: 0 });
  return changed
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.Sheathed", "Sheathed {name}.", { name: item.name ?? t("Exec.Weapon", "weapon") }), revert: revertEnvelope([{ kind: "carry-type", itemUuid: item.uuid ?? null, carryType: prior.carryType, handsHeld: prior.handsHeld }]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotSheathe", "Could not sheathe the weapon.") }), error: t("Exec.CouldNotSheathe", "Could not sheathe the weapon.") };
}

// The actor's first non-stowed ammo (or ammo-capable weapon, e.g. a thrown combination weapon)
// compatible with this weapon -- mirrors PF2e's own ammunition-picker filter (isAmmoFor).
function findCompatibleAmmo(actor, weapon) {
  if (!weapon) return null;
  const pool = [
    ...collectionValues(actor?.itemTypes?.ammo),
    ...collectionValues(actor?.itemTypes?.weapon).filter((item) => item?.system?.usage?.canBeAmmo),
  ];
  return pool.find((item) => item?.isStowed !== true && typeof item?.isAmmoFor === "function" && item.isAmmoFor(weapon)) ?? null;
}

// weapon.subitems is a Foundry Collection (extends Map), not a plain array, so iterate with
// .forEach -- supported by both a real Collection and a plain-array test double.
function weaponSubitemQuantities(weapon) {
  const quantities = new Map();
  const subitems = weapon?.subitems;
  if (typeof subitems?.forEach === "function") {
    subitems.forEach((item) => quantities.set(item.id, Number(item.quantity ?? item.system?.quantity ?? 0)));
  }
  return quantities;
}

// Diff the weapon's loaded-ammo subitems before/after weapon.attach() to find which one grew (a
// fresh subitem, or an existing stack topped up) -- the same before/after pattern already used for
// consumables (consumableRevertOpAfterUse), since PF2e's attach() has no return value to inspect.
async function reloadRevertOpAfterAttach(weaponUuid, before) {
  if (!weaponUuid || typeof globalThis.fromUuid !== "function") return null;
  const weapon = await globalThis.fromUuid(weaponUuid);
  const subitems = weapon?.subitems;
  if (typeof subitems?.forEach !== "function") return null;
  let grown = null;
  subitems.forEach((item) => {
    if (grown) return;
    const quantityBefore = before.get(item.id) ?? 0;
    const quantityNow = Number(item.quantity ?? item.system?.quantity ?? 0);
    if (quantityNow > quantityBefore) grown = { kind: "reload", weaponUuid, subitemId: item.id, addedQuantity: quantityNow - quantityBefore };
  });
  return grown;
}

async function executeReloadWeapon({ actor, action }) {
  const weapon = action?.item;
  const ammo = findCompatibleAmmo(actor, weapon);
  if (weapon?.uuid && ammo && typeof weapon.attach === "function") {
    const before = weaponSubitemQuantities(weapon);
    await weapon.attach(ammo, { quantity: 1, stack: true });
    const reloadRevertOp = await reloadRevertOpAfterAttach(weapon.uuid, before);
    return {
      status: "done",
      patch: executionPatch({}, "done", {
        result: t("Exec.Reloaded", "Reloaded {name}.", { name: weapon.name }),
        revert: revertEnvelope(reloadRevertOp ? [reloadRevertOp] : []),
      }),
    };
  }
  // No compatible ammo in inventory to attach automatically -- fall back to a reminder, same as
  // PF2e's own sheet would leave the reload unresolved without ammo on hand.
  await createGuidance({ ...action, reason: t("Exec.ReloadReason", "Reload {name} before firing again.", { name: weapon?.name ?? t("Exec.YourWeapon", "your weapon") }) }, actor);
  return { status: "done", patch: executionPatch({}, "done", { result: t("Exec.PostedReloadReminder", "Posted reload reminder.") }) };
}

function pf2eActionsCollection() {
  return globalThis.game?.pf2e?.actions ?? null;
}

function slugToCamel(slug) {
  return String(slug ?? "")
    .toLowerCase()
    .replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
}

// PF2e exposes most actions as Action instances retrievable by slug (collection.get), but a
// few (e.g. Raise a Shield, Take Cover) are still legacy functions keyed by camelCase name
// (game.pf2e.actions.raiseAShield) and are NOT in the slug collection.
function pf2eActionBySlug(slug) {
  const collection = pf2eActionsCollection();
  if (!collection) return null;
  const fromGet = typeof collection.get === "function" ? collection.get(slug) : null;
  return fromGet ?? collection[slug] ?? collection[slugToCamel(slug)] ?? null;
}

function systemActionVariantList(systemAction) {
  const variants = systemAction?.variants;
  if (!variants) return [];
  if (Array.isArray(variants)) return variants;
  if (Array.isArray(variants.contents)) return variants.contents;
  if (typeof variants[Symbol.iterator] === "function") return Array.from(variants);
  return [];
}

function variantKey(variant) {
  return variant?.slug ?? variant?.id ?? null;
}

// PF2e's SingleCheckAction.use() throws when an action has multiple variants (e.g. Create a
// Diversion -> Distracting Words/Gesture/Trick, Perform -> Acting/Comedy/...) and none is
// requested. Resolve one: honour an explicit action.variant when valid, otherwise default to
// the action's first variant. Returns null when the action has 0-1 variants (let PF2e decide).
function resolveActionVariant(systemAction, action) {
  const variants = systemActionVariantList(systemAction);
  if (variants.length <= 1) return null;

  const requested = String(action?.variant ?? action?.variantSlug ?? "").trim();
  if (requested) {
    const match = variants.find((variant) => variantKey(variant) === requested);
    if (match) return variantKey(match);
  }
  return variantKey(variants[0]);
}

async function usePf2eAction({ actor, context, action, event, targetToken = null }) {
  const systemAction = pf2eActionBySlug(actionSlug(action));
  const options = {
    actors: actor ? [actor] : [],
    actor,
    event,
    target: targetActor(targetToken) ?? targetToken ?? null,
    statistic: action?.skill ?? action?.statistic,
    difficultyClass: action?.difficultyClass ?? action?.dc ?? null,
    traits: action?.traits,
  };

  // New-style Action instance.
  if (typeof systemAction?.use === "function") {
    const variant = resolveActionVariant(systemAction, action);
    const result = await systemAction.use({ ...options, ...(variant ? { variant } : {}) });
    // Many actions resolve without returning a value; report success so callers don't treat
    // a void result as a missing API.
    return result ?? { executed: true };
  }

  // Legacy function form (e.g. raiseAShield) — these read options.actors and return nothing.
  if (typeof systemAction === "function") {
    const result = await systemAction(options);
    return result ?? { executed: true };
  }

  return null;
}

async function executePf2eAction({ actor, context, step, action, event, choices }) {
  const target = requiresTargetForAction(action) ? resolveTarget(step, action, choices) : null;
  if (requiresTargetForAction(action) && !target) {
    return { status: "needs-choice", choices: ["target"], patch: {} };
  }
  if (target) setTarget(target.token);
  const result = await usePf2eAction({ actor, context, action, event, targetToken: target?.token ?? null });
  if (!result) {
    return {
      status: "failed",
      patch: executionPatch(target ? { targetTokenIds: [target.id], targetLabel: target.label } : {}, "failed", {
        error: t("Exec.NoActionApi", "PF2e action API is not available."),
      }),
      error: t("Exec.NoActionApi", "PF2e action API is not available."),
    };
  }
  return {
    status: "done",
    patch: executionPatch(target ? { targetTokenIds: [target.id], targetLabel: target.label } : {}, "done", {
      result: t("Exec.ActionOpened", "PF2e action opened."),
      revert: chatActionRevert(result, action, { target }),
    }),
    nativeResult: result,
  };
}

// Which PF2e strike variant to roll: 0 = full bonus, 1 = MAP -5/-4, 2 = MAP -10/-8. Honors an
// explicit choices.variantIndex, otherwise derives it from the step's attack position in the plan
// (attackIndex, 1-based) so the 2nd/3rd attack of a turn isn't rolled at full bonus.
function strikeVariantIndex(step, action, choices) {
  if (Number.isFinite(choices?.variantIndex)) return Math.max(0, Math.min(2, choices.variantIndex));
  // A player-pinned MAP level takes precedence over the position-derived one.
  if (Number.isFinite(step?.mapOverride)) return Math.max(0, Math.min(2, step.mapOverride));
  const attackIndex = numeric(step?.attackIndex ?? action?.attackIndex, null);
  return Number.isFinite(attackIndex) && attackIndex > 1 ? Math.min(2, attackIndex - 1) : 0;
}

function strikeVariant(action, index) {
  const variants = Array.isArray(action?.variants) ? action.variants : [];
  return variants[index] ?? null;
}

async function executeStrike({ step, action, event, choices }) {
  const target = resolveTarget(step, action, choices);
  if (!target) return { status: "needs-choice", choices: ["target"], patch: {} };
  setTarget(target.token);

  const variant = strikeVariant(action, strikeVariantIndex(step, action, choices));
  const roller = variant?.roll ?? action?.strike?.roll ?? action?.attack ?? action?.roll;
  if (typeof roller !== "function") {
    return {
      status: "failed",
      patch: executionPatch({ targetTokenIds: [target.id], targetLabel: target.label }, "failed", { error: t("Exec.NoStrikeApi", "Strike roll API is not available.") }),
      error: t("Exec.NoStrikeApi", "Strike roll API is not available."),
    };
  }
  // PF2e resolves the strike's target from game.user.targets (set above), the same way the
  // system does when you click a strike with a token targeted. Passing a custom target param
  // (an actor) suppressed the AC comparison, so the roll posted with no target / degree.
  const result = await roller.call(variant ?? action?.strike ?? action, { event });
  return {
    status: "done",
    patch: executionPatch({ targetTokenIds: [target.id], targetLabel: target.label }, "done", {
      result: t("Exec.StrikeOpened", "Strike roll opened."),
      revert: chatActionRevert(result, action, { target }),
    }),
    nativeResult: result,
  };
}

function isCantripSpell(item) {
  if (item?.isCantrip === true) return true;
  const traits = item?.system?.traits?.value;
  return Array.isArray(traits) && traits.includes("cantrip");
}

// Whether the spell's casting resource is available BEFORE casting. Returns true (castable),
// false (resource confirmed empty), or null ("can't tell" — cantrip-free innate/scroll/unknown
// prep — treat as castable and let PF2e be the judge). This replaces reading success from
// entry.cast()'s return value, which is unreliable (current PF2e resolves it to undefined even on a
// successful cast) — so cantrips and focus spells, which use no slot, were all flagged as failed.
function spellCastResourceSufficient(actor, entry, item, action) {
  if (isCantripSpell(item)) return true;
  const prepared = String(systemValue(entry?.system?.prepared) ?? "").toLowerCase();
  if (prepared === "focus") {
    const points = numeric(systemValue(actor?.system?.resources?.focus?.value), null);
    return Number.isFinite(points) ? points > 0 : null;
  }
  if (prepared === "spontaneous") {
    const slotKey = slotKeyForRank(action?.castRank ?? action?.rank);
    const slot = slotKey ? entry?.system?.slots?.[slotKey] : null;
    if (!slot) return null;
    const remaining = numeric(systemValue(slot.value ?? slot.remaining), null);
    return Number.isFinite(remaining) ? remaining > 0 : null;
  }
  // prepared / innate / items / unknown: don't second-guess PF2e — assume castable.
  return null;
}

async function waitForChatMessage(messagePromise, timeoutMs = 500) {
  const schedule = globalThis.setTimeout;
  if (typeof schedule !== "function") return null;

  let timeoutId = null;
  try {
    return await Promise.race([
      messagePromise,
      new Promise((resolve) => {
        timeoutId = schedule(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId != null && typeof globalThis.clearTimeout === "function") {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

export function findSpellcastingEntry(actor, action) {
  const id = action?.spellcastingEntryId;
  const uuid = action?.spellcastingEntryUuid;
  return collectionValues(actor?.itemTypes?.spellcastingEntry).find((entry) =>
    entry?.id === id
    || entry?._id === id
    || entry?.uuid === uuid,
  ) ?? null;
}

// Snapshot a consumable's quantity/uses (and full source data, in case it gets deleted entirely)
// BEFORE calling item.use() -- PF2e's own consumable-use logic decrements quantity/uses and, once
// spent, deletes the item outright, and there's no other point where the pre-use state is visible.
function consumableUseSnapshot(item) {
  if (!item || item.type !== "consumable" || !item.uuid) return null;
  return {
    itemUuid: item.uuid,
    quantityBefore: numeric(systemValue(item.system?.quantity), null),
    usesValueBefore: numeric(systemValue(item.system?.uses), null),
    sourceData: typeof item.toObject === "function" ? item.toObject() : null,
  };
}

// Resolve the same item by uuid AFTER use (mirroring revertCarryType's existing fromUuid lookup)
// to tell apart "quantity/uses decremented" from "fully consumed and deleted" -- fromUuid resolving
// to nothing is exactly PF2e's signal for the latter.
async function consumableRevertOpAfterUse(before, actor) {
  if (!before) return null;
  const stillExists = typeof globalThis.fromUuid === "function" ? await globalThis.fromUuid(before.itemUuid) : null;
  if (!stillExists) {
    return before.sourceData && actor?.uuid
      ? { kind: "consumable", deleted: true, actorUuid: actor.uuid, sourceData: before.sourceData }
      : null;
  }
  const quantityNow = numeric(systemValue(stillExists.system?.quantity), null);
  const usesNow = numeric(systemValue(stillExists.system?.uses), null);
  if (quantityNow === before.quantityBefore && usesNow === before.usesValueBefore) return null;
  return { kind: "consumable", itemUuid: before.itemUuid, quantityBefore: before.quantityBefore, usesValueBefore: before.usesValueBefore };
}

// Snapshot a limited-use item's Frequency ("3/day" etc.) BEFORE executing it. PF2e's own schema
// (FrequencyField, pf2e.mjs) defaults system.frequency.value to system.frequency.max and treats it
// as a genuine remaining-uses counter -- confirmed against the system's own consumption logic below.
function frequencySnapshot(item) {
  const valueBefore = numeric(systemValue(item?.system?.frequency?.value), null);
  return valueBefore === null || !item?.uuid ? null : { itemUuid: item.uuid, valueBefore };
}

// The system's own item-use flow (createUseActionMessage, pf2e.mjs) decrements Frequency before
// posting the chat card -- but only for its own sheet/hotbar "use" button. Our generic fallback below
// posts via item.toMessage() directly, which skips that entirely, so a "3/day" feat like Quickened
// Casting never actually spent its use no matter how many times it was played. Replicate the same
// decrement (item.update({ "system.frequency.value": value - 1 })) here. Skipped when the value
// already moved by the time we check, so a native path that manages its own Frequency is never
// double-spent.
async function consumeFrequencyIfUnspent(before) {
  if (!before || typeof globalThis.fromUuid !== "function") return null;
  const item = await globalThis.fromUuid(before.itemUuid);
  const valueNow = numeric(systemValue(item?.system?.frequency?.value), null);
  if (valueNow === null || valueNow !== before.valueBefore || valueNow <= 0 || typeof item?.update !== "function") return null;
  await item.update({ "system.frequency.value": valueNow - 1 });
  return { kind: "frequency", itemUuid: before.itemUuid, valueBefore: before.valueBefore };
}

async function executeNativeItem({ actor, action, event }) {
  const item = action?.item;
  const entry = findSpellcastingEntry(actor, action);
  if (typeof entry?.cast === "function") {
    // Decide failure from the resource BEFORE casting (false = confirmed empty); never from
    // entry.cast()'s return value, which is undefined even on success in current PF2e and made
    // every spell look like a failed cast. PF2e's cast() still consumes the resource and posts the
    // card; we capture that card (best effort, via the hook) only so revert can delete it.
    const resourceOk = spellCastResourceSufficient(actor, entry, item, action);
    const actorId = actor?.id ?? actor?._id ?? null;
    let castMessage = null;
    let resolveCastMessage = null;
    const castMessagePromise = new Promise((resolve) => { resolveCastMessage = resolve; });
    const onCreate = (message) => {
      if (castMessage) return;
      const messageActorId = message?.speaker?.actor ?? null;
      if (!actorId || !messageActorId || messageActorId === actorId) castMessage = message;
      if (castMessage) resolveCastMessage?.(castMessage);
    };
    const hookId = globalThis.Hooks?.on?.("createChatMessage", onCreate) ?? null;
    try {
      const returned = await entry.cast(item, {
        event,
        rank: action?.castRank ?? action?.rank,
        slotId: action?.slotId ?? action?.location,
      });
      if (!castMessage && returned && typeof returned === "object") castMessage = returned;
      if (!castMessage && hookId != null) castMessage = await waitForChatMessage(castMessagePromise) ?? null;
    } finally {
      if (hookId != null) globalThis.Hooks?.off?.("createChatMessage", hookId);
    }
    return { spellCast: true, message: castMessage, castFailed: resourceOk === false };
  }
  if (typeof action?.generatedAction?.use === "function") return action.generatedAction.use({ event });
  if (typeof item?.use === "function") {
    const before = consumableUseSnapshot(item);
    const used = await item.use({ event });
    const consumableRevertOp = before ? await consumableRevertOpAfterUse(before, actor) : null;
    return consumableRevertOp ? { ...used, consumableRevertOp } : used;
  }
  // Real PF2e consumable documents (potions, scrolls, wands, etc.) have no .use() -- the system's
  // own API for spending a charge/quantity is .consume(thisMany), which posts its own chat message
  // internally and returns nothing, so there's no nativeResult to inspect for a message id here.
  if (typeof item?.consume === "function" && item.type === "consumable") {
    const before = consumableUseSnapshot(item);
    await item.consume();
    const consumableRevertOp = before ? await consumableRevertOpAfterUse(before, actor) : null;
    return consumableRevertOp ? { consumableRevertOp } : null;
  }
  if (typeof item?.cast === "function") return item.cast({ event, rank: action?.castRank ?? action?.rank });
  // A feat/action item has no callable .use() of its own -- the sheet's "Use" button instead
  // dispatches to the system's own createUseActionMessage, which (unlike a bare toMessage()) spends
  // Frequency, runs an embedded crafting ability's formula picker (e.g. Quick Alchemy), and applies
  // a selfEffect. That function isn't exported, but game.pf2e.rollItemMacro -- the public entry
  // point real hotbar "Use" macros call -- wraps it for exactly these two item types. Falling
  // straight to toMessage() below would silently skip all of that and just post the description.
  if (item?.isOfType?.("action", "feat") && typeof globalThis.game?.pf2e?.rollItemMacro === "function" && item.uuid) {
    const macroResult = await globalThis.game.pf2e.rollItemMacro(item.uuid, event);
    if (macroResult) return macroResult;
  }
  if (typeof item?.toMessage === "function") return item.toMessage({}, { rollMode: globalThis.game?.settings?.get?.("core", "rollMode") });
  if (typeof item?.sheet?.render === "function") {
    await item.sheet.render(true);
    return { openedSheet: true };
  }
  return null;
}

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

async function createGuidance(action, actor) {
  const content = `<strong>${escapeHtml(action?.name ?? t("Exec.ActionName", "Action"))}</strong><br>${escapeHtml(action?.reason ?? t("Exec.ReviewActionLong", "Review this action before resolving it."))}`;
  if (globalThis.ChatMessage?.create) {
    await globalThis.ChatMessage.create({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) ?? {},
      content,
      whisper: globalThis.game?.user?.id ? [globalThis.game.user.id] : undefined,
    });
    return true;
  }
  globalThis.ui?.notifications?.info?.(`${action?.name ?? t("Exec.ActionName", "Action")}: ${action?.reason ?? t("Exec.ReviewAction", "Review this action.")}`);
  return true;
}

function normalizeSpellKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Resolve the spell being sustained: prefer the stored UUID, fall back to matching the actor's
// own spells by slug (the sustained-spell entry is keyed by the spell's normalized slug).
async function resolveSustainedSpell(actor, sustained) {
  const uuid = sustained?.spellUuid;
  if (uuid && typeof globalThis.fromUuid === "function") {
    try {
      const document = await globalThis.fromUuid(uuid);
      if (document) return document;
    } catch (_error) {
      // Fall through to a slug match on the actor.
    }
  }
  const target = normalizeSpellKey(sustained?.id ?? sustained?.spellSlug ?? sustained?.name);
  if (!target) return null;
  return collectionValues(actor?.itemTypes?.spell).find(
    (spell) => normalizeSpellKey(spell?.slug ?? spell?.system?.slug ?? spell?.name) === target,
  ) ?? null;
}

// Sustaining re-posts the spell's chat card so the player can re-use its data (re-apply effects,
// re-roll damage, click its buttons) for the extended round. The posted card is captured as a
// chat revert op so undoing the Sustain step also removes the re-posted message.
async function executeSustainSpell({ actor, step, action }) {
  const sustained = step?.sustainedSpell ?? {};
  const spell = await resolveSustainedSpell(actor, sustained);
  let messageId = null;
  if (typeof spell?.toMessage === "function") {
    const message = await spell.toMessage(undefined, {
      rollMode: globalThis.game?.settings?.get?.("core", "rollMode"),
    });
    messageId = chatMessageIdFromResult({ message }) ?? message?.id ?? message?._id ?? null;
  } else {
    await createGuidance({ ...action, reason: sustained?.name ? t("Exec.SustainReason", "Sustain {name}.", { name: sustained.name }) : action?.reason }, actor);
  }
  return {
    status: "done",
    patch: executionPatch({}, "done", {
      result: spell ? t("Exec.RePosted", "Re-posted {name}.", { name: spell.name ?? sustained?.name ?? t("Exec.Spell", "spell") }) : t("Exec.PostedSustainReminder", "Posted sustain reminder."),
      revert: revertEnvelope(messageId ? [{ kind: "chat", messageId }] : []),
    }),
  };
}

function areaType(action, marker) {
  return String(
    marker?.shape
    ?? marker?.type
    ?? action?.targetingProfile?.type
    ?? action?.targetingProfile?.shape
    ?? action?.area?.type
    ?? "burst",
  ).toLowerCase();
}

function areaDistance(action, marker) {
  return numeric(marker?.distance ?? marker?.radius ?? action?.targetingProfile?.distance ?? action?.targetingProfile?.radius, 5) || 5;
}

function areaWidth(action, marker) {
  return numeric(marker?.width ?? action?.targetingProfile?.width, globalThis.canvas?.grid?.size ?? areaDistance(action, marker)) || areaDistance(action, marker);
}

function tokenBase(context) {
  const token = canvasTokenById(tokenId(context));
  const size = gridSize();
  const center = point(token?.center) ?? point(context?.token?.center) ?? { x: 0, y: 0 };
  const footprint = tokenFootprint(token, context);
  return {
    type: "token",
    x: center.x - (footprint.width * size) / 2,
    y: center.y - (footprint.height * size) / 2,
    width: footprint.width * size,
    height: footprint.height * size,
  };
}

export function createAreaRegionData({ context, action, marker }) {
  const center = point(marker?.center) ?? point(marker) ?? point(context?.token?.center) ?? { x: 0, y: 0 };
  const type = areaType(action, marker);
  const distance = areaDistance(action, marker);
  const width = areaWidth(action, marker);
  const distancePx = distancePixels(distance);
  const widthPx = distancePixels(width);
  const rotation = numeric(marker?.rotation, 0) || 0;
  const baseShape = { x: center.x, y: center.y };
  let shape;

  if (type === "cone") {
    shape = { ...baseShape, type: "cone", radius: distancePx, angle: numeric(marker?.angle, 90) || 90, rotation };
  } else if (type === "line") {
    shape = { ...baseShape, type: "line", length: distancePx, width: widthPx, rotation };
  } else if (type === "cube" || type === "square") {
    shape = { ...baseShape, type: "rectangle", width: distancePx, height: distancePx, rotation };
  } else if (type === "emanation") {
    shape = { ...baseShape, type: "emanation", radius: distancePx, base: tokenBase(context) };
  } else if (type === "ring") {
    shape = {
      ...baseShape,
      type: "ring",
      radius: distancePx,
      innerWidth: distancePixels(numeric(marker?.innerWidth ?? action?.targetingProfile?.innerWidth, Math.max(0, distance - width)) || 0),
      outerWidth: widthPx,
    };
  } else {
    shape = { ...baseShape, type: "circle", radius: distancePx };
  }

  const originUuid = action?.item?.uuid ?? action?.uuid ?? null;
  const flags = { pf2e: { areaShape: type } };
  if (originUuid) flags["pf2e-combater"] = { originUuid };

  return {
    name: marker?.label ?? action?.name ?? "Planned area",
    shapes: [shape],
    color: marker?.color ?? "#f0b34a",
    highlightMode: "coverage",
    displayMeasurements: true,
    visibility: globalThis.CONST?.REGION_VISIBILITY?.ALWAYS ?? 1,
    flags,
  };
}

function regionIdFromCreated(created) {
  const doc = Array.isArray(created) ? created[0] : created;
  return doc?.id ?? doc?._id ?? null;
}

async function createAreaRegion({ context, action, marker }) {
  const data = createAreaRegionData({ context, action, marker });
  const scene = globalThis.canvas?.scene;
  const sceneId = scene?.id ?? scene?._id ?? null;
  if (typeof scene?.createEmbeddedDocuments === "function") {
    const created = await scene.createEmbeddedDocuments("Region", [data]);
    return { data, regionId: regionIdFromCreated(created), sceneId };
  }
  if (typeof globalThis.canvas?.regions?.placeRegion === "function") {
    const placed = await globalThis.canvas.regions.placeRegion(data);
    return { data, regionId: regionIdFromCreated(placed), sceneId };
  }
  throw new Error(t("Exec.NoRegionApi", "Region creation API is not available."));
}

function spellDurationInfo(action) {
  const raw = action?.activityProfile?.duration ?? action?.item?.system?.duration?.value ?? "";
  const sustained = action?.activityProfile?.sustained === true
    || action?.item?.system?.duration?.sustained === true;
  return parseSpellDuration(raw, { sustained });
}

// Link a placed area region to a duration: create a PF2e timer effect on the caster (the
// visible countdown badge) and stamp the region with a plain expiry the GM sweep can act on.
// The region flag is the removal backbone, so this still works if effect creation fails.
async function createAreaTimer({ context, action, region }) {
  const duration = spellDurationInfo(action);
  if (!duration || !region?.regionId) return null;

  const worldTime = numeric(globalThis.game?.time?.worldTime);
  const combat = globalThis.game?.combat ?? null;
  const round = numeric(combat?.round);
  const initiative = numeric(combat?.combatant?.initiative);
  const actor = actorDocument(context);

  let effectUuid = null;
  if (typeof actor?.createEmbeddedDocuments === "function") {
    try {
      const data = buildAreaTimerEffectData({
        action,
        regionId: region.regionId,
        sceneId: region.sceneId,
        duration,
        worldTime,
        initiative,
      });
      const created = await actor.createEmbeddedDocuments("Item", [data]);
      const effect = Array.isArray(created) ? created[0] : created;
      effectUuid = effect?.uuid ?? null;
    } catch (_error) {
      // The effect is only the visible badge; removal still works from the region flag.
    }
  }

  const flag = buildAreaTimerFlag({ duration, worldTime, round, effectUuid, casterActorUuid: actor?.uuid ?? null });
  const scene = (region.sceneId && globalThis.game?.scenes?.get?.(region.sceneId)) ?? globalThis.canvas?.scene ?? null;
  if (flag && typeof scene?.updateEmbeddedDocuments === "function") {
    try {
      await scene.updateEmbeddedDocuments("Region", [{ _id: region.regionId, "flags.pf2e-combater.areaTimer": flag }]);
    } catch (_error) {
      // Non-fatal: the region simply will not auto-expire.
    }
  }
  return { effectUuid };
}

// Point-in-shape test against the same pixel-space shape descriptor used to draw the region,
// so the tokens we target match exactly what the placed template covers.
function pointInAreaShape(value, shape) {
  const dx = value.x - shape.x;
  const dy = value.y - shape.y;
  switch (shape.type) {
    case "circle":
    case "emanation":
      return dx * dx + dy * dy <= shape.radius * shape.radius;
    case "ring": {
      const distance = Math.hypot(dx, dy);
      const inner = Math.max(0, numeric(shape.radius, 0) - numeric(shape.outerWidth, 0));
      return distance <= shape.radius && distance >= inner;
    }
    case "cone": {
      const distance = Math.hypot(dx, dy);
      if (distance > shape.radius) return false;
      if (distance === 0) return true;
      const pointAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const half = (numeric(shape.angle, 90) || 90) / 2;
      const delta = ((((pointAngle - numeric(shape.rotation, 0)) % 360) + 540) % 360) - 180;
      return Math.abs(delta) <= half;
    }
    case "line": {
      const radians = (numeric(shape.rotation, 0) * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const along = dx * cos + dy * sin;
      const perpendicular = -dx * sin + dy * cos;
      return along >= 0 && along <= shape.length && Math.abs(perpendicular) <= shape.width / 2;
    }
    case "rectangle": {
      const radians = (numeric(shape.rotation, 0) * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      return localX >= 0 && localX <= shape.width && localY >= 0 && localY <= shape.height;
    }
    default:
      return false;
  }
}

// Canvas tokens whose center falls inside the placed area template.
export function tokensInAreaMarker({ context, action, marker }) {
  const shape = createAreaRegionData({ context, action, marker })?.shapes?.[0];
  if (!shape) return [];
  return (globalThis.canvas?.tokens?.placeables ?? []).filter((token) => {
    const center = point(token?.center);
    return center && pointInAreaShape(center, shape);
  });
}

function pf2eDamageRollClass() {
  return globalThis.game?.pf2e?.DamageRoll
    ?? globalThis.CONFIG?.Dice?.rolls?.find?.((cls) => cls?.name === "DamageRoll")
    ?? null;
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function actionDisplayName(action) {
  return action?.item?.name ?? action?.name ?? "Damage";
}

function damageContextOptions(action) {
  const slug = actionContextSlug(action);
  const options = [];
  if (slug) {
    options.push(`item:slug:${slug}`, `self:action:slug:${slug}`);
  }
  const cost = numeric(action?.actionCost ?? action?.cost);
  if (cost) options.push(`self:action:cost:${cost}`);
  return options;
}

function damageTargetFlag(target) {
  const token = target?.token ?? target;
  const actor = targetActor(token);
  const tokenUuid = targetTokenUuid(token);
  return actor?.uuid && tokenUuid ? { actor: actor.uuid, token: tokenUuid } : null;
}

function damageOriginFlag(action) {
  if (typeof action?.item?.getOriginData === "function") return action.item.getOriginData();
  const uuid = action?.item?.uuid ?? action?.uuid ?? action?.sourceId ?? null;
  if (!uuid) return null;
  return { uuid };
}

function damageMessageFlags({ actor, action, target }) {
  const slug = actionContextSlug(action);
  const targetFlag = damageTargetFlag(target);
  const origin = damageOriginFlag(action);
  const traits = Array.isArray(action?.traits)
    ? action.traits
    : Array.isArray(action?.item?.system?.traits?.value)
      ? action.item.system.traits.value
      : [];
  return {
    pf2e: {
      context: {
        type: "damage-roll",
        sourceType: action?.attackTrait ? "attack" : "save",
        actor: actor?.id ?? null,
        token: actor?.token?.id ?? null,
        target: targetFlag,
        domains: slug ? [`${slug}-damage`, "damage-roll"] : ["damage-roll"],
        options: damageContextOptions(action),
        contextualOptions: {},
        traits,
        notes: [],
        secret: false,
        outcome: null,
        unadjustedOutcome: null,
      },
      target: targetFlag,
      ...(origin ? { origin } : {}),
      modifiers: [],
      dice: [],
    },
  };
}

function damageFlavor(action) {
  return `<h4 class="action">${htmlEscape(actionDisplayName(action))}</h4>`;
}

// The @Damage formula to roll: prefer the classifier's parsed profile, but fall back to
// parsing @Damage[...] straight from the action/item description (the profile's shape varies
// by source and often carries only an average, not a formula).
function actionDamageFormula(action) {
  const profileFormula = action?.damageProfile?.formula;
  if (profileFormula) {
    return { formula: String(profileFormula).trim(), type: action.damageProfile.type ?? null };
  }
  const raw = [
    action?.description?.value ?? action?.description,
    action?.system?.description?.value ?? action?.system?.description,
    action?.item?.system?.description?.value ?? action?.item?.system?.description,
    action?.item?.description?.value ?? action?.item?.description,
  ].filter((value) => typeof value === "string").join(" ");
  const match = raw.match(/@Damage\[([^\][]+)(?:\[([^\]]+)\])?/i);
  if (!match) return null;
  return { formula: String(match[1]).trim(), type: match[2] ? String(match[2]).trim() : null };
}

// Best-effort: roll an action's @Damage[...] to chat. Strikes and PF2e actions roll their own
// damage, so this only runs for the open-item / custom path. Returns the produced chat message
// id (so revert can delete it) or null.
async function rollActionDamage({ actor, action, target = null, timestamp = null }) {
  const parsed = actionDamageFormula(action);
  if (!parsed?.formula) return null;
  const DamageRoll = pf2eDamageRollClass();
  if (typeof DamageRoll !== "function") return null;

  const { formula } = parsed;
  const type = parsed.type ? String(parsed.type).toLowerCase() : null;
  const typed = !type || /\[[^\]]+\]/.test(formula) ? formula : `(${formula})[${type}]`;
  try {
    const rollData = typeof actor?.getRollData === "function" ? actor.getRollData() : {};
    const showBreakdown = globalThis.game?.pf2e?.settings?.metagame?.breakdowns || Boolean(actor?.hasPlayerOwner);
    const roll = new DamageRoll(typed, rollData, { showBreakdown });
    if (typeof roll.evaluate === "function") await roll.evaluate();
    if (typeof roll.toMessage !== "function") return null;
    const message = await roll.toMessage({
      speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? {},
      flavor: damageFlavor(action),
      flags: damageMessageFlags({ actor, action, target }),
      // Stamp the damage strictly after the spell/action card so the chat log always sorts the
      // card first, even if the card's creation resolves on a later tick than this roll.
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
    });
    return message?.id ?? message?._id ?? null;
  } catch (error) {
    globalThis.console?.warn?.("pf2e-combater | Auto damage roll failed", error);
    return null;
  }
}

function damageRollCount(action) {
  if (action?.activityProfile?.damageScalesWithActions !== true) return 1;
  const cost = numeric(action?.actionCost ?? action?.cost, 1);
  return Math.max(1, Math.min(3, cost || 1));
}

// Yield a macrotask so any chat message the action just posted (e.g. a spell/strike card)
// is committed before we post damage, keeping the damage message after it in the log.
async function flushPendingChat() {
  const schedule = globalThis.setTimeout;
  if (typeof schedule !== "function") return;
  await new Promise((resolve) => { schedule(resolve, 0); });
}

async function rollActionDamageMessages({ actor, action, target = null, after = null }) {
  const count = damageRollCount(action);
  const base = Number.isFinite(after) ? after : null;
  const messageIds = [];
  for (let index = 0; index < count; index += 1) {
    const timestamp = base != null ? base + 1 + index : null;
    const messageId = await rollActionDamage({ actor, action, target, timestamp });
    if (messageId) messageIds.push(messageId);
  }
  return messageIds;
}

async function executeOpenItem({ actor, action, event }) {
  const frequencyBefore = frequencySnapshot(action?.item);
  const result = await executeNativeItem({ actor, action, event });
  if (result) {
    const frequencyRevertOp = await consumeFrequencyIfUnspent(frequencyBefore);
    return frequencyRevertOp ? { ...result, frequencyRevertOp } : result;
  }
  // Open the compendium entry (e.g. pf2e.actionspf2e) rather than posting a chat reminder.
  const uuid = action?.uuid ?? action?.sourceId;
  if (uuid && typeof globalThis.fromUuid === "function") {
    try {
      const document = await globalThis.fromUuid(uuid);
      if (typeof document?.sheet?.render === "function") {
        await document.sheet.render(true);
        return { openedSheet: true };
      }
    } catch (_error) {
      // Fall through to guidance if the entry can't be resolved.
    }
  }
  if (action?.item || uuid) return { opened: true };
  await createGuidance(action, actor);
  return { guidance: true };
}

// A placed area template should remain on the canvas only for spells whose effect lingers
// (sustained, or a lasting duration like a wall/cloud). An instantaneous burst/cone is just a
// targeting aid, so its template is not left behind after execution. Non-spell area actions keep
// their region (the system has no duration data to judge them by).
function areaTemplatePersists(action) {
  const profile = action?.activityProfile ?? {};
  const isSpell = profile.spell === true
    || /spell/.test(String(action?.source ?? "").toLowerCase());
  if (!isSpell) return true;
  return profile.sustained === true || profile.lastingDuration === true;
}

// A teleportation action (e.g. Translocate) picks a destination like a Stride but is delivered
// instantly — it casts the spell and repositions the token with no movement animation.
function isTeleportAction(action) {
  return action?.activityProfile?.teleport === true;
}

// Place the token at the destination instantly (no movement animation). `origin` is captured by the
// caller BEFORE the spell is cast — some teleport spells reposition the token themselves, and reading
// the origin afterwards would record the destination, leaving revert with nothing to undo. Returns a
// movement revert op so undoing the step returns the token to where it teleported from.
async function teleportTokenTo(context, action, destination, origin) {
  const token = canvasTokenById(tokenId(context));
  const document = token?.document ?? context?.combatant?.token ?? context?.token?.document;
  if (!document) return null;
  const moveTokenId = targetTokenId(token) ?? tokenId(context);
  const waypoint = tokenWaypointForDestination(destination, token, context, action);
  if (waypoint && typeof document.update === "function") {
    const elevation = numeric(waypoint.elevation);
    await document.update(
      { x: waypoint.x, y: waypoint.y, ...(elevation === null ? {} : { elevation }) },
      { animate: false },
    );
  }
  return origin && moveTokenId ? { kind: "movement", tokenId: moveTokenId, origin } : null;
}

// Cast the teleportation spell (posts the card, spends the slot/focus) and then move the token to
// the chosen destination instantly. Reverting undoes the teleport, the chat card, and the slot.
async function executeTeleport({ context, step, action, event, choices, patch = {} }) {
  const destination = destinationFromStep(step, choices);
  if (!destination) return { status: "needs-choice", choices: ["destination"], patch: {} };

  const actor = actorDocument(context);
  // Capture the take-off position BEFORE casting — a teleport spell may move the token itself, and
  // reading the origin afterwards would record the destination, so revert would no-op.
  const teleportToken = canvasTokenById(tokenId(context));
  const teleportOrigin = movementOrigin(teleportToken, teleportToken?.document ?? context?.combatant?.token ?? context?.token?.document, context);
  const slotOp = spellSlotRevertOp(actor, action);
  const nativeResult = await executeOpenItem({ actor, action, event });
  if (nativeResult?.spellCast === true && nativeResult?.castFailed === true) {
    const reason = action?.unavailableReason || t("Exec.SpellNoSlot", "Spell could not be cast (no slot available).");
    return {
      status: "failed",
      patch: executionPatch({ ...patch, destination }, "failed", { error: reason }),
      error: reason,
      nativeResult,
    };
  }

  const teleportOp = await teleportTokenTo(context, action, destination, teleportOrigin);
  await flushPendingChat();
  const cardTimestamp = Number(nativeResult?.message?.timestamp);
  const damageMessageIds = await rollActionDamageMessages({
    actor,
    action,
    target: null,
    after: Number.isFinite(cardTimestamp) ? cardTimestamp : null,
  });
  let result = {
    status: "done",
    patch: executionPatch({ ...patch, destination }, "done", {
      result: t("Exec.Teleported", "Teleported to the chosen space."),
      revert: chatActionRevert(nativeResult, action, { slotOp }),
    }),
    nativeResult,
  };
  for (const damageMessageId of [...damageMessageIds].reverse()) {
    result = attachRevertOp(result, { kind: "chat", messageId: damageMessageId });
  }
  if (teleportOp) result = attachRevertOp(result, teleportOp);
  return result;
}

export async function executeDraftStep({ context, step, action = step?.action ?? step, event = null, choices = {} } = {}) {
  if (!step || !action) return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.NoActionSelected", "No action selected.") }), error: t("Exec.NoActionSelected", "No action selected.") };

  const resolvedAction = executionAction(step, action);
  const actor = actorDocument(context);
  const slug = actionSlug(resolvedAction);
  const patch = {};
  const destination = destinationFromStep(step, choices);
  if (destination) patch.destination = destination;

  const target = requiresTargetForAction(resolvedAction) ? resolveTarget(step, resolvedAction, choices) : null;
  if (requiresTargetForAction(resolvedAction)) {
    if (!target) return { status: "needs-choice", choices: ["target"], patch };
    patch.targetTokenIds = [target.id];
    patch.targetLabel = target.label;
  }

  const areaMarker = areaMarkerFromStep(step, choices);
  let regionOp = null;
  if (requiresAreaMarkerForAction(resolvedAction)) {
    if (!areaMarker) return { status: "needs-choice", choices: ["area"], patch };
    patch.areaMarker = areaMarker;
    // Only leave a persistent region for lingering areas; instantaneous bursts/cones just target.
    if (areaTemplatePersists(resolvedAction)) {
      const region = await createAreaRegion({ context, action: resolvedAction, marker: areaMarker });
      if (region?.regionId) {
        const timer = await createAreaTimer({ context, action: resolvedAction, region });
        regionOp = {
          kind: "region",
          regionId: region.regionId,
          sceneId: region.sceneId ?? null,
          ...(timer?.effectUuid ? { effectUuid: timer.effectUuid } : {}),
        };
      }
    }
    const insideTokens = tokensInAreaMarker({ context, action: resolvedAction, marker: areaMarker });
    if (insideTokens.length) {
      setTokenTargets(insideTokens);
      patch.targetTokenIds = insideTokens.map((token) => targetTokenId(token)).filter(Boolean);
    }
  }

  let result;
  if (isTeleportAction(resolvedAction)) {
    result = await executeTeleport({ context, step, action: resolvedAction, event, choices, patch });
  } else if (requiresDestinationForAction(resolvedAction)) {
    result = await executeMovement({ context, step, action: resolvedAction, choices });
  } else if (slug === "stand") {
    result = await executeStand(actor);
  } else if (slug === "drop-prone") {
    result = await executeDropProne(actor);
  } else if (slug === "sustain-a-spell") {
    result = await executeSustainSpell({ actor, step, action: resolvedAction });
  } else if (slug === "retch") {
    result = await executeRetch({ actor, context, action: resolvedAction, event, choices });
  } else if (resolvedAction?.executable === "draw-weapon") {
    result = await executeDrawWeapon({ actor, action: resolvedAction });
  } else if (resolvedAction?.executable === "drop-weapon") {
    result = await executeDropWeapon({ actor, action: resolvedAction });
  } else if (resolvedAction?.executable === "sheathe-weapon") {
    result = await executeSheatheWeapon({ actor, action: resolvedAction });
  } else if (resolvedAction?.executable === "reload-weapon") {
    result = await executeReloadWeapon({ actor, action: resolvedAction });
  } else if (resolvedAction?.executable === "strike" || resolvedAction?.source === "strike") {
    result = await executeStrike({ step, action: resolvedAction, event, choices });
  } else if (resolvedAction?.executable === "pf2e-action") {
    result = await executePf2eAction({ actor, context, step, action: resolvedAction, event, choices });
  } else {
    const slotOp = spellSlotRevertOp(actor, resolvedAction);
    const nativeResult = await executeOpenItem({ actor, action: resolvedAction, event });
    // A spell that can't be cast (no slot / focus point) warns and posts no card. Don't roll its
    // damage in that case — the cast never happened. (A spell merely opened via the fallback path,
    // with no spellcasting entry, is not a failed cast and still rolls its @Damage.)
    if (nativeResult?.spellCast === true && nativeResult?.castFailed === true) {
      const reason = resolvedAction?.unavailableReason || t("Exec.SpellNoSlot", "Spell could not be cast (no slot available).");
      result = {
        status: "failed",
        patch: executionPatch(patch, "failed", { error: reason }),
        error: reason,
        nativeResult,
      };
    } else {
      // Let the action's own chat card commit before rolling damage, so the damage message
      // always lands after the spell/strike card instead of racing ahead of it. The timestamp on
      // the card is the reliable anchor: damage is stamped strictly after it so the log sorts the
      // card first even when the card's creation resolves on a later tick.
      await flushPendingChat();
      const cardTimestamp = Number(nativeResult?.message?.timestamp);
      const damageMessageIds = await rollActionDamageMessages({
        actor,
        action: resolvedAction,
        target,
        after: Number.isFinite(cardTimestamp) ? cardTimestamp : null,
      });
      result = {
        status: "done",
        patch: executionPatch(patch, "done", {
          result: nativeResult?.opened ? t("Exec.OpenedAction", "Opened action.") : t("Exec.ExecutedAction", "Executed action."),
          revert: chatActionRevert(nativeResult, resolvedAction, { target, slotOp }),
        }),
        nativeResult,
      };
      for (const damageMessageId of [...damageMessageIds].reverse()) {
        result = attachRevertOp(result, { kind: "chat", messageId: damageMessageId });
      }
    }
  }

  return attachRevertOp(result, regionOp);
}
