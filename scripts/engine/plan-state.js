import { slugify } from "./action/text.js";
import { normalizedActionFacts } from "./action/facts.js";
import { reservePlanResource } from "./planner/resource-budget.js";
import { footprintPathDistanceFeet } from "../rules/token-geometry.js";

const ESCAPE_REMOVED_CONDITIONS = ["grabbed", "grappled", "immobilised", "immobilized", "restrained"];
const RAISE_SHIELD_SLUGS = new Set(["raise-a-shield"]);
const SHIELD_SPELL_SLUGS = new Set(["shield"]);
const GENERIC_ATTACK_SLUGS = new Set(["trip", "grapple", "disarm", "shove", "reposition"]);

function actionForStep(step) {
  return step?.action ?? step ?? {};
}

function stepProfile(step) {
  const action = actionForStep(step);
  return {
    ...(action?.activityProfile ?? {}),
    ...(step?.activityProfile ?? {}),
  };
}

function values(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  return [value];
}

function normalizedValues(value) {
  return values(value)
    .map((entry) => slugify(entry?.slug ?? entry?.name ?? entry))
    .filter(Boolean);
}

function normalizedConditionValues(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Set)) {
    if (value.slugs || value.values) return [...conditionSlugs(value)];
  }
  return values(value)
    .filter((entry) => typeof entry === "string" || (entry && typeof entry === "object" && (entry.slug || entry.name)))
    .map((entry) => slugify(entry?.slug ?? entry?.name ?? entry))
    .filter(Boolean);
}

function stepSlugCandidates(step) {
  const action = actionForStep(step);
  return [
    step?.slug,
    step?.actionKey,
    step?.key,
    action?.slug,
    action?.id,
    action?.name,
  ].map(slugify).filter(Boolean);
}

function primaryStepSlug(step) {
  return stepSlugCandidates(step)[0] ?? "";
}

function usableStep(step) {
  return Boolean(step) && step.stale !== true && String(step?.execution?.status ?? "").toLowerCase() !== "failed";
}

function strongIdentityAliases(value) {
  return [
    value?.id,
    value?.uuid,
    value?.actor?.id,
    value?.actor?.uuid,
    value?.token?.id,
    value?.token?.uuid,
    value?.document?.id,
    value?.document?.uuid,
  ]
    .filter((entry) => entry !== null && entry !== undefined && String(entry).trim())
    .map((entry) => String(entry).trim().toLowerCase());
}

function identityAliases(value) {
  const strong = strongIdentityAliases(value);
  const name = String(value?.name ?? "").trim().toLowerCase();
  return name ? [...strong, name] : strong;
}

function contextEntities(context) {
  return [
    ...(context?.targets ?? []),
    ...(context?.enemies ?? []),
    ...(context?.allies ?? []),
    ...(context?.battlefield?.targets ?? []),
    ...(context?.battlefield?.enemies ?? []),
    ...(context?.battlefield?.allies ?? []),
  ].filter(Boolean);
}

function conditionSlugs(value) {
  if (!value) return new Set();
  if (Array.isArray(value)) {
    return new Set(normalizedValues(value));
  }

  const active = new Set(normalizedValues(value.slugs));
  for (const [condition, amount] of Object.entries(value.values ?? {})) {
    const number = Number(amount);
    if ((Number.isFinite(number) && number > 0) || amount === true) active.add(slugify(condition));
  }
  return active;
}

function actorConditionSlugs(context) {
  return new Set([
    ...conditionSlugs(context?.profile?.conditions),
    ...conditionSlugs(context?.actor?.profile?.conditions),
  ]);
}

function initialTargetState(context) {
  const targetConditions = new Map();
  const targetAliases = new Map();
  for (const entity of contextEntities(context)) {
    const aliases = identityAliases(entity);
    const strongAliases = strongIdentityAliases(entity);
    if (!aliases.length) continue;
    const existingKey = strongAliases.map((alias) => targetAliases.get(alias)).find(Boolean)
      ?? (!strongAliases.length ? aliases.map((alias) => targetAliases.get(alias)).find(Boolean) : null);
    const key = existingKey ?? strongAliases[0] ?? aliases[0];
    targetConditions.set(key, new Set([
      ...(targetConditions.get(key) ?? []),
      ...conditionSlugs(entity?.conditions),
    ]));
    for (const alias of strongAliases) targetAliases.set(alias, key);
    for (const alias of aliases.slice(strongAliases.length)) {
      if (!targetAliases.has(alias)) targetAliases.set(alias, key);
    }
  }
  return { targetConditions, targetAliases };
}

