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

export function actionBudget(context) {
  const profile = context?.profile ?? context?.actor?.profile ?? {};
  const slowed = profileStateValue(profile, "slowed");
  const stunned = profileStateValue(profile, "stunned");
  const quickened = profileStateValue(profile, "quickened");
  const spent = spentNormalActions(context);
  const normalActions = Math.max(0, BASE_ACTIONS - slowed - stunned - spent);

  return {
    normalActions,
    quickenedActions: quickened > 0 ? 1 : 0,
    totalActions: normalActions + (quickened > 0 ? 1 : 0),
    slowed,
    stunned,
    quickened,
    spent,
  };
}
