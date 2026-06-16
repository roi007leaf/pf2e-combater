import { readActorProfile, readConditions } from "../readers/actor-profile.js";
import { readVisionerDetectionState } from "../integrations/visioner.js";

function actorSummary(actor) {
  if (!actor) return null;
  return {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    document: actor,
    documentName: actor.documentName ?? "Actor",
  };
}

function tokenSummary(token) {
  const document = token?.document ?? token;
  if (!document) return null;
  return {
    id: document.id,
    uuid: document.uuid,
    name: document.name ?? token?.name,
    img: document.texture?.src ?? token?.texture?.src,
    disposition: tokenDisposition(token),
    center: tokenCenter(token),
    width: Number(document.width ?? token?.width ?? 1) || 1,
    height: Number(document.height ?? token?.height ?? 1) || 1,
    document: document.documentName ?? "TokenDocument",
  };
}

function tokenActor(token) {
  return token?.actor ?? token?.document?.actor ?? null;
}

function tokenDisposition(token) {
  return token?.document?.disposition ?? token?.disposition ?? null;
}

function tokenCenter(token) {
  if (!token) return null;

  // Prefer the committed document coordinates over the placeable's `.center`.
  // During a move, `.center` reflects the in-progress animation position, so a
  // refresh fired mid-glide would measure a stale distance.
  const document = token.document ?? token;
  const x = Number(document.x ?? token.x);
  const y = Number(document.y ?? token.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    const width = Number(document.width ?? 1);
    const height = Number(document.height ?? 1);
    const size = globalThis.canvas?.grid?.size ?? 1;
    return {
      x: x + (width * size) / 2,
      y: y + (height * size) / 2,
    };
  }

  return token.center ?? null;
}

function tokenFootprintCenters(token) {
  const document = token?.document ?? token;
  const fallbackCenter = tokenCenter(token);
  if (!document || !fallbackCenter) return [];

  const size = Number(globalThis.canvas?.grid?.size ?? 1) || 1;
  const width = Math.max(1, Math.ceil(Number(document.width ?? token?.width ?? 1) || 1));
  const height = Math.max(1, Math.ceil(Number(document.height ?? token?.height ?? 1) || 1));
  const x = Number(document.x ?? token?.x);
  const y = Number(document.y ?? token?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [fallbackCenter];

  if (width === 1 && height === 1) return [fallbackCenter];
  if (width * height > 64) return [fallbackCenter];

  const centers = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      centers.push({
        x: x + (column + 0.5) * size,
        y: y + (row + 0.5) * size,
      });
    }
  }
  return centers;
}

function measurePointDistance(from, to) {
  try {
    if (!from || !to) return Infinity;

    const path = globalThis.canvas?.grid?.measurePath?.([from, to]);
    const distance = path?.distance ?? path;
    if (Number.isFinite(distance)) return distance;
    return Math.hypot(to.x - from.x, to.y - from.y);
  } catch (_error) {
    return Infinity;
  }
}

function measureDistance(fromToken, toToken) {
  if (!fromToken || !toToken) return Infinity;
  if (fromToken === toToken) return 0;

  const fromCenters = tokenFootprintCenters(fromToken);
  const toCenters = tokenFootprintCenters(toToken);
  let shortest = Infinity;

  for (const from of fromCenters) {
    for (const to of toCenters) {
      shortest = Math.min(shortest, measurePointDistance(from, to));
    }
  }

  return shortest;
}

function hpPercent(actor) {
  const hp = actor?.system?.attributes?.hp;
  const value = Number(hp?.value);
  const max = Number(hp?.max);
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 1;
  return Math.max(0, Math.min(1, value / max));
}

function readSaves(actor) {
  const saves = actor?.system?.saves ?? {};
  return {
    fortitude: Number.isFinite(Number(saves.fortitude?.dc)) ? Number(saves.fortitude.dc) : null,
    reflex: Number.isFinite(Number(saves.reflex?.dc)) ? Number(saves.reflex.dc) : null,
    will: Number.isFinite(Number(saves.will?.dc)) ? Number(saves.will.dc) : null,
  };
}

function readPerception(actor) {
  const perception = actor?.system?.perception ?? {};
  const dc = Number(perception.dc?.value ?? perception.dc);
  const mod = Number(perception.mod ?? perception.totalModifier);
  return {
    dc: Number.isFinite(dc) ? dc : null,
    mod: Number.isFinite(mod) ? mod : null,
  };
}

