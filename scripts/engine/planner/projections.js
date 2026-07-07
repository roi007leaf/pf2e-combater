import { slugify as normalizeSlug } from "../action/text.js";
import {
  actionKey,
  candidateTraitSlugs,
  currentAttackRange,
  isActionDiscountCandidate,
  isCompositionExtenderCandidate,
  isSpellAction,
} from "./rules.js";
import { t } from "../../i18n.js";

const BASE_ACTIONS = 3;
const GENERATED_STRIKE_COMPOSITE_PREFIXES = [
  "stand-stride-strike-",
  "stride-strike-stride-",
  "stride-away-strike-",
  "stride-strike-",
  "draw-strike-",
];
const COMPOSITE_MOVE_PART_NAMES = new Set(["crawl", "draw", "interact", "stand", "step", "stride", "stride-away"]);
const QUICKENED_CASTING_DISCOUNT_BONUS = 8;
const LINGERING_COMPOSITION_BONUS = 8;

function planNumericPoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}


function gridFeetPerPixel() {
  const size = Number(globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size);
  const distance = Number(globalThis.canvas?.scene?.grid?.distance ?? globalThis.canvas?.grid?.distance);
  return Number.isFinite(size) && size > 0 && Number.isFinite(distance) && distance > 0 ? distance / size : 1;
}


function priorProjectedCenter(steps) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const center = planNumericPoint(steps[index]?.activityProfile?.attackCenter)
      ?? planNumericPoint(steps[index]?.destination);
    if (center) return center;
  }
  return null;
}


function candidateVolleyRange(candidate) {
  for (const trait of candidateTraitSlugs(candidate)) {
    const match = trait.match(/^volley-(\d+)$/);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
}


function candidateTargetCenter(candidate) {
  const target = candidate?.preferredTarget ?? candidate?.suggestedTarget ?? candidate?.target;
  return planNumericPoint(target?.token?.center) ?? planNumericPoint(target?.center);
}


export function projectedVolleyPenalty(candidate, steps) {
  if (candidate?.source !== "strike") return 0;
  const volley = candidateVolleyRange(candidate);
  if (volley <= 0) return 0;

  const baseDistance = Number(candidate?.preferredTarget?.distance ?? Infinity);
  if (Number.isFinite(baseDistance) && baseDistance <= volley) return 0;

  const origin = priorProjectedCenter(steps);
  const targetCenter = candidateTargetCenter(candidate);
  if (!origin || !targetCenter) return 0;

  const projected = Math.hypot(targetCenter.x - origin.x, targetCenter.y - origin.y) * gridFeetPerPixel();
  return projected <= volley ? 10 : 0;
}


function isDiscountEligibleSpell(candidate) {
  if (!isSpellAction(candidate)) return false;
  return String(candidate?.spellcastingEntryTradition ?? "").toLowerCase() === "arcane"
    && String(candidate?.spellcastingEntryType ?? "").toLowerCase() === "spontaneous";
}


export function appliesProne(step) {
  // Match a slug that CONTAINS "drop-prone" — the live candidate's slug is the action id
  // ("generic-drop-prone"), not the bare "drop-prone", so an exact check missed it.
  const slug = String(step?.slug ?? "").toLowerCase();
  if (slug.includes("drop-prone") || step?.executable === "drop-prone") return true;
  const profile = step?.activityProfile ?? {};
  const applied = [profile.appliesCondition, ...(Array.isArray(profile.appliesConditions) ? profile.appliesConditions : [])];
  return applied.includes("prone");
}


export function isMoveAndStrike(step) {
  return step?.activityProfile?.includesStrike === true
    && Number(step?.activityProfile?.strideCount) > 0;
}


function generatedStrikeActionKey(candidate) {
  const values = [
    candidate?.id,
    candidate?.slug,
  ].map((value) => String(value ?? "").toLowerCase()).filter(Boolean);

  for (const value of values) {
    for (const prefix of GENERATED_STRIKE_COMPOSITE_PREFIXES) {
      if (!value.startsWith(prefix)) continue;
      const suffix = value.slice(prefix.length);
      if (!suffix) continue;
      return suffix.startsWith("strike-") ? suffix : `strike-${suffix}`;
    }
  }
  return null;
}


function strikeLeafName(candidate) {
  const directName = candidate?.strike?.label
    ?? candidate?.strike?.name
    ?? candidate?.strike?.item?.name
    ?? candidate?.item?.name;
  if (directName) return String(directName);

  const parts = String(candidate?.name ?? "")
    .split(" -> ")
    .map((part) => part.trim())
    .filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (!COMPOSITE_MOVE_PART_NAMES.has(normalizeSlug(parts[index]))) return parts[index];
  }
  return String(candidate?.name ?? "Strike").trim() || "Strike";
}


function strikeDamageScoreEstimate(averageDamage) {
  return Math.min(averageDamage * 2, 40) + averageDamage * 0.25;
}


function followUpStrikeScore(candidate) {
  const average = Number(
    candidate?.damageProfile?.average
      ?? candidate?.activityProfile?.averageDamage
      ?? candidate?.averageDamage,
  );
  const directScore = 46 + 24 + (Number.isFinite(average) && average > 0 ? strikeDamageScoreEstimate(average) : 0);
  const compositeScore = Number(candidate?.score);
  const projectedScore = Number.isFinite(compositeScore) ? compositeScore - 55 : directScore;
  return Math.max(52, directScore, projectedScore);
}


