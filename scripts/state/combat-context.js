import { readActorProfile, readConditions, readEffects } from "../readers/actor-profile.js";
import { readVisionerDetectionState } from "../integrations/visioner.js";
import { collectionValues } from "../foundry-data.js";
import { movementActionsSpent } from "./token-refresh.js";
import { movementFootprintCentersForToken } from "../rules/token-geometry.js";
import {
  INTEL_REVEAL_MODES,
  bandedIntelDefenseEntry,
  canUseIntelCategory,
  canUseIntelFact,
  intelSaveBand,
  intelDefenseFactId,
  intelIdentityTrait,
  intelTraitFactId,
  readIntelFalseInformation,
  readIntelLedger,
  readIntelRevealMode,
} from "../rules/intel-ledger.js";

const NON_TARGETABLE_ACTOR_TYPES = new Set(["hazard", "loot"]);
const ATTACK_HIDDEN_DETECTION_STATES = new Set(["undetected", "unnoticed"]);

function actorSummary(actor, {
  includeDocument = true,
  intelLedger = null,
  intelRevealMode = null,
  intelFalseInformation = null,
} = {}) {
  if (!actor) return null;
  const summary = {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    type: actor.type,
    img: actor.img,
    documentName: actor.documentName ?? "Actor",
    ...(intelLedger ? { intelLedger } : {}),
    ...(intelRevealMode ? { intelRevealMode } : {}),
    ...(Array.isArray(intelFalseInformation) ? { intelFalseInformation } : {}),
  };
  if (includeDocument) summary.document = actor;
  return summary;
}

function tokenDisplayName(token, actor = tokenActor(token), combatant = null) {
  const document = token?.document ?? token;
  if (game?.user?.isGM !== true
    && globalThis.game?.pf2e?.settings?.tokens?.nameVisibility
    && combatant?.playersCanSeeName !== true
    && document?.playersCanSeeName === false) {
    return globalThis.game?.i18n?.localize?.("COMBATANT.Unknown") || "Unknown";
  }
  if (game?.user?.isGM !== true
    && globalThis.game?.pf2e?.settings?.tokens?.nameVisibility
    && combatant?.playersCanSeeName === false) {
    return globalThis.game?.i18n?.localize?.("COMBATANT.Unknown") || "Unknown";
  }
  return token?.name
    ?? document?.name
    ?? actor?.name
    ?? null;
}