function combatState(context) {
  return {
    ...(context?.actor?.profile?.combatState ?? {}),
    ...(context?.profile?.combatState ?? {}),
  };
}

function numericPoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, ...(Number.isFinite(Number(value?.elevation)) ? { elevation: Number(value.elevation) } : {}) } : null;
}

function initialPosition(context) {
  return numericPoint(context?.token?.plannedCenter) ?? numericPoint(context?.token?.center);
}

function emptyPlanState(context) {
  const targets = initialTargetState(context);
  const currentCombatState = combatState(context);
  return {
    actorConditions: actorConditionSlugs(context),
    targetConditions: targets.targetConditions,
    targetAliases: targets.targetAliases,
    raisedShieldActive: currentCombatState.raisedShieldActive === true,
    shieldSpellActive: currentCombatState.shieldSpellActive === true,
    position: initialPosition(context),
    positionChanged: false,
    attackCount: 0,
    strikeCount: 0,
    lastStep: null,
    lastActionKey: null,
    lastTargetKey: null,
    resourceReservations: new Map(),
    resourceLegal: true,
    resourceConflicts: [],
    durations: new Map(),
  };
}

function stepTargetReference(context, step) {
  const action = actionForStep(step);
  const direct = step?.preferredTarget
    ?? step?.suggestedTarget
    ?? step?.target
    ?? action?.preferredTarget
    ?? action?.suggestedTarget
    ?? action?.target;
  if (direct) return direct;

  const selectedId = values(step?.targetTokenIds)[0];
  if (selectedId) {
    return contextEntities(context).find((entity) => identityAliases(entity).includes(String(selectedId).toLowerCase()))
      ?? { id: selectedId, type: "target" };
  }
  return null;
}

function canonicalTargetKey(state, reference) {
  const strongAliases = strongIdentityAliases(reference);
  const aliases = identityAliases(reference);
  return strongAliases.map((alias) => state.targetAliases.get(alias)).find(Boolean)
    ?? (!strongAliases.length ? aliases.map((alias) => state.targetAliases.get(alias)).find(Boolean) : null)
    ?? strongAliases[0]
    ?? aliases[0]
    ?? null;
}

function withKnownTarget(state, reference) {
  const aliases = identityAliases(reference);
  const strongAliases = strongIdentityAliases(reference);
  if (!aliases.length) return { state, key: null };
  const key = canonicalTargetKey(state, reference) ?? aliases[0];
  if (state.targetConditions.has(key) && aliases.every((alias) => state.targetAliases.get(alias) === key)) {
    return { state, key };
  }

  const targetConditions = new Map(state.targetConditions);
  if (!targetConditions.has(key)) targetConditions.set(key, conditionSlugs(reference?.conditions));
  const targetAliases = new Map(state.targetAliases);
  for (const alias of strongAliases) targetAliases.set(alias, key);
  for (const alias of aliases.slice(strongAliases.length)) {
    if (!targetAliases.has(alias)) targetAliases.set(alias, key);
  }
  return { state: { ...state, targetConditions, targetAliases }, key };
}

function selfTarget(step) {
  const reference = stepTargetReference(null, step);
  if (String(reference?.type ?? "").toLowerCase() === "self") return true;
  const slugs = stepSlugCandidates(step);
  if (slugs.some((slug) => ["drop-prone", "generic-drop-prone", "stand", "escape", "raise-a-shield", "shield"].includes(slug))) return true;
  const targeting = actionForStep(step)?.targetingProfile ?? {};
  return targeting.self === true && targeting.enemy !== true && targeting.ally !== true;
}

function removesActorConditions(step) {
  if (selfTarget(step)) return true;
  const slugs = stepSlugCandidates(step);
  if (slugs.includes("stand") || slugs.includes("stand-stride") || slugs.includes("escape")) return true;
  return normalizedValues(stepProfile(step).includes).includes("stand");
}

function stepRemovedConditions(step) {
  const action = actionForStep(step);
  const profile = stepProfile(step);
  const included = new Set(normalizedValues(profile.includes));
  const removed = new Set([
    ...normalizedConditionValues(profile.removesCondition),
    ...normalizedConditionValues(profile.removesConditions),
    ...normalizedConditionValues(action?.removesCondition),
    ...normalizedConditionValues(action?.removesConditions),
  ]);
  const slugs = stepSlugCandidates(step);
  if (slugs.includes("stand") || slugs.includes("stand-stride") || included.has("stand")) removed.add("prone");
  if (slugs.includes("escape")) {
    for (const condition of ESCAPE_REMOVED_CONDITIONS) removed.add(condition);
  }
  return removed;
}

