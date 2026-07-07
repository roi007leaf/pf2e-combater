import { isSelfCenteredAreaAction, isTargetCenteredAreaAction, requiresAreaMarkerForAction } from "../action/requirements.js";
import { areaRegionDistance, areaRegionType, createAreaRegionData, tokensInAreaMarker } from "../area/region.js";
import { buildAreaTimerEffectData, buildAreaTimerFlag, parseSpellDuration } from "../area/duration.js";
import { contextActorDocument } from "../actor-context.js";
import { canvasTokenById, setTokenTargets, targetTokenId, tokenId } from "./targets.js";
import { t } from "../../i18n.js";

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function point(value) {
  const x = numeric(value?.x);
  const y = numeric(value?.y);
  if (x === null || y === null) return null;
  const elevation = numeric(value?.elevation);
  return elevation === null ? { x, y } : { x, y, elevation };
}

function regionIdFromCreated(created) {
  const doc = Array.isArray(created) ? created[0] : created;
  return doc?.id ?? doc?._id ?? null;
}

export function areaMarkerFromStep(step, choices = {}) {
  return choices.areaMarker ?? step?.areaMarker ?? null;
}

function autoSelfCenteredAreaMarker(context, action) {
  if (!isSelfCenteredAreaAction(action)) return null;
  const center = point(context?.token?.center);
  if (!center) return null;
  const distance = numeric(action?.targetingProfile?.distance ?? action?.targetingProfile?.radius, 5) || 5;
  return {
    shape: "emanation",
    center,
    distance,
    width: numeric(action?.targetingProfile?.width, 5) || 5,
    rotation: 0,
    originTokenId: context?.token?.id ?? context?.token?.uuid ?? null,
    label: `Emanation ${distance} ft`,
  };
}

function autoTargetCenteredAreaMarker(target, action) {
  if (!isTargetCenteredAreaAction(action)) return null;
  const center = point(target?.token?.center);
  if (!center) return null;
  const distance = numeric(action?.targetingProfile?.distance ?? action?.targetingProfile?.radius, 5) || 5;
  return {
    shape: "emanation",
    center,
    distance,
    width: numeric(action?.targetingProfile?.width, 5) || 5,
    rotation: 0,
    originTokenId: target?.token?.id ?? target?.token?.uuid ?? null,
    label: `Emanation ${distance} ft`,
  };
}

export function executionAreaMarker({ context, action, step, choices = {}, target = null }) {
  return areaMarkerFromStep(step, choices)
    ?? autoSelfCenteredAreaMarker(context, action)
    ?? autoTargetCenteredAreaMarker(target, action);
}

export function needsAreaChoiceForExecution(step, action) {
  return requiresAreaMarkerForAction(action)
    && !areaMarkerFromStep(step)
    && !isSelfCenteredAreaAction(action)
    && !isTargetCenteredAreaAction(action);
}

export async function createAreaRegion({ context, action, marker, target = null }) {
  const data = createAreaRegionData({ context, action, marker });
  const scene = globalThis.canvas?.scene;
  const sceneId = scene?.id ?? scene?._id ?? null;

  const selfCentered = isSelfCenteredAreaAction(action);
  const targetCentered = isTargetCenteredAreaAction(action);
  if (areaRegionType(action, marker) === "emanation" && (selfCentered || targetCentered) && typeof globalThis.RegionDocument?.createTokenEmanation === "function") {
    const tokenDocument = selfCentered ? canvasTokenById(tokenId(context))?.document : target?.token?.document;
    if (tokenDocument) {
      const { shapes: _shapes, elevation: _elevation, ...regionDataWithoutGeometry } = data;
      const created = await globalThis.RegionDocument.createTokenEmanation(
        tokenDocument,
        areaRegionDistance(action, marker),
        regionDataWithoutGeometry,
      );
      if (created) return { data, regionId: regionIdFromCreated(created), sceneId };
    }
  }

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

export async function createAreaTimer({ context, action, region }) {
  const duration = spellDurationInfo(action);
  if (!duration || !region?.regionId) return null;

  const worldTime = numeric(globalThis.game?.time?.worldTime);
  const combat = globalThis.game?.combat ?? null;
  const round = numeric(combat?.round);
  const initiative = numeric(combat?.combatant?.initiative);
  const actor = contextActorDocument(context, { allowActorFallback: true });

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
      // Effect is visual badge only; region flag still drives cleanup.
    }
  }

  const flag = buildAreaTimerFlag({ duration, worldTime, round, effectUuid, casterActorUuid: actor?.uuid ?? null });
  const scene = (region.sceneId && globalThis.game?.scenes?.get?.(region.sceneId)) ?? globalThis.canvas?.scene ?? null;
  if (flag && typeof scene?.updateEmbeddedDocuments === "function") {
    try {
      await scene.updateEmbeddedDocuments("Region", [{ _id: region.regionId, "flags.pf2e-combater.areaTimer": flag }]);
    } catch (_error) {
      // Non-fatal: region simply will not auto-expire.
    }
  }
  return { effectUuid };
}

export function areaTemplatePersists(action) {
  const profile = action?.activityProfile ?? {};
  const isSpell = profile.spell === true
    || /spell/.test(String(action?.source ?? "").toLowerCase());
  if (!isSpell) return true;
  return profile.sustained === true || profile.lastingDuration === true;
}

export async function prepareAreaExecution({ context, action, step, choices = {}, target = null, patch = {} }) {
  if (!requiresAreaMarkerForAction(action)) return { status: "ready", patch, regionOp: null, areaMarker: null };

  const areaMarker = executionAreaMarker({ context, action, step, choices, target });
  if (!areaMarker) return { status: "needs-choice", choices: ["area"], patch };

  const nextPatch = { ...patch, areaMarker };
  let regionOp = null;
  if (areaTemplatePersists(action)) {
    const region = await createAreaRegion({ context, action, marker: areaMarker, target });
    if (region?.regionId) {
      const timer = await createAreaTimer({ context, action, region });
      regionOp = {
        kind: "region",
        regionId: region.regionId,
        sceneId: region.sceneId ?? null,
        ...(timer?.effectUuid ? { effectUuid: timer.effectUuid } : {}),
      };
    }
  }

  const insideTokens = tokensInAreaMarker({ context, action, marker: areaMarker });
  if (insideTokens.length) {
    setTokenTargets(insideTokens);
    nextPatch.targetTokenIds = insideTokens.map((token) => targetTokenId(token)).filter(Boolean);
  }

  return { status: "ready", patch: nextPatch, regionOp, areaMarker };
}
