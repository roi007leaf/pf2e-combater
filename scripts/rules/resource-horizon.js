import { t } from '../i18n.js';
import { normalizedActionFacts } from '../engine/action/facts.js';

export const RESOURCE_HORIZON_MODES = Object.freeze(['conserve', 'normal', 'burst']);

const MODE_SET = new Set(RESOURCE_HORIZON_MODES);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function numericValue(...values) {
  for (const value of values) {
    const primitive = value && typeof value === 'object' && 'value' in value ? value.value : value;
    if (primitive === null || primitive === undefined || primitive === '') continue;
    const numeric = Number(primitive);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function resourceLabel(resource) {
  const labels = {
    renewable: t('ResourceHorizon.Cantrip', 'cantrip'),
    focus: t('ResourceHorizon.FocusPoint', 'focus point'),
    slot: t('ResourceHorizon.SpellSlot', 'ranked spell slot'),
    consumable: t('ResourceHorizon.Consumable', 'consumable'),
    innate: t('ResourceHorizon.InnateUse', 'innate spell use'),
    encounter: t('ResourceHorizon.EncounterUse', 'encounter use'),
    limited: t('ResourceHorizon.LimitedUse', 'limited use'),
  };
  return labels[resource?.kind] ?? labels.limited;
}

function resourceScarcity(resource) {
  const remaining = numericValue(resource?.remaining);
  const max = numericValue(resource?.max);
  if (remaining !== null && max !== null && max > 0) {
    return clamp(Math.max(1 - remaining / max, 1 / max), 0, 1);
  }
  if (remaining === null) return 0.5;
  if (remaining <= 1) return 1;
  if (remaining === 2) return 0.7;
  if (remaining === 3) return 0.45;
  return 0.25;
}

function battlefieldEntries(context, key) {
  const entries = context?.battlefield?.[key] ?? context?.[key];
  return Array.isArray(entries) ? entries : [];
}

function encounterForecast(context) {
  const enemies = battlefieldEntries(context, 'enemies');
  const allies = battlefieldEntries(context, 'allies');
  const round = Math.max(1, numericValue(context?.combat?.round) ?? 1);
  const ownHp = clamp(
    numericValue(context?.actor?.profile?.hp?.percent, context?.profile?.hp?.percent) ?? 1,
    0,
    1,
  );
  const allyHp = allies.map((ally) => numericValue(ally?.hpPercent)).filter(Number.isFinite);
  const mostWoundedAlly = allyHp.length ? Math.min(...allyHp) : 1;
  const remainingRounds = clamp(4 - round + Math.ceil(enemies.length / 2), 1, 5);
  const pressure = clamp(
    0.18 +
      Math.min(0.32, enemies.length * 0.08) +
      (1 - ownHp) * 0.35 +
      (1 - mostWoundedAlly) * 0.15 +
      Math.min(0.15, Math.max(0, round - 1) * 0.05),
    0,
    1,
  );
  return { pressure, remainingRounds };
}

function conserveAdjustment(resource, forecast) {
  if (resource.kind === 'renewable') return 8;
  const scarcity = resourceScarcity(resource);
  const horizon = 0.75 + forecast.remainingRounds * 0.08;
  const pressureRelief = 1 - forecast.pressure * 0.2;
  if (resource.kind === 'focus') return -Math.round((3 + scarcity * 6) * horizon * pressureRelief);
  if (resource.kind === 'slot') {
    return -Math.round(
      (8 + scarcity * 7 + Math.min(4, (resource.rank ?? 0) * 0.5)) * horizon * pressureRelief,
    );
  }
  if (resource.kind === 'encounter')
    return -Math.round((5 + scarcity * 6) * horizon * pressureRelief);
  if (resource.kind === 'consumable')
    return -Math.round((8 + scarcity * 8) * horizon * pressureRelief);
  return -Math.round((7 + scarcity * 7) * horizon * pressureRelief);
}

function burstAdjustment(resource, forecast) {
  if (resource.kind === 'renewable') return -5;
  const scarcity = resourceScarcity(resource);
  const urgency = 0.8 + forecast.pressure * 0.75 + (5 - forecast.remainingRounds) * 0.04;
  if (resource.kind === 'focus') return Math.round((6 + scarcity * 2) * urgency);
  if (resource.kind === 'slot')
    return Math.round((8 + scarcity * 3 + Math.min(4, (resource.rank ?? 0) * 0.5)) * urgency);
  if (resource.kind === 'encounter') return Math.round((8 + scarcity * 2) * urgency);
  if (resource.kind === 'consumable') return Math.round((7 + scarcity * 3) * urgency);
  return Math.round((7 + scarcity * 3) * urgency);
}

export function normalizeResourceHorizon(value) {
  const mode = String(value ?? '')
    .trim()
    .toLowerCase();
  return MODE_SET.has(mode) ? mode : 'normal';
}

export function nextResourceHorizon(value, direction = 1) {
  const current = RESOURCE_HORIZON_MODES.indexOf(normalizeResourceHorizon(value));
  const offset = Number(direction) < 0 ? -1 : 1;
  return RESOURCE_HORIZON_MODES[
    (current + offset + RESOURCE_HORIZON_MODES.length) % RESOURCE_HORIZON_MODES.length
  ];
}

export function withResourceHorizon(context, mode) {
  if (!context) return context;
  return { ...context, resourceHorizon: normalizeResourceHorizon(mode) };
}

export function resourceHorizonAdjustment(context, action) {
  const mode = normalizeResourceHorizon(context?.resourceHorizon);
  if (mode === 'normal') return { scoreDelta: 0, reasons: [] };
  const resource = normalizedActionFacts(action).economy.resource;
  if (!resource) return { scoreDelta: 0, reasons: [] };

  const forecast = encounterForecast(context);
  const rawDelta =
    mode === 'conserve'
      ? conserveAdjustment(resource, forecast)
      : burstAdjustment(resource, forecast);
  const scoreDelta = clamp(rawDelta, -20, 20);
  const renewable = resource.kind === 'renewable';
  const reason =
    mode === 'conserve'
      ? renewable
        ? t('ScoreReason.ResourceConserveRenewable', 'Conserve mode favors renewable actions.')
        : t(
            'ScoreReason.ResourceConserveScarce',
            'Conserve mode protects this {resource} for later rounds.',
            { resource: resourceLabel(resource) },
          )
      : renewable
        ? t(
            'ScoreReason.ResourceBurstRenewable',
            'Burst mode deprioritizes renewable actions while stronger resources are available.',
          )
        : t(
            'ScoreReason.ResourceBurstSpend',
            'Burst mode favors spending this {resource} while encounter pressure is high.',
            { resource: resourceLabel(resource) },
          );

  return { scoreDelta, reasons: [reason] };
}

export function resourceHorizonView(value) {
  const mode = normalizeResourceHorizon(value);
  const metadata = {
    conserve: {
      label: t('ResourceHorizon.Conserve', 'Conserve'),
      icon: 'fa-battery-quarter',
      tooltip: t(
        'ResourceHorizon.ConserveTooltip',
        'Conserve favors renewable actions and protects scarce resources. Left-click next; right-click previous.',
      ),
    },
    normal: {
      label: t('ResourceHorizon.Normal', 'Normal'),
      icon: 'fa-battery-half',
      tooltip: t(
        'ResourceHorizon.NormalTooltip',
        'Normal keeps standard tactical resource scoring. Left-click next; right-click previous.',
      ),
    },
    burst: {
      label: t('ResourceHorizon.Burst', 'Burst'),
      icon: 'fa-bolt',
      tooltip: t(
        'ResourceHorizon.BurstTooltip',
        'Burst favors spending slots, consumables, and limited uses now. Left-click next; right-click previous.',
      ),
    },
  }[mode];
  return {
    mode,
    ...metadata,
    isConserve: mode === 'conserve',
    isBurst: mode === 'burst',
    ariaLabel: t('ResourceHorizon.Aria', 'Change resource horizon'),
  };
}