function stepAddedConditions(step) {
  const action = actionForStep(step);
  const profile = stepProfile(step);
  const added = new Set([
    ...normalizedConditionValues(profile.appliesCondition),
    ...normalizedConditionValues(profile.appliesConditions),
    ...normalizedConditionValues(profile.appliedCondition),
    ...normalizedConditionValues(profile.conditions),
    ...normalizedConditionValues(action?.appliesCondition),
    ...normalizedConditionValues(action?.appliesConditions),
  ]);
  const slugs = stepSlugCandidates(step);
  if (slugs.some((slug) => slug.includes("drop-prone")) || action?.executable === "drop-prone") added.add("prone");
  return added;
}

function transitionConditionSet(current, removed, added) {
  const next = new Set(current ?? []);
  for (const condition of removed) next.delete(condition);
  for (const condition of added) next.add(condition);
  return next;
}

function stepDuration(step) {
  const action = actionForStep(step);
  const profile = stepProfile(step);
  const value = profile.duration
    ?? action?.duration
    ?? action?.item?.system?.duration?.value
    ?? action?.item?.system?.duration;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") {
    const amount = value.value ?? value.duration;
    const unit = value.unit ?? "";
    return [amount, unit].filter((entry) => entry !== null && entry !== undefined && entry !== "").join(" ") || null;
  }
  return String(value);
}

function appliesAttack(step) {
  const action = actionForStep(step);
  const profile = stepProfile(step);
  const slug = primaryStepSlug(step);
  const traits = normalizedValues(action?.traits);
  return action?.source === "strike"
    || profile.includesStrike === true
    || action?.attackTrait === true
    || action?.attack === true
    || GENERIC_ATTACK_SLUGS.has(slug)
    || traits.includes("attack");
}

function attacksTowardMap(step) {
  if (!appliesAttack(step)) return 0;
  const value = stepProfile(step).mapAttacks;
  if (value === "variable") return 3;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 1;
}

function appliesStrike(step) {
  return actionForStep(step)?.source === "strike";
}

function stepPosition(step) {
  const action = actionForStep(step);
  const profile = stepProfile(step);
  const explicit = numericPoint(step?.destination) ?? numericPoint(action?.destination);
  if (explicit) return explicit;
  if (profile.retreatAfterStrike === true || profile.retreatToOrigin === true) return null;
  return numericPoint(profile.attackCenter);
}

function grantsRaisedShield(step) {
  return stepSlugCandidates(step).some((slug) => RAISE_SHIELD_SLUGS.has(slug));
}

function grantsShieldSpell(step) {
  const action = actionForStep(step);
  if (!stepSlugCandidates(step).some((slug) => SHIELD_SPELL_SLUGS.has(slug))) return false;
  return String(action?.source ?? "").startsWith("spell")
    || stepProfile(step).spell === true
    || action?.item?.type === "spell"
    || action?.isCantrip === true;
}

function reserveResource(state, step) {
  if (String(step?.execution?.status ?? "").toLowerCase() === "done") return state;
  const nextReservations = reservePlanResource(state.resourceReservations, step);
  if (nextReservations) return { ...state, resourceReservations: nextReservations };

  const resource = normalizedActionFacts(step).economy.resource;
  return {
    ...state,
    resourceLegal: false,
    resourceConflicts: [...state.resourceConflicts, resource?.poolKey ?? "unknown"],
  };
}

function applyConditionChangesToRecipient(context, state, step, { removed = new Set(), added = new Set(), self = false } = {}) {
  if (!removed.size && !added.size) return state;
  const reference = stepTargetReference(context, step);
  const recipientIsSelf = self || String(reference?.type ?? "").toLowerCase() === "self";
  const duration = stepDuration(step);
  if (recipientIsSelf) {
    const actorConditions = transitionConditionSet(state.actorConditions, removed, added);
    const durations = new Map(state.durations);
    for (const condition of removed) durations.delete(`self:${condition}`);
    if (duration) for (const condition of added) durations.set(`self:${condition}`, duration);
    return { ...state, actorConditions, durations };
  }

  if (!reference) return state;
  const known = withKnownTarget(state, reference);
  if (!known.key) return known.state;
  const targetConditions = new Map(known.state.targetConditions);
  targetConditions.set(
    known.key,
    transitionConditionSet(targetConditions.get(known.key), removed, added),
  );
  const durations = new Map(known.state.durations);
  for (const condition of removed) durations.delete(`${known.key}:${condition}`);
  if (duration) for (const condition of added) durations.set(`${known.key}:${condition}`, duration);
  return { ...known.state, targetConditions, durations, lastTargetKey: known.key };
}

