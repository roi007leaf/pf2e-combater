import { readActorProfile, readConditions, readEffects } from "../readers/actor-profile.js";
import { readVisionerDetectionState } from "../integrations/visioner.js";
import { movementActionsSpent } from "./token-refresh.js";

const NON_TARGETABLE_ACTOR_TYPES = new Set(["hazard", "loot"]);
const ATTACK_HIDDEN_DETECTION_STATES = new Set(["undetected", "unnoticed"]);

function actorSummary(actor, { includeDocument = true } = {}) {
  if (!actor) return null;
  const summary = {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    documentName: actor.documentName ?? "Actor",
  };
  if (includeDocument) summary.document = actor;
  return summary;
}

function tokenDisplayName(token, actor = tokenActor(token)) {
  return token?.name
    ?? token?.document?.name
    ?? actor?.name
    ?? null;
}

function tokenSummary(token) {
  const document = token?.document ?? token;
  if (!document) return null;
  const actor = tokenActor(token);
  return {
    id: document.id,
    uuid: document.uuid,
    name: tokenDisplayName(token, actor),
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

function tokenHidden(token) {
  const document = token?.document ?? token;
  return token?.hidden === true
    || document?.hidden === true
    || token?.visible === false
    || token?.isVisible === false;
}

function canUseTokenForPlayerContext(token) {
  if (game?.user?.isGM === true) return true;
  return !tokenHidden(token);
}

function actorType(actor) {
  return String(actor?.type ?? actor?.document?.type ?? "").toLowerCase();
}

function isTargetableCombatToken(token) {
  const actor = tokenActor(token);
  return Boolean(actor && !NON_TARGETABLE_ACTOR_TYPES.has(actorType(actor)));
}

function tokenDisposition(token) {
  return token?.document?.disposition ?? token?.disposition ?? null;
}

function numericDisposition(token) {
  const disposition = Number(tokenDisposition(token));
  return Number.isFinite(disposition) ? disposition : null;
}

function isAllyDisposition(token, activeDisposition) {
  const disposition = numericDisposition(token);
  return activeDisposition !== null && activeDisposition !== 0
    && disposition !== null && disposition !== 0
    && disposition === activeDisposition;
}

function isEnemyDisposition(token, activeDisposition) {
  const disposition = numericDisposition(token);
  if (activeDisposition === null || disposition === null || disposition === 0) return false;
  if (activeDisposition === 0) return disposition !== 0;
  return disposition !== activeDisposition;
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

  // Foundry/PF2e's token.distanceTo is size-aware (edge-to-edge): an adjacent Large creature reads
  // 5 ft, not the ~10 ft a center-to-center measurement gives. Prefer it; the footprint math below
  // is only a fallback for environments without the placeable API (e.g. offline tests).
  const from = fromToken?.object ?? fromToken;
  const to = toToken?.object ?? toToken;
  if (typeof from?.distanceTo === "function" && to) {
    try {
      const distance = from.distanceTo(to);
      if (Number.isFinite(distance)) return distance;
    } catch (_error) {
      // fall through to the footprint estimate
    }
  }

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

function readWeaknesses(actor) {
  return plainValue(actor?.system?.attributes?.weaknesses ?? actor?.system?.weaknesses);
}

function readImmunities(actor) {
  return plainValue(actor?.system?.attributes?.immunities ?? actor?.system?.immunities);
}

function readDefensiveMeta(actor, canSeeDefenses) {
  if (!canSeeDefenses) {
    return {
      ac: null,
      saves: {},
      perception: { dc: null, mod: null },
      perceptionDC: null,
      resistances: null,
      weaknesses: null,
      immunities: null,
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
    weaknesses: readWeaknesses(actor),
    immunities: readImmunities(actor),
  };
}

function hasCondition(conditions, slug) {
  if (!conditions) return false;
  if (Array.isArray(conditions.slugs) && conditions.slugs.includes(slug)) return true;
  const value = Number(conditions.values?.[slug]);
  return Number.isFinite(value) && value > 0;
}

function attackTargetableDetectionState(state) {
  return !ATTACK_HIDDEN_DETECTION_STATES.has(String(state ?? "").toLowerCase());
}

function attackTargetableConditions(conditions) {
  return !hasCondition(conditions, "undetected")
    && !hasCondition(conditions, "unnoticed");
}

function tokenEntry(token, originToken, { canSeeDefenses = false } = {}) {
  const actor = tokenActor(token);
  const conditions = readConditions(actor);
  const effects = readEffects(actor, { includeHidden: canSeeDefenses });
  const visionerDetectionState = readVisionerDetectionState(tokenSummary(originToken), tokenSummary(token));
  return {
    id: token?.id ?? token?.document?.id,
    name: tokenDisplayName(token, actor),
    disposition: tokenDisposition(token),
    actor: actorSummary(actor, { includeDocument: canSeeDefenses }),
    token: tokenSummary(token),
    distance: measureDistance(originToken, token),
    visionerDetectionState,
    attackTargetable: attackTargetableDetectionState(visionerDetectionState)
      && attackTargetableConditions(conditions),
    hpPercent: hpPercent(actor),
    conditions,
    effects,
    ...readDefensiveMeta(actor, canSeeDefenses),
  };
}

function actorOwnedByUser(actor, user) {
  if (actor?.isOwner) return true;
  if (typeof actor?.testUserPermission !== "function") return false;

  const ownerPermission = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? "OWNER";
  return actor.testUserPermission(user, ownerPermission);
}

function canReadActor(actor, user = globalThis.game?.user) {
  return Boolean(actor && (user?.isGM || actorOwnedByUser(actor, user)));
}

function tokenMatchesTarget(token, target) {
  const tokenDocument = token?.document ?? token;
  const targetDocument = target?.document ?? target;
  return token === target
    || tokenDocument === targetDocument
    || tokenDocument?.id === targetDocument?.id;
}

function tokenMatchesIdentity(left, right) {
  if (!left || !right) return false;
  const leftIds = new Set(tokenIdentityValues(left));
  if (!leftIds.size) return false;
  return tokenIdentityValues(right).some((id) => leftIds.has(id));
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return [];
}

function tokenIdentityValues(value) {
  const document = value?.document ?? value;
  return [
    value?.id,
    value?.uuid,
    value?.tokenId,
    value?.tokenUuid,
    document?.id,
    document?.uuid,
    value?.object?.id,
    value?.object?.uuid,
    value?.object?.document?.id,
    value?.object?.document?.uuid,
  ]
    .filter((entry) => entry !== null && entry !== undefined)
    .map((entry) => String(entry));
}

function tokenMatchesCombatant(token, combatant) {
  const tokenIds = new Set(tokenIdentityValues(token));
  if (!tokenIds.size) return false;

  const combatantTokenValues = [
    combatant?.token?.object,
    combatant?.token,
    combatant?.tokenDocument,
    combatant?.document?.token,
    { id: combatant?.tokenId, uuid: combatant?.tokenUuid },
  ];
  return combatantTokenValues.some((value) =>
    tokenIdentityValues(value).some((id) => tokenIds.has(id)),
  );
}

function tokenForCombatant(combatant, actor) {
  const placeables = globalThis.canvas?.tokens?.placeables ?? [];
  return placeables.find((token) => tokenMatchesCombatant(token, combatant))
    ?? combatant?.token?.object
    ?? combatant?.token
    ?? combatant?.tokenDocument
    ?? actor?.getActiveTokens?.(true)?.find((token) => tokenMatchesCombatant(token, combatant))
    ?? actor?.getActiveTokens?.(true)?.[0]
    ?? null;
}

function tokenInCombat(combat, token) {
  if (!combat) return true;
  const combatants = collectionValues(combat.combatants);
  return combatants.some((combatant) => tokenMatchesCombatant(token, combatant))
    || tokenMatchesCombatant(token, combat.combatant);
}

function combatantTokenReference(combatant) {
  return combatant?.token?.object
    ?? combatant?.token
    ?? combatant?.tokenDocument
    ?? combatant?.document?.token
    ?? { id: combatant?.tokenId, uuid: combatant?.tokenUuid };
}

function combatantInCombat(combat, combatant) {
  if (!combatant) return false;
  const combatants = collectionValues(combat?.combatants);
  return combatants.some((candidate) =>
    candidate === combatant
      || (combatant.id !== null && combatant.id !== undefined && candidate?.id === combatant.id)
      || (combatant.uuid !== null && combatant.uuid !== undefined && candidate?.uuid === combatant.uuid)
      || tokenMatchesCombatant(combatantTokenReference(combatant), candidate),
  );
}

function selectedEncounterCombatant(options = {}) {
  const combat = options.combat ?? globalThis.game?.combat ?? null;
  if (options.combatant) {
    return combatantInCombat(combat, options.combatant) ? options.combatant : null;
  }

  const selectedToken = (globalThis.canvas?.tokens?.controlled ?? [])
    .find((token) => tokenInCombat(combat, token));
  if (!selectedToken) return combat?.combatant ?? null;

  const combatants = collectionValues(combat?.combatants);
  return combatants.find((combatant) => tokenMatchesCombatant(selectedToken, combatant))
    ?? combat?.combatant
    ?? null;
}

function actorTraitSlugs(actor) {
  const value = actor?.system?.traits?.value;
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return [];
}

// Familiars carry an explicit `system.master.id` link (exposed as `actor.familiar` by the PF2e
// system). Animal/construct/undead companions have no such schema field, so the only available
// signal is the shared "minion" trait (PF2e's own term for "familiar, companion, or other minion
// whose actions are controlled by another creature") plus common ownership. Eidolons carry the
// separate "eidolon" trait and are excluded on purpose: they act via shared actions each round,
// not via Command an Animal.
function sharesNonDefaultOwner(actorA, actorB) {
  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const ownershipA = actorA?.ownership;
  if (!ownershipA || typeof ownershipA !== "object") return false;
  return Object.entries(ownershipA).some(([userId, level]) =>
    userId !== "default"
    && Number(level) >= Number(ownerLevel)
    && Number(actorB?.ownership?.[userId]) >= Number(ownerLevel),
  );
}

function isCommandableMinion(actor, candidate) {
  if (!candidate || candidate === actor) return false;
  if (candidate === actor?.familiar) return true;
  return actorTraitSlugs(candidate).includes("minion") && sharesNonDefaultOwner(actor, candidate);
}

export function readCombatContext(refreshSource = "manual", options = {}) {
  const combat = options.combat ?? globalThis.game?.combat ?? null;
  if (!combat?.started) return null;

  const combatant = selectedEncounterCombatant({ ...options, combat });
  const actor = combatant?.actor ?? null;
  if (!canReadActor(actor)) return null;

  const activeToken = tokenForCombatant(combatant, actor);
  const activeDisposition = numericDisposition(activeToken);
  const activeTokenName = tokenDisplayName(activeToken, actor);
  const canSeeDefenses = game?.user?.isGM === true;
  const placeables = canvas?.tokens?.placeables ?? [];
  const tokens = placeables
    .filter((token) => tokenActor(token))
    .filter(canUseTokenForPlayerContext);
  // Familiars/companions/eidolons are excluded from the encounter tracker by the PF2e system
  // itself (their actions happen on the master's turn), so they never appear in `combatTokens`.
  // Minion detection has to run against the wider `tokens` pool instead.
  const minionTokens = tokens.filter((token) => isCommandableMinion(actor, tokenActor(token)));
  const minions = minionTokens.map((token) => tokenEntry(token, activeToken, { canSeeDefenses }));

  const combatTokens = tokens.filter((token) => tokenInCombat(combat, token));
  const targetableTokens = combatTokens.filter((token) => isTargetableCombatToken(token));
  const otherTokens = targetableTokens.filter((token) => !tokenMatchesIdentity(token, activeToken));

  const allyTokens = otherTokens
    .filter((token) => isAllyDisposition(token, activeDisposition));
  const enemyTokens = otherTokens
    .filter((token) => isEnemyDisposition(token, activeDisposition));

  const allies = allyTokens.map((token) => tokenEntry(token, activeToken, { canSeeDefenses }));
  const enemies = enemyTokens.map((token) => tokenEntry(token, activeToken, { canSeeDefenses }));

  const userTargets = Array.from(game?.user?.targets ?? []);
  const matchedTargetTokens = enemyTokens.filter((token) =>
    userTargets.some((target) => tokenMatchesTarget(token, target)),
  );
  const nearestEnemyTokens = [...enemyTokens]
    .sort((left, right) => measureDistance(activeToken, left) - measureDistance(activeToken, right));
  const targetTokens = matchedTargetTokens.length ? matchedTargetTokens : nearestEnemyTokens.slice(0, 1);
  const targets = targetTokens
    .filter(Boolean)
    .map((token) => tokenEntry(token, activeToken, { canSeeDefenses }));
  const movementSpent = movementActionsSpent({ ...combat, combatant });

  return {
    refreshSource,
    isGM: canSeeDefenses,
    combat: {
      id: combat.id,
      round: combat.round,
      turn: combat.turn,
      started: combat.started,
    },
    combatant: {
      id: combatant.id,
      name: activeTokenName ?? combatant.name,
      actor,
    },
    actor: {
      ...actorSummary(actor),
      name: activeTokenName ?? actor.name,
      profile: readActorProfile(actor),
    },
    token: tokenSummary(activeToken),
    actionsSpent: {
      movement: movementSpent,
      normal: movementSpent,
      total: movementSpent,
    },
    battlefield: {
      allies,
      enemies,
      targets,
    },
    minions,
  };
}