function plainValue(value) {
  if (value === undefined) return null;
  if (typeof value?.toObject === "function") return value.toObject();
  if (value instanceof Map) return Array.from(value.values());
  return value;
}

function readResistances(actor) {
  return plainValue(actor?.system?.attributes?.resistances ?? actor?.system?.resistances);
}

function readDefensiveMeta(actor, canSeeDefenses) {
  if (!canSeeDefenses) {
    return {
      ac: null,
      saves: {},
      perception: { dc: null, mod: null },
      perceptionDC: null,
      resistances: null,
    };
  }

  const perception = readPerception(actor);
  return {
    ac: Number.isFinite(Number(actor?.system?.attributes?.ac?.value))
      ? Number(actor.system.attributes.ac.value)
      : null,
    saves: readSaves(actor),
    perception,
    perceptionDC: perception.dc,
    resistances: readResistances(actor),
  };
}

function tokenEntry(token, originToken, { canSeeDefenses = false } = {}) {
  const actor = tokenActor(token);
  return {
    id: token?.id ?? token?.document?.id,
    name: token?.name ?? token?.document?.name ?? actor?.name,
    disposition: tokenDisposition(token),
    actor: actorSummary(actor),
    token: tokenSummary(token),
    distance: measureDistance(originToken, token),
    visionerDetectionState: readVisionerDetectionState(tokenSummary(originToken), tokenSummary(token)),
    hpPercent: hpPercent(actor),
    conditions: readConditions(actor),
    ...readDefensiveMeta(actor, canSeeDefenses),
  };
}

function canReadActor(actor) {
  return Boolean(actor && (game?.user?.isGM || actor.isOwner));
}

function tokenMatchesTarget(token, target) {
  const tokenDocument = token?.document ?? token;
  const targetDocument = target?.document ?? target;
  return token === target
    || tokenDocument === targetDocument
    || tokenDocument?.id === targetDocument?.id;
}

export function readCombatContext(refreshSource = "manual") {
  const combatant = game?.combat?.combatant ?? null;
  const actor = combatant?.actor ?? null;
  if (!canReadActor(actor)) return null;

  const activeToken = combatant?.token?.object ?? actor.getActiveTokens?.(true)?.[0] ?? null;
  const activeDisposition = tokenDisposition(activeToken);
  const canSeeDefenses = game?.user?.isGM === true;
  const placeables = canvas?.tokens?.placeables ?? [];
  const tokens = placeables.filter((token) => tokenActor(token));
  const otherTokens = tokens.filter((token) => token !== activeToken);

  const allyTokens = otherTokens
    .filter((token) => tokenDisposition(token) === activeDisposition);
  const enemyTokens = otherTokens
    .filter((token) => tokenDisposition(token) !== activeDisposition);

  const allies = allyTokens.map((token) => tokenEntry(token, activeToken, { canSeeDefenses }));
  const enemies = enemyTokens.map((token) => tokenEntry(token, activeToken, { canSeeDefenses }));

  const userTargets = Array.from(game?.user?.targets ?? []);
  const matchedTargetTokens = tokens.filter((token) =>
    tokenDisposition(token) !== activeDisposition
      && userTargets.some((target) => tokenMatchesTarget(token, target)),
  );
  const nearestEnemyTokens = [...enemyTokens]
    .sort((left, right) => measureDistance(activeToken, left) - measureDistance(activeToken, right));
  const targetTokens = matchedTargetTokens.length ? matchedTargetTokens : nearestEnemyTokens.slice(0, 1);
  const targets = targetTokens
    .filter(Boolean)
    .map((token) => tokenEntry(token, activeToken, { canSeeDefenses }));

  return {
    refreshSource,
    isGM: canSeeDefenses,
    combat: {
      id: game.combat.id,
      round: game.combat.round,
      turn: game.combat.turn,
      started: game.combat.started,
    },
    combatant: {
      id: combatant.id,
      name: combatant.name,
      actor,
    },
    actor: {
      ...actorSummary(actor),
      profile: readActorProfile(actor),
    },
    token: tokenSummary(activeToken),
    battlefield: {
      allies,
      enemies,
      targets,
    },
  };
}