function applyStepConditions(context, state, step) {
  const removed = stepRemovedConditions(step);
  const added = stepAddedConditions(step);
  let next = applyConditionChangesToRecipient(context, state, step, {
    removed,
    self: removesActorConditions(step),
  });
  next = applyConditionChangesToRecipient(context, next, step, {
    added,
    self: selfTarget(step),
  });
  return next;
}

function trackStepDuration(context, state, step) {
  const duration = stepDuration(step);
  if (!duration || stepAddedConditions(step).size) return state;
  const slug = primaryStepSlug(step);
  if (!slug) return state;

  const reference = stepTargetReference(context, step);
  if (selfTarget(step) || String(reference?.type ?? "").toLowerCase() === "self") {
    const durations = new Map(state.durations);
    durations.set(`self:action:${slug}`, duration);
    return { ...state, durations };
  }
  if (!reference) return state;
  const known = withKnownTarget(state, reference);
  if (!known.key) return known.state;
  const durations = new Map(known.state.durations);
  durations.set(`${known.key}:action:${slug}`, duration);
  return { ...known.state, durations, lastTargetKey: known.key };
}

export function advancePlanState(context, currentState, step) {
  if (!usableStep(step)) return currentState;
  let state = reserveResource(currentState, step);
  state = applyStepConditions(context, state, step);
  state = trackStepDuration(context, state, step);

  const position = stepPosition(step);
  const reference = stepTargetReference(context, step);
  const known = reference && String(reference?.type ?? "").toLowerCase() !== "self"
    ? withKnownTarget(state, reference)
    : { state, key: null };
  state = known.state;

  return {
    ...state,
    raisedShieldActive: state.raisedShieldActive || grantsRaisedShield(step),
    shieldSpellActive: state.shieldSpellActive || grantsShieldSpell(step),
    position: position ?? state.position,
    positionChanged: state.positionChanged || Boolean(position),
    attackCount: state.attackCount + attacksTowardMap(step),
    strikeCount: state.strikeCount + Number(appliesStrike(step)),
    lastStep: actionForStep(step),
    lastActionKey: primaryStepSlug(step) || null,
    lastTargetKey: known.key ?? state.lastTargetKey,
  };
}

export function createPlanState(context, { steps = [] } = {}) {
  return values(steps).reduce(
    (state, step) => advancePlanState(context, state, step),
    emptyPlanState(context),
  );
}

function sortedSet(valuesToSort) {
  return [...(valuesToSort ?? [])].toSorted((left, right) => String(left).localeCompare(String(right)));
}

function sortedEntries(map) {
  return [...(map?.entries?.() ?? [])].toSorted(([left], [right]) => String(left).localeCompare(String(right)));
}

export function serializePlanState(state) {
  return {
    position: state?.position ? { ...state.position } : null,
    positionChanged: state?.positionChanged === true,
    attackCount: Number(state?.attackCount) || 0,
    strikeCount: Number(state?.strikeCount) || 0,
    lastActionKey: state?.lastActionKey ?? null,
    actorConditions: sortedSet(state?.actorConditions),
    targetConditions: Object.fromEntries(
      sortedEntries(state?.targetConditions).map(([key, conditions]) => [key, sortedSet(conditions)]),
    ),
    raisedShieldActive: state?.raisedShieldActive === true,
    shieldSpellActive: state?.shieldSpellActive === true,
    resources: Object.fromEntries(sortedEntries(state?.resourceReservations)),
    resourceLegal: state?.resourceLegal !== false,
    resourceConflicts: [...(state?.resourceConflicts ?? [])],
    durations: Object.fromEntries(sortedEntries(state?.durations)),
    lastTargetKey: state?.lastTargetKey ?? null,
  };
}

export function planStateSignature(state) {
  const serialized = serializePlanState(state);
  return JSON.stringify(serialized);
}