function tokenSummary(token, { combatant = null } = {}) {
  const document = token?.document ?? token;
  if (!document) return null;
  const actor = tokenActor(token);
  return {
    id: document.id,
    uuid: document.uuid,
    name: tokenDisplayName(token, actor, combatant),
    img: document.texture?.src ?? token?.texture?.src,
    disposition: tokenDisposition(token),
    center: tokenCenter(token),
    width: Number(document.width ?? token?.width ?? 1) || 1,
    height: Number(document.height ?? token?.height ?? 1) || 1,
    documentName: document.documentName ?? "TokenDocument",
    document,
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

function combatantHidden(combatant) {
  const document = combatant?.document ?? combatant;
  return combatant?.hidden === true || document?.hidden === true;
}

function canUseTokenForPlayerContext(token) {
  if (game?.user?.isGM === true) return true;
  return !tokenHidden(token);
}

function canUseCombatantForPlayerContext(combatant) {
  if (game?.user?.isGM === true) return true;
  if (!combatant) return true;
  if (typeof combatant.visible === "boolean") return combatant.visible;
  return !combatantHidden(combatant);
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
  const fallbackCenter = tokenCenter(token);
  if (!fallbackCenter) return [];

  const size = Number(globalThis.canvas?.grid?.size ?? 1) || 1;
  return movementFootprintCentersForToken(fallbackCenter, token, size);
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

function defenseEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return Array.from(value.values());
  if (typeof value === "object") return Object.values(value);
  return [];
}

function intelTargetForActor(actor, intelLedger, intelRevealMode = readIntelRevealMode(actor)) {
  return { actor, intelLedger, intelRevealMode };
}

function readKnownSaves(actor, target) {
  const saves = readSaves(actor);
  const revealMode = readIntelRevealMode(target);
  return Object.fromEntries(Object.entries(saves)
    .filter(([save, value]) => Number.isFinite(Number(value)) && canUseIntelFact(null, target, "saves", save))
    .map(([save, value]) => {
      if (revealMode !== INTEL_REVEAL_MODES.band) return [save, value];
      return [save, intelSaveBand(value, actor)?.approximateDc ?? value];
    }));
}

function readKnownSaveBands(actor, target) {
  if (readIntelRevealMode(target) !== INTEL_REVEAL_MODES.band) return {};
  const saves = readSaves(actor);
  return Object.fromEntries(Object.entries(saves)
    .filter(([save, value]) => Number.isFinite(Number(value)) && canUseIntelFact(null, target, "saves", save))
    .map(([save, value]) => [save, intelSaveBand(value, actor)])
    .filter(([, band]) => band));
}

function readKnownPerception(actor, target) {
  if (!canUseIntelFact(null, target, "perception", "perception")) return { dc: null, mod: null };
  const perception = readPerception(actor);
  if (readIntelRevealMode(target) !== INTEL_REVEAL_MODES.band || !Number.isFinite(Number(perception.dc))) {
    return perception;
  }
  const band = intelSaveBand(perception.dc, actor);
  if (!band) return perception;
  return {
    dc: band.approximateDc,
    mod: band.approximateDc - 10,
    intelBand: band.id,
    intelBandLabel: band.label,
    exactValueHidden: true,
  };
}

function readKnownPerceptionBand(actor, target) {
  if (readIntelRevealMode(target) !== INTEL_REVEAL_MODES.band) return null;
  if (!canUseIntelFact(null, target, "perception", "perception")) return null;
  return intelSaveBand(readPerception(actor).dc, actor);
}

function readKnownDefense(actor, target, category, readValue, { showValue = true } = {}) {
  if (!canUseIntelCategory(null, target, category)) return null;
  const entries = defenseEntries(readValue(actor))
    .filter((entry) =>
      canUseIntelFact(null, target, category, intelDefenseFactId(entry, { showValue })));
  return readIntelRevealMode(target) === INTEL_REVEAL_MODES.band
    ? entries.map((entry) => bandedIntelDefenseEntry(entry, actor, { showValue }))
    : entries;
}

function readDefensiveMeta(actor, canSeeDefenses, intelLedger = readIntelLedger(actor)) {
  const intelRevealMode = readIntelRevealMode(actor);
  if (!canSeeDefenses) {
    const intelTarget = intelTargetForActor(actor, intelLedger, intelRevealMode);
    const perception = readKnownPerception(actor, intelTarget);
    return {
      ac: null,
      saves: readKnownSaves(actor, intelTarget),
      intelSaveBands: readKnownSaveBands(actor, intelTarget),
      perception,
      intelPerceptionBand: readKnownPerceptionBand(actor, intelTarget),
      perceptionDC: perception.dc,
      resistances: readKnownDefense(actor, intelTarget, "resistances", readResistances),
      weaknesses: readKnownDefense(actor, intelTarget, "weaknesses", readWeaknesses),
      immunities: readKnownDefense(actor, intelTarget, "immunities", readImmunities, { showValue: false }),
      intelRevealMode,
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
    intelRevealMode,
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

function tokenEntry(token, originToken, { canSeeDefenses = false, combatant = null } = {}) {
  const actor = tokenActor(token);
  const intelLedger = readIntelLedger(actor);
  const intelRevealMode = readIntelRevealMode(actor);
  const intelFalseInformation = readIntelFalseInformation(actor);
  const intelTarget = intelTargetForActor(actor, intelLedger, intelRevealMode);
  const conditions = readConditions(actor);
  const effects = readEffects(actor, { includeHidden: canSeeDefenses });
  const visionerDetectionState = readVisionerDetectionState(tokenSummary(originToken), tokenSummary(token));
  return {
    id: token?.id ?? token?.document?.id,
    name: tokenDisplayName(token, actor, combatant),
    disposition: tokenDisposition(token),
    actor: actorSummary(actor, {
      includeDocument: canSeeDefenses,
      intelLedger,
      intelRevealMode,
      intelFalseInformation,
    }),
    token: tokenSummary(token, { combatant }),
    distance: measureDistance(originToken, token),
    intelLedger,
    intelRevealMode,
    intelFalseInformation,
    traits: canSeeDefenses
      ? actorTraitSlugs(actor)
      : actorTraitSlugs(actor).filter((trait) =>
        canUseIntelFact(null, intelTarget, "traits", intelTraitFactId(trait))
        || (canUseIntelCategory(null, intelTarget, "identity")
          && String(trait).toLowerCase() === intelIdentityTrait(actor))),
    visionerDetectionState,
    attackTargetable: attackTargetableDetectionState(visionerDetectionState)
      && attackTargetableConditions(conditions),
    hpPercent: hpPercent(actor),
    conditions,
    effects,
    ...readDefensiveMeta(actor, canSeeDefenses, intelLedger),
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

function actorTraitSet(actor) {
  return new Set(actorTraitSlugs(actor).map((trait) => String(trait).toLowerCase()).filter(Boolean));
}

function isEidolonActor(actor) {
  return actorType(actor) === "eidolon" || actorTraitSet(actor).has("eidolon");
}

function isFamiliarActor(actor) {
  return actorType(actor) === "familiar";
}

function isCompanionActor(actor) {
  if (actorType(actor) !== "character") return false;
  const traits = actorTraitSet(actor);
  return traits.has("minion") && !isEidolonActor(actor);
}

function actorReferenceIds(actor) {
  return new Set([
    actor?.id,
    actor?.uuid,
    actor?.document?.id,
    actor?.document?.uuid,
  ].map((value) => String(value ?? "").trim()).filter(Boolean));
}

function familiarMasterIds(familiar) {
  const master = familiar?.system?.master ?? {};
  return [
    master.id,
    master.uuid,
    master.actorId,
    master.value,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
}

function familiarBelongsToActor(actor, familiar) {
  if (!isFamiliarActor(familiar)) return false;
  if (familiar === actor?.familiar) return true;
  const actorIds = actorReferenceIds(actor);
  return familiarMasterIds(familiar).some((id) => actorIds.has(id));
}

// PF2e models familiars as `familiar` actors with `system.master.id`, while animal/construct
// companions are `character` actors with the `minion` trait. Ordinary NPC animals are not owned
// minions and must not be treated as Command an Animal subturns.
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
  if (isEidolonActor(candidate)) return false;
  if (familiarBelongsToActor(actor, candidate)) return true;
  return isCompanionActor(candidate) && sharesNonDefaultOwner(actor, candidate);
}

export function readCombatContext(refreshSource = "manual", options = {}) {
  const combat = options.combat ?? globalThis.game?.combat ?? null;
  if (!combat?.started) return null;

  const combatant = selectedEncounterCombatant({ ...options, combat });
  const actor = combatant?.actor ?? null;
  if (!canReadActor(actor)) return null;

  const activeToken = tokenForCombatant(combatant, actor);
  const activeDisposition = numericDisposition(activeToken);
  const activeTokenName = tokenDisplayName(activeToken, actor, combatant);
  const canSeeDefenses = game?.user?.isGM === true;
  const placeables = canvas?.tokens?.placeables ?? [];
  const combatants = collectionValues(combat.combatants);
  const combatantForToken = (token) => combatants.find((entry) => tokenMatchesCombatant(token, entry)) ?? null;
  const tokens = placeables
    .filter((token) => tokenActor(token))
    .filter(canUseTokenForPlayerContext);
  // Familiars/companions/eidolons are excluded from the encounter tracker by the PF2e system
  // itself (their actions happen on the master's turn), so they never appear in `combatTokens`.
  // Minion detection has to run against the wider `tokens` pool instead.
  const minionTokens = tokens.filter((token) =>
    !tokenInCombat(combat, token) && isCommandableMinion(actor, tokenActor(token)));
  const minions = minionTokens.map((token) => tokenEntry(token, activeToken, { canSeeDefenses }));

  const combatTokens = tokens
    .filter((token) => tokenInCombat(combat, token))
    .filter((token) => canUseCombatantForPlayerContext(combatantForToken(token)));
  const targetableTokens = combatTokens.filter((token) => isTargetableCombatToken(token));
  const otherTokens = targetableTokens.filter((token) => !tokenMatchesIdentity(token, activeToken));

  const allyTokens = otherTokens
    .filter((token) => isAllyDisposition(token, activeDisposition));
  const enemyTokens = otherTokens
    .filter((token) => isEnemyDisposition(token, activeDisposition));

  const allies = allyTokens.map((token) => tokenEntry(token, activeToken, { canSeeDefenses, combatant: combatantForToken(token) }));
  const enemies = enemyTokens.map((token) => tokenEntry(token, activeToken, { canSeeDefenses, combatant: combatantForToken(token) }));

  const userTargets = Array.from(game?.user?.targets ?? []);
  const matchedTargetTokens = enemyTokens.filter((token) =>
    userTargets.some((target) => tokenMatchesTarget(token, target)),
  );
  const nearestEnemyTokens = [...enemyTokens]
    .sort((left, right) => measureDistance(activeToken, left) - measureDistance(activeToken, right));
  const targetTokens = matchedTargetTokens.length ? matchedTargetTokens : nearestEnemyTokens.slice(0, 1);
  const targets = targetTokens
    .filter(Boolean)
    .map((token) => tokenEntry(token, activeToken, { canSeeDefenses, combatant: combatantForToken(token) }));
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
    token: tokenSummary(activeToken, { combatant }),
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
