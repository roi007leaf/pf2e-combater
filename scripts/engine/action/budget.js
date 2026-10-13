import { slugify as normalizeSlug } from "./text.js";

const BASE_ACTIONS = 3;

function conditionValue(conditions, slug) {
  if (!conditions) return 0;
  const slugs = Array.isArray(conditions.slugs) ? conditions.slugs : [];
  if (!slugs.includes(slug)) return 0;

  const value = Number(conditions.values?.[slug]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function effectMatchesSlug(effect, slug) {
  const normalized = normalizeSlug(slug);
  const values = [
    effect?.slug,
    effect?.name,
    effect?.label,
    effect?.system?.slug?.value,
    effect?.system?.slug,
  ].map(normalizeSlug);
  return values.some((value) => value === normalized || value === `effect-${normalized}`);
}

function effectValue(effects, slug) {
  if (!Array.isArray(effects)) return 0;
  const effect = effects.find((entry) => effectMatchesSlug(entry, slug));
  if (!effect) return 0;

  const value = Number(effect?.value ?? effect?.system?.value?.value ?? effect?.system?.badge?.value);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function profileStateValue(profile, slug) {
  return Math.max(
    conditionValue(profile?.conditions, slug),
    effectValue(profile?.effects, slug),
  );
}

function spentNormalActions(context) {
  const spent = Number(
    context?.actionsSpent?.normal
      ?? context?.actionsSpent?.total
      ?? context?.profile?.actionsSpent?.normal
      ?? context?.profile?.actionsSpent?.total
      ?? 0,
  );
  return Number.isFinite(spent) && spent > 0 ? spent : 0;
}

export function turnActionPool(profile = {}) {
  const slowed = profileStateValue(profile, "slowed");
  const stunned = profileStateValue(profile, "stunned");
  const quickened = profileStateValue(profile, "quickened");
  // Choose to lose the restricted quickened action before unrestricted normal actions.
  const lost = profile.stunnedDuration ? BASE_ACTIONS + (quickened > 0 ? 1 : 0) : Math.max(slowed, stunned);
  const quickenedLost = quickened > 0 && lost > 0 ? 1 : 0;
  const quickenedActions = quickened > 0 ? 1 - quickenedLost : 0;
  const normalActions = Math.max(0, BASE_ACTIONS - (lost - quickenedLost));

  return {
    normalActions,
    quickenedActions,
    totalActions: normalActions + quickenedActions,
    slowed,
    stunned,
    stunnedDuration: profile.stunnedDuration === true,
    quickened,
  };
}

export function actionBudget(context) {
  const pool = context?.turnActionPool ?? turnActionPool(context?.profile ?? context?.actor?.profile ?? {});
  const spent = spentNormalActions(context);
  const quickenedSpent = Math.max(0, Number(context?.actionsSpent?.quickened) || 0);
  const normalActions = Math.max(0, pool.normalActions - spent);
  const quickenedActions = Math.max(0, pool.quickenedActions - quickenedSpent);
  return { ...pool, normalActions, quickenedActions, totalActions: normalActions + quickenedActions, spent };
}

export function quickenedEligible(action, cost, context = {}) {
  if (Number(cost) !== 1) return false;
  const allowed = context.quickenedAllowed ?? ["strike", "stride"];
  const slug = action?.source === "strike" ? "strike" : action?.slug;
  return allowed.includes(slug);
}

export function stepAlreadySpent(context, step) {
  return Boolean(step?.instanceId && context?.actionTracker?.executionIds?.includes(step.instanceId));
}
