import { actorItems, collectionValues, systemValue } from "../foundry-data.js";
import { t } from "../i18n.js";
import { readDraftPlan } from "../state/draft-plans.js";
import { contextActorDocument } from "./actor-context.js";
import { slugify as normalizeSlug } from "./action/text.js";
import { readSustainedSpellEntries } from "./sustained-spells.js";

const ROUND_SECONDS = 6;
const BUCKET_ORDER = ["attention", "soon", "handled", "later"];

function documentId(document) {
  return document?.id ?? document?._id ?? null;
}

function documentSlug(document) {
  return normalizeSlug(document?.slug ?? systemValue(document?.system?.slug) ?? document?.name);
}

function effectDocuments(actor) {
  const itemEffects = actorItems(actor, "effect");
  const itemIds = new Set(itemEffects.map(documentId).filter(Boolean));
  const activeEffects = collectionValues(actor?.effects)
    .filter((effect) => !itemIds.has(documentId(effect)));
  return [...itemEffects, ...activeEffects];
}

function activeConditions(actor) {
  const nativeActive = collectionValues(actor?.conditions?.active).filter(Boolean);
  if (nativeActive.length) return nativeActive;
  return actorItems(actor, "condition").filter((condition) => condition?.active !== false);
}

function visibleToCurrentUser(document) {
  if (globalThis.game?.user?.isGM === true) return true;
  return document?.hidden !== true
    && document?.visible !== false
    && document?.isVisible !== false
    && document?.isIdentified !== false
    && document?.system?.hidden !== true
    && document?.system?.visible !== false
    && document?.system?.unidentified !== true;
}

function nativeRemainingDuration(effect) {
  try {
    return effect?.remainingDuration ?? null;
  } catch (_error) {
    return null;
  }
}

function durationTiming(effect) {
  const duration = effect?.system?.duration ?? {};
  const unit = normalizeSlug(duration?.unit);
  const native = nativeRemainingDuration(effect);
  const expired = native?.expired === true || effect?.isExpired === true || effect?.system?.expired === true;
  const rawRemaining = native?.remaining;
  const remaining = rawRemaining === Infinity
    ? Infinity
    : Number.isFinite(Number(rawRemaining))
      ? Math.max(0, Number(rawRemaining))
      : null;

  if (unit === "unlimited" || unit === "unlimited-duration") return null;
  if (unit === "encounter") {
    return {
      expired,
      expiry: normalizeSlug(duration?.expiry),
      remaining: expired ? 0 : Infinity,
      timingLabel: expired
        ? t("EffectClock.Expired", "Expired")
        : t("EffectClock.Encounter", "Until encounter ends"),
    };
  }
  if (remaining === null) return null;

  const expiry = normalizeSlug(duration?.expiry);
  const initiative = Number(effect?.system?.start?.initiative);
  let timingLabel;
  if (expired) {
    timingLabel = t("EffectClock.Expired", "Expired");
  } else if (remaining === 0) {
    const boundary = expiry === "turn-start"
      ? t("EffectClock.TurnStart", "turn start")
      : expiry === "round-end"
        ? t("EffectClock.RoundEnd", "round end")
        : t("EffectClock.TurnEnd", "turn end");
    timingLabel = Number.isFinite(initiative)
      ? t("EffectClock.ExpiresAtInitiative", "Expires at {boundary} (initiative {initiative})", { boundary, initiative })
      : t("EffectClock.ExpiresAt", "Expires at {boundary}", { boundary });
  } else if (remaining <= ROUND_SECONDS) {
    timingLabel = t("EffectClock.OneRound", "Within 1 round");
  } else if (remaining <= ROUND_SECONDS * 2) {
    timingLabel = t("EffectClock.TwoRounds", "Within 2 rounds");
  } else if (remaining < 60) {
    timingLabel = t("EffectClock.Rounds", "About {count} rounds", { count: Math.ceil(remaining / ROUND_SECONDS) });
  } else if (remaining < 3600) {
    timingLabel = t("EffectClock.Minutes", "About {count} minutes", { count: Math.ceil(remaining / 60) });
  } else if (remaining < 86400) {
    timingLabel = t("EffectClock.Hours", "About {count} hours", { count: Math.ceil(remaining / 3600) });
  } else {
    timingLabel = t("EffectClock.Days", "About {count} days", { count: Math.ceil(remaining / 86400) });
  }

  return { expired, expiry, remaining, timingLabel };
}

function timingBucket(timing) {
  if (timing.expired || timing.remaining <= ROUND_SECONDS) return "attention";
  if (timing.remaining <= ROUND_SECONDS * 2) return "soon";
  return "later";
}

