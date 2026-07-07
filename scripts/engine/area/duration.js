// Pure duration helpers for auto-expiring placed area templates (Regions). PF2e spell
// durations are free strings like "1 minute"; PF2e effects use structured {value, unit}.
// We parse the spell string, build a linked timer effect for the visible countdown, and
// stamp the region with a plain expiry the GM-side sweep can act on without any live docs.

import { collectionValues } from "../../foundry-data.js";

const ROUND_SECONDS = 6;
const UNIT_SECONDS = { round: 6, minute: 60, hour: 3600, day: 86400 };
// Map a singular parsed unit to the PF2e effect duration unit.
const EFFECT_UNIT = { round: "rounds", minute: "minutes", hour: "hours", day: "days" };
const DEFAULT_SUSTAINED_SECONDS = 60; // Sustained spells cap at 1 minute (10 rounds).

function timerFromSeconds(seconds, unit, value, sustained) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return {
    value,
    unit: EFFECT_UNIT[unit] ?? "minutes",
    seconds,
    rounds: Math.max(1, Math.ceil(seconds / ROUND_SECONDS)),
    sustained: sustained === true,
  };
}

// Parse a PF2e spell duration string into a concrete timer descriptor, or null when the
// area has no auto-expiry (instantaneous, unlimited, "until ...", or unparseable).
export function parseSpellDuration(durationString, { sustained = false } = {}) {
  const text = String(durationString ?? "").toLowerCase().trim();
  const match = text.match(/(\d+)\s*(round|minute|hour|day)s?/);

  if (sustained || /^sustained/.test(text)) {
    if (match) {
      const value = Number(match[1]);
      const unit = match[2];
      return timerFromSeconds(value * UNIT_SECONDS[unit], unit, value, true);
    }
    return timerFromSeconds(DEFAULT_SUSTAINED_SECONDS, "minute", 1, true);
  }

  if (!text || text === "instantaneous" || text === "unlimited" || text.startsWith("until")) return null;
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2];
  return timerFromSeconds(value * UNIT_SECONDS[unit], unit, value, false);
}

// PF2e Effect item data for the visible countdown badge, linked back to its region.
export function buildAreaTimerEffectData({ action, regionId, sceneId, duration, worldTime = null, initiative = null }) {
  if (!duration || !regionId) return null;
  const name = action?.name ?? action?.item?.name ?? "Area effect";
  const img = action?.item?.img ?? action?.img ?? "icons/svg/aura.svg";
  const level = Number(action?.castRank ?? action?.rank ?? action?.item?.system?.level?.value) || 1;
  return {
    type: "effect",
    name,
    img,
    system: {
      tokenIcon: { show: true },
      duration: { value: duration.value, unit: duration.unit, expiry: null, sustained: duration.sustained === true },
      start: { value: Number.isFinite(worldTime) ? worldTime : 0, initiative: initiative ?? null },
      level: { value: level },
      slug: null,
      rules: [],
    },
    flags: { "pf2e-combater": { areaRegion: { regionId, sceneId: sceneId ?? null } } },
  };
}

// Plain, serializable expiry stamped on the region — the backbone of removal. Works even
// when the effect could not be created or the world's effect-expiry setting is off.
export function buildAreaTimerFlag({ duration, worldTime = null, round = null, effectUuid = null, casterActorUuid = null }) {
  if (!duration) return null;
  return {
    effectUuid,
    casterActorUuid,
    sustained: duration.sustained === true,
    expiresWorldTime: Number.isFinite(worldTime) ? worldTime + duration.seconds : null,
    expiresRound: Number.isFinite(round) ? round + duration.rounds : null,
  };
}

export function readAreaTimer(region) {
  return region?.flags?.["pf2e-combater"]?.areaTimer
    ?? region?.getFlag?.("pf2e-combater", "areaTimer")
    ?? null;
}

// Has this region's timer elapsed? World time is PF2e's canonical clock; the round check
// covers tables that advance combat rounds without advancing world time.
export function areaTimerExpired(areaTimer, { worldTime = null, round = null } = {}) {
  if (!areaTimer) return false;
  const { expiresWorldTime, expiresRound } = areaTimer;
  if (worldTime != null && expiresWorldTime != null && worldTime >= expiresWorldTime) return true;
  if (round != null && expiresRound != null && round >= expiresRound) return true;
  return false;
}

// Region ids (with their linked effect) on a scene whose timer has elapsed.
export function expiredAreaRegionsForScene(scene, { worldTime = null, round = null } = {}) {
  const sceneId = scene?.id ?? scene?._id ?? null;
  const expired = [];
  for (const region of collectionValues(scene?.regions)) {
    const timer = readAreaTimer(region);
    const regionId = region?.id ?? region?._id ?? null;
    if (!regionId || !timer) continue;
    if (areaTimerExpired(timer, { worldTime, round })) {
      expired.push({ regionId, sceneId, effectUuid: timer.effectUuid ?? null });
    }
  }
  return expired;
}
