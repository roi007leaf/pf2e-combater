import { normalizedActionFacts } from "../action/facts.js";
import { actionKey } from "./rules.js";

const DEFAULT_INTENT = Object.freeze({
  lockedTargetIds: Object.freeze([]),
  requiredActionKey: "",
  noSpellSlots: false,
  stayRanged: false,
  endInCover: false,
  preserveFinalAction: false,
});

function normalizedIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
}

export function normalizeTurnIntent(value = null) {
  return {
    lockedTargetIds: normalizedIds(value?.lockedTargetIds),
    requiredActionKey: String(value?.requiredActionKey ?? "").trim(),
    noSpellSlots: value?.noSpellSlots === true,
    stayRanged: value?.stayRanged === true,
    endInCover: value?.endInCover === true,
    preserveFinalAction: value?.preserveFinalAction === true,
  };
}

export function emptyTurnIntent() {
  return normalizeTurnIntent(DEFAULT_INTENT);
}

export function turnIntentContextKey(context) {
  const combat = context?.combat ?? globalThis.game?.combat ?? null;
  const actor = context?.actor?.document ?? context?.actor ?? context?.combatant?.actor ?? null;
  const combatant = context?.combatant ?? null;
  return [
    combat?.id ?? "no-combat",
    combat?.round ?? 0,
    combat?.turn ?? -1,
    combatant?.id ?? actor?.uuid ?? actor?.id ?? "no-actor",
  ].map(String).join(":");
}

export function withTurnIntent(context, value) {
  if (!context) return context;
  return { ...context, turnIntent: normalizeTurnIntent(value) };
}

export function activeTurnIntentCount(value) {
  const intent = normalizeTurnIntent(value);
  return [
    intent.lockedTargetIds.length > 0,
    Boolean(intent.requiredActionKey),
    intent.noSpellSlots,
    intent.stayRanged,
    intent.endInCover,
    intent.preserveFinalAction,
  ].filter(Boolean).length;
}

function isRangedOffense(facts) {
  return Number(facts.targeting.maxRange) > 5
    || Number(facts.targeting.rangeIncrement) > 0
    || facts.traits.includes("ranged")
    || facts.traits.includes("thrown")
    || facts.targeting.area === true;
}

export function turnIntentCandidateAllowed(value, candidate) {
  const intent = normalizeTurnIntent(value);
  const facts = normalizedActionFacts(candidate);
  if (intent.noSpellSlots && facts.resolution.spell && facts.economy.resource?.kind === "slot") return false;
  if (
    intent.stayRanged
    && facts.resolution.attackLike
    && facts.targeting.requiresTargetableEnemy
    && !isRangedOffense(facts)
  ) return false;
  return true;
}

export function turnIntentActionBudget(value, budget) {
  const intent = normalizeTurnIntent(value);
  if (!intent.preserveFinalAction || Number(budget?.normalActions) <= 0) return budget;
  const normalActions = Math.max(0, Number(budget.normalActions) - 1);
  return {
    ...budget,
    normalActions,
    totalActions: normalActions + Math.max(0, Number(budget.quickenedActions) || 0),
    reservedActions: 1,
  };
}

function coverMovementStep(step) {
  const facts = normalizedActionFacts(step);
  return facts.targeting.requiresDestination && !facts.resolution.includesStrike;
}

export function turnIntentPlanAllowed(value, steps) {
  const intent = normalizeTurnIntent(value);
  if (intent.requiredActionKey && !steps.some((step) => String(actionKey(step)) === intent.requiredActionKey)) {
    return false;
  }
  if (intent.endInCover && !steps.some(coverMovementStep)) return false;
  return true;
}

export function applyTurnIntentToPlan(value, steps) {
  const intent = normalizeTurnIntent(value);
  if (!intent.endInCover) return steps;
  return steps.map((step) => coverMovementStep(step) ? { ...step, routeMode: "cover" } : step);
}

export function requiredTurnIntentCandidate(value, candidates) {
  const required = normalizeTurnIntent(value).requiredActionKey;
  if (!required) return null;
  return candidates.find((candidate) => String(actionKey(candidate)) === required) ?? null;
}