function effectEntry(effect, timing) {
  const bucket = timingBucket(timing);
  return {
    id: `effect-${documentId(effect) ?? documentSlug(effect)}`,
    kind: "effect",
    name: effect?.name ?? effect?.label ?? t("EffectClock.Effect", "Effect"),
    img: effect?.img ?? effect?.icon ?? null,
    documentUuid: effect?.uuid ?? null,
    statusLabel: timing.expired
      ? t("EffectClock.NeedsCleanup", "Needs attention")
      : t("EffectClock.Duration", "Timed effect"),
    timingLabel: timing.timingLabel,
    detail: timing.expired
      ? t("EffectClock.ExpiredDetail", "PF2e reports this effect as expired.")
      : t("EffectClock.NativeTimingDetail", "Timing follows the live PF2e effect duration."),
    remaining: timing.remaining,
    bucket,
    urgent: bucket === "attention",
  };
}

function conditionValue(condition) {
  const raw = condition?.value ?? systemValue(condition?.system?.value);
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function conditionNameWithValue(condition, fallback, value) {
  const name = String(condition?.name ?? fallback).trim();
  return new RegExp(`\\s${value}$`).test(name) ? name : `${name} ${value}`;
}

function conditionEntries(actor) {
  const entries = [];
  for (const condition of activeConditions(actor).filter(visibleToCurrentUser)) {
    const slug = documentSlug(condition);
    if (slug === "persistent-damage") {
      entries.push({
        id: `condition-${documentId(condition) ?? slug}`,
        kind: "condition",
        name: condition?.name ?? t("EffectClock.PersistentDamage", "Persistent Damage"),
        img: condition?.img ?? condition?.icon ?? null,
        documentUuid: condition?.uuid ?? null,
        statusLabel: t("EffectClock.EndOfTurn", "End of turn"),
        timingLabel: t("EffectClock.PersistentTiming", "Damage, then recovery check"),
        detail: t("EffectClock.PersistentDetail", "PF2e resolves persistent damage and its recovery check at turn end."),
        remaining: 0,
        bucket: "attention",
        urgent: true,
      });
    } else if (slug === "frightened" && conditionValue(condition) > 0) {
      const value = conditionValue(condition);
      entries.push({
        id: `condition-${documentId(condition) ?? slug}`,
        kind: "condition",
        name: conditionNameWithValue(condition, t("EffectClock.Frightened", "Frightened"), value),
        img: condition?.img ?? condition?.icon ?? null,
        documentUuid: condition?.uuid ?? null,
        statusLabel: t("EffectClock.EndOfTurn", "End of turn"),
        timingLabel: t("EffectClock.FrightenedTiming", "Decreases by 1"),
        detail: t("EffectClock.FrightenedDetail", "Normally decreases by 1 when this turn ends."),
        remaining: 0,
        bucket: "attention",
        urgent: true,
      });
    }
  }
  return entries;
}

function compareEntries(left, right) {
  const kindOrder = { sustain: 0, condition: 1, effect: 2 };
  const kindDifference = (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9);
  if (kindDifference !== 0) return kindDifference;
  const leftRemaining = left.remaining === Infinity ? Number.MAX_SAFE_INTEGER : Number(left.remaining ?? 0);
  const rightRemaining = right.remaining === Infinity ? Number.MAX_SAFE_INTEGER : Number(right.remaining ?? 0);
  if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
  return String(left.name ?? "").localeCompare(String(right.name ?? ""));
}

function groupView(id, entries) {
  const labels = {
    attention: t("EffectClock.Group.Attention", "Attention this turn"),
    soon: t("EffectClock.Group.Soon", "Within 2 rounds"),
    handled: t("EffectClock.Group.Handled", "Handled this turn"),
    later: t("EffectClock.Group.Later", "Later"),
  };
  const grouped = entries.filter((entry) => entry.bucket === id).toSorted(compareEntries);
  return { id, label: labels[id], entries: grouped, hasEntries: grouped.length > 0 };
}

export function buildEffectClock(context, {
  draft = readDraftPlan(context),
  sustainedEntries = readSustainedSpellEntries(context, undefined, draft),
} = {}) {
  const actor = contextActorDocument(context, { allowActorFallback: true });
  if (!actor) {
    return { entries: [], groups: [], urgentCount: 0, totalCount: 0, hasEntries: false };
  }

  const allEffects = effectDocuments(actor);
  const effects = allEffects.filter(visibleToCurrentUser);
  const sustainedEffectIds = new Set(
    (Array.isArray(sustainedEntries) ? sustainedEntries : [])
      .flatMap((entry) => entry?.effectIds ?? [])
      .filter(Boolean)
      .map(String),
  );
  const entries = [];

  for (const effect of effects) {
    if (sustainedEffectIds.has(String(documentId(effect)))) continue;
    const timing = durationTiming(effect);
    if (timing) entries.push(effectEntry(effect, timing));
  }
  entries.push(...conditionEntries(actor));

  const groups = BUCKET_ORDER.map((id) => groupView(id, entries));
  const urgentCount = entries.filter((entry) => entry.urgent).length;
  return {
    entries,
    groups,
    urgentCount,
    totalCount: entries.length,
    hasEntries: entries.length > 0,
  };
}
