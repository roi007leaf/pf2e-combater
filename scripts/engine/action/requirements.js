const AREA_SHAPES = new Set(["burst", "cone", "cube", "cylinder", "emanation", "line", "ring", "square"]);
const AREA_REGION_TYPES = new Set(["circle", "cone", "emanation", "line", "rectangle", "ring"]);
const DESTINATION_ACTION_SLUGS = new Set(["crawl", "stride", "step", "stand-stride"]);

export function actionSlug(action) {
  return String(action?.slug ?? action?.action?.slug ?? action?.actionKey ?? "").toLowerCase();
}

export function actionTargeting(action) {
  return action?.targetingProfile ?? action?.action?.targetingProfile ?? {};
}

export function actionIncludes(action, value) {
  const needle = String(value ?? "").toLowerCase();
  return Array.isArray(action?.activityProfile?.includes)
    && action.activityProfile.includes.map((entry) => String(entry ?? "").toLowerCase()).includes(needle);
}

export function isDestinationActionSlug(value) {
  return DESTINATION_ACTION_SLUGS.has(String(value ?? "").toLowerCase());
}

// Not every emanation is centered on whoever cast it. Circle of Protection is "Range touch; Area
// 10-foot emanation" and radiates from whoever you touch. `selfCentered` from classifiers is
// authoritative; otherwise a curated no-range emanation defaults to self-centered.
export function isSelfCenteredAreaAction(action) {
  const targeting = actionTargeting(action);
  if (String(targeting.type ?? "").toLowerCase() !== "emanation") return false;
  if (targeting.selfCentered === true) return true;
  return targeting.maxRange === undefined;
}

// A touch-range emanation radiates from a creature target, not an empty point.
export function isTargetCenteredAreaAction(action) {
  return actionTargeting(action)?.centerOnTarget === true;
}

export function requiresAreaMarkerForAction(action) {
  const targeting = actionTargeting(action);
  const type = String(targeting?.type ?? targeting?.shape ?? action?.area?.type ?? "").toLowerCase();
  return targeting?.area === true
    || AREA_SHAPES.has(type)
    || AREA_REGION_TYPES.has(type)
    || actionIncludes(action, "area")
    || String(action?.role ?? "").toLowerCase().includes("area");
}

export function requiresDestinationForAction(action) {
  if (!action) return false;

  // Move-and-strike activities auto-plot movement toward their target and delegate any manual
  // movement to separately-added uncounted Strides.
  if (action?.activityProfile?.includesStrike === true || actionIncludes(action, "strike")) return false;

  if (action.requiresDestination === true) return true;
  if (action?.activityProfile?.teleport === true) return true;

  const slug = actionSlug(action);
  const source = String(action?.source ?? "").toLowerCase();
  const role = String(action?.role ?? "").toLowerCase();
  if (DESTINATION_ACTION_SLUGS.has(slug) || source === "movement" || role === "movement") return true;

  return actionIncludes(action, "stride")
    || actionIncludes(action, "step")
    || Number(action?.activityProfile?.strideCount) > 0;
}

export function requiresTargetForAction(action) {
  if (!action) return false;
  if (requiresAreaMarkerForAction(action) && !isTargetCenteredAreaAction(action)) return false;

  const slug = actionSlug(action);
  if (["stand", "retch", "drop-prone", "stride", "step", "crawl", "stand-stride"].includes(slug)) return false;

  const targeting = actionTargeting(action);
  const selfOnly = targeting?.self === true && targeting?.enemy !== true && targeting?.ally !== true;
  if (selfOnly) return false;

  // Move-and-strike activities auto-plot movement to a target, so they do not prompt for manual
  // target selection. Plain strikes still require a target.
  const profile = action?.activityProfile ?? {};
  const movesToStrike = (profile.includesStrike === true || actionIncludes(action, "strike"))
    && (Number(profile.strideCount) > 0 || actionIncludes(action, "stride") || actionIncludes(action, "step"));
  if (movesToStrike) return false;

  // Flank is a plain Stride whose destination is already computed from the flanking square (the
  // ally/target geometry), not from a manually reselectable target -- picking a different "current
  // target" would not move the destination, so the control is misleading, not useful.
  if (action.requiresDestination === true && profile.setsUpFlank === true) return false;

  const suggested = action?.preferredTarget ?? action?.suggestedTarget ?? null;
  const hasExternalTarget = Boolean(suggested) && suggested?.type !== "self";

  return action?.executable === "strike"
    || action?.source === "strike"
    || action?.attackTrait === true
    || hasExternalTarget
    || targeting?.enemy === true
    || targeting?.ally === true
    || targeting?.reach === true
    || targeting?.maxTargets !== undefined
    || targeting?.maxRange !== undefined
    || action?.requiresEnemyInReach === true;
}