function conditionsFromSet(original, active) {
  const wanted = new Set(active ?? []);
  if (Array.isArray(original)) {
    const kept = original.filter((condition) => wanted.has(slugify(condition?.slug ?? condition?.name ?? condition)));
    const present = new Set(kept.map((condition) => slugify(condition?.slug ?? condition?.name ?? condition)));
    return [...kept, ...sortedSet(wanted).filter((condition) => !present.has(condition))];
  }

  const next = { ...(original ?? {}) };
  const originalSlugs = normalizedValues(original?.slugs);
  next.slugs = [
    ...originalSlugs.filter((condition) => wanted.has(condition)),
    ...sortedSet(wanted).filter((condition) => !originalSlugs.includes(condition)),
  ];
  const valuesMap = { ...(original?.values ?? {}) };
  for (const key of Object.keys(valuesMap)) {
    if (!wanted.has(slugify(key))) delete valuesMap[key];
  }
  for (const condition of wanted) {
    const current = Number(valuesMap[condition]);
    valuesMap[condition] = Number.isFinite(current) && current > 0 ? current : 1;
  }
  next.values = valuesMap;
  return next;
}

function projectProfile(profile, state) {
  if (!profile) return profile;
  return {
    ...profile,
    conditions: conditionsFromSet(profile.conditions, state.actorConditions),
    combatState: {
      ...(profile.combatState ?? {}),
      ...(state.raisedShieldActive ? { raisedShieldActive: true } : {}),
      ...(state.shieldSpellActive ? { shieldSpellActive: true } : {}),
    },
  };
}

function entityStateKey(state, entity) {
  const strongAliases = strongIdentityAliases(entity);
  return strongAliases.map((alias) => state.targetAliases.get(alias)).find(Boolean)
    ?? (!strongAliases.length
      ? identityAliases(entity).map((alias) => state.targetAliases.get(alias)).find(Boolean)
      : null)
    ?? null;
}

function projectEntityConditions(state, entity) {
  const key = entityStateKey(state, entity);
  if (!key || !state.targetConditions.has(key)) return entity;
  return {
    ...entity,
    conditions: conditionsFromSet(entity?.conditions, state.targetConditions.get(key)),
  };
}

function targetCenter(target) {
  return numericPoint(target?.center) ?? numericPoint(target?.token?.center);
}

function projectEntity(state, entity, originToken) {
  const withConditions = projectEntityConditions(state, entity);
  if (!state.positionChanged || !state.position) return withConditions;
  const center = targetCenter(withConditions);
  if (!center) return withConditions;
  const distance = footprintPathDistanceFeet(state.position, originToken, center, withConditions);
  return Number.isFinite(distance) ? { ...withConditions, distance } : withConditions;
}

function projectList(state, entities, originToken) {
  return Array.isArray(entities)
    ? entities.map((entity) => projectEntity(state, entity, originToken))
    : entities;
}

export function projectContextFromPlanState(context, state) {
  if (!context || !state) return context;
  const originToken = context.token ?? null;
  const battlefield = context.battlefield ?? {};
  const profile = projectProfile(context.profile, state);
  const actorProfile = projectProfile(context?.actor?.profile, state);
  return {
    ...context,
    ...(profile ? { profile } : {}),
    actor: context.actor
      ? { ...context.actor, ...(actorProfile ? { profile: actorProfile } : {}) }
      : context.actor,
    token: state.positionChanged && state.position
      ? { ...(context.token ?? {}), center: state.position, plannedCenter: state.position }
      : context.token,
    battlefield: {
      ...battlefield,
      targets: projectList(state, battlefield.targets, originToken),
      enemies: projectList(state, battlefield.enemies, originToken),
      allies: projectList(state, battlefield.allies, originToken),
    },
    targets: projectList(state, context.targets, originToken),
    enemies: projectList(state, context.enemies, originToken),
    allies: projectList(state, context.allies, originToken),
  };
}

export function evaluatePlan(context, steps = []) {
  const state = createPlanState(context, { steps });
  const projectedState = serializePlanState(state);
  const reasons = [];
  if (projectedState.positionChanged) reasons.push("position");
  if (projectedState.attackCount) reasons.push("MAP");
  if (projectedState.actorConditions.length || Object.values(projectedState.targetConditions).some((conditions) => conditions.length)) {
    reasons.push("conditions");
  }
  if (projectedState.raisedShieldActive || projectedState.shieldSpellActive) reasons.push("shield");
  if (Object.keys(projectedState.resources).length) reasons.push("resources");
  if (Object.keys(projectedState.durations).length) reasons.push("durations");
  return {
    score: values(steps).reduce((total, step) => total + (Number(actionForStep(step)?.score ?? step?.score) || 0), 0),
    legal: projectedState.resourceLegal,
    projectedState,
    reasons,
    state,
  };
}