function projectedFollowUpStrikeCandidate(candidate) {
  if (!isMoveAndStrike(candidate)) return null;
  if (Number(candidate?.actionCost) >= BASE_ACTIONS) return null;

  const id = generatedStrikeActionKey(candidate);
  if (!id) return null;

  const range = currentAttackRange(candidate);
  const sourceKey = actionKey(candidate);
  return {
    ...candidate,
    id,
    slug: "strike",
    name: strikeLeafName(candidate),
    actionCost: 1,
    cost: 1,
    source: "strike",
    executable: "strike",
    attackTrait: true,
    available: true,
    range: Number.isFinite(range) && range > 0 ? { ...(candidate.range ?? {}), max: range } : candidate.range,
    score: followUpStrikeScore(candidate),
    reason: t("Plan.ProjectedFollowUpStrike", "{name} is in range after the movement.", { name: strikeLeafName(candidate) }),
    activityProfile: {
      ...(candidate.activityProfile ?? {}),
      includes: ["strike"],
      includesStrike: true,
      strideCount: 0,
      retreatBeforeStrike: false,
      retreatAfterStrike: false,
      requiresProjectedAfterKey: sourceKey,
    },
  };
}


function projectedTakeCoverAfterProneCandidate(candidate) {
  if (!appliesProne(candidate)) return null;
  return {
    id: "take-cover",
    slug: "take-cover",
    name: t("Action.TakeCover", "Take Cover"),
    actionCost: 1,
    cost: 1,
    source: "generic",
    role: "defense",
    confidence: "medium",
    executable: "pf2e-action",
    detected: true,
    available: true,
    score: 28,
    reason: t("Plan.TakeCoverAfterProne", "Take Cover after dropping prone."),
    activityProfile: {
      includes: ["take-cover"],
      requiresProneCover: true,
      requiresProjectedAfterKey: actionKey(candidate),
    },
  };
}


function projectedQuickenedCastingSpellCandidate(candidate) {
  if (!isDiscountEligibleSpell(candidate)) return null;
  const baseCost = Number(candidate.actionCost);
  if (!Number.isFinite(baseCost) || baseCost < 2) return null;
  const discountedCost = baseCost - 1;
  return {
    ...candidate,
    id: `${candidate.id ?? candidate.slug ?? candidate.name}-quickened-casting`,
    actionCost: discountedCost,
    cost: discountedCost,
    score: Number(candidate.score) + QUICKENED_CASTING_DISCOUNT_BONUS,
    reason: t("Plan.QuickenedCastingDiscount", "{name} costs 1 fewer action after Quickened Casting.", { name: candidate.name }),
    activityProfile: {
      ...(candidate.activityProfile ?? {}),
      previousActionRequirements: ["quickened-casting"],
    },
  };
}


export function withQuickenedCastingDiscountCandidates(candidates) {
  return candidates.flatMap((candidate) => {
    if (!isActionDiscountCandidate(candidate)) return [candidate];
    const discounted = candidates.map(projectedQuickenedCastingSpellCandidate).filter(Boolean);
    return discounted.length ? [candidate, ...discounted] : [candidate];
  });
}


export function isCompositionExtensionEligible(candidate) {
  if (isCompositionExtenderCandidate(candidate)) return false;
  const traits = candidate?.activityProfile?.traits;
  return (Array.isArray(traits) && traits.includes("composition")) || candidate?.activityProfile?.composition === true;
}


function projectedLingeringCompositionCantripCandidate(candidate) {
  if (!isCompositionExtensionEligible(candidate)) return null;
  return {
    ...candidate,
    id: `${candidate.id ?? candidate.slug ?? candidate.name}-lingering-composition`,
    score: Number(candidate.score) + LINGERING_COMPOSITION_BONUS,
    reason: t("Plan.LingeringCompositionExtend", "{name} lasts longer after Lingering Composition.", { name: candidate.name }),
    activityProfile: {
      ...(candidate.activityProfile ?? {}),
      previousActionRequirements: ["lingering-composition"],
    },
  };
}


export function withLingeringCompositionCandidates(candidates) {
  return candidates.flatMap((candidate) => {
    if (!isCompositionExtenderCandidate(candidate)) return [candidate];
    const extended = candidates.map(projectedLingeringCompositionCantripCandidate).filter(Boolean);
    return extended.length ? [candidate, ...extended] : [candidate];
  });
}


export function withProjectedFollowUpStrikeCandidates(candidates) {
  return candidates.flatMap((candidate) => {
    const followUps = [
      projectedFollowUpStrikeCandidate(candidate),
      projectedTakeCoverAfterProneCandidate(candidate),
    ].filter(Boolean);
    return followUps.length ? [candidate, ...followUps] : [candidate];
  });
}


export function projectedFollowUpSatisfied(context, candidate, steps) {
  const sourceKey = candidate?.activityProfile?.requiresProjectedAfterKey;
  if (!sourceKey) return true;
  if (!steps.some((step) => actionKey(step) === sourceKey)) return false;

  const origin = priorProjectedCenter(steps);
  const targetCenter = candidateTargetCenter(candidate);
  if (!origin || !targetCenter) return true;

  const range = currentAttackRange(candidate);
  if (!Number.isFinite(range) || range <= 0) return true;

  const distance = Math.hypot(targetCenter.x - origin.x, targetCenter.y - origin.y) * gridFeetPerPixel();
  return distance <= range + 1e-6;
}
