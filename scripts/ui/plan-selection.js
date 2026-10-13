const ALTERNATIVE_DIVERSITY_WINDOW = 6;
const BASIC_MOVE_SLUGS = new Set(["crawl", "step", "stride", "stand", "stand-stride"]);
const SKILL_ACTION_SLUGS = new Set([
  "demoralize",
  "recall-knowledge",
  "create-a-diversion",
  "feint",
  "trip",
  "grapple",
  "disarm",
  "shove",
  "reposition",
  "tumble-through",
  "seek",
  "sense-motive",
]);
const PLAN_DIVERSITY_CATEGORIES = [
  "strike",
  "class",
  "skill",
  "support",
  "movement",
  "item",
  "spell",
];

export function selectDisplayPlan(plans, pinnedPlanId) {
  const safePlans = Array.isArray(plans) ? plans : [];
  if (!pinnedPlanId) return safePlans[0] ?? null;
  return safePlans.find((plan) => plan?.id === pinnedPlanId) ?? safePlans[0] ?? null;
}

export function bestAutoFillPlan(plans) {
  return Array.isArray(plans) ? plans[0] ?? null : null;
}

function isSpellStep(step) {
  return String(step?.source ?? "").startsWith("spell");
}

function isStrikeStep(step) {
  return step?.source === "strike"
    || step?.activityProfile?.includesStrike === true
    || step?.activityProfile?.drawsWeapon === true;
}

function isItemStep(step) {
  return step?.item?.type === "consumable"
    || step?.type === "consumable"
    || Number(step?.interactDrawCost) > 0;
}

function stepCategory(step) {
  if (["healing", "defense", "buff", "stealth-defense", "self-healing"].includes(step?.role)) return "support";
  if (isStrikeStep(step)) return "strike";
  if (isSpellStep(step)) return "spell";
  if (step?.activityProfile?.impulse === true) return "class";
  if (BASIC_MOVE_SLUGS.has(step?.slug) || step?.role === "mobility") return "movement";
  if (isItemStep(step)) return "item";
  if (step?.skill || SKILL_ACTION_SLUGS.has(step?.slug)) return "skill";
  if (["custom-curated", "system-inferred"].includes(step?.source)) return "class";
  return "other";
}

function planCategories(plan) {
  return new Set((Array.isArray(plan?.steps) ? plan.steps : [])
    .map(stepCategory)
    .filter(Boolean));
}

function sortedAlternatives(alternatives, totalActions) {
  return [...alternatives].toSorted((left, right) => {
    if (Number.isFinite(totalActions) && totalActions > 0) {
      const leftFull = Number(left?.totalCost) >= totalActions;
      const rightFull = Number(right?.totalCost) >= totalActions;
      if (leftFull !== rightFull) return rightFull ? 1 : -1;
    }

    const leftScore = Number(left?.score);
    const rightScore = Number(right?.score);
    if (Number.isFinite(leftScore) && Number.isFinite(rightScore) && rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return 0;
  });
}

function diversifyFirstAlternatives(sortedPlans) {
  const selected = [];
  const selectedIds = new Set();
  const selectedCategories = new Set();

  function add(plan) {
    if (!plan || selectedIds.has(plan.id)) return;
    selected.push(plan);
    selectedIds.add(plan.id);
    for (const category of planCategories(plan)) selectedCategories.add(category);
  }

  add(sortedPlans[0]);

  for (const category of PLAN_DIVERSITY_CATEGORIES) {
    if (selected.length >= ALTERNATIVE_DIVERSITY_WINDOW) break;
    if (selectedCategories.has(category)) continue;
    add(sortedPlans.find((plan) => !selectedIds.has(plan.id) && planCategories(plan).has(category)));
  }

  for (const plan of sortedPlans) {
    if (selected.length >= ALTERNATIVE_DIVERSITY_WINDOW) break;
    add(plan);
  }

  return [
    ...selected,
    ...sortedPlans.filter((plan) => !selectedIds.has(plan.id)),
  ];
}

export function selectableAlternativePlans(plans, displayPlan) {
  const displayPlanId = displayPlan?.id ?? null;
  const alternatives = (Array.isArray(plans) ? plans : []).filter((plan) => plan?.id !== displayPlanId);
  const totalActions = Number(displayPlan?.actionBudget?.totalActions);
  return diversifyFirstAlternatives(sortedAlternatives(alternatives, totalActions));
}

export function autoFillCyclePlans(plans) {
  const safePlans = Array.isArray(plans) ? plans.filter(Boolean) : [];
  const displayPlan = safePlans[0] ?? null;
  if (!displayPlan) return [];
  return [displayPlan, ...selectableAlternativePlans(safePlans, displayPlan)];
}

export function nextAutoFillPlan(plans, currentPlanId) {
  const cycle = autoFillCyclePlans(plans);
  if (!cycle.length) return null;
  const currentIndex = cycle.findIndex((plan) => plan?.id === currentPlanId);
  return cycle[(currentIndex + 1) % cycle.length] ?? cycle[0];
}

export function previousAutoFillPlan(plans, currentPlanId) {
  const cycle = autoFillCyclePlans(plans);
  if (!cycle.length) return null;
  const currentIndex = cycle.findIndex((plan) => plan?.id === currentPlanId);
  const index = currentIndex >= 0 ? currentIndex : 0;
  return cycle[(index - 1 + cycle.length) % cycle.length] ?? cycle[0];
}

function stepKey(step) {
  return String(step?.actionKey ?? step?.id ?? step?.slug ?? step?.name ?? "");
}

function stepLabel(steps) {
  return steps.map((step) => step?.name ?? "?").join(", ");
}

// "Why this plan": the best plan that does something different this turn (not the same actions
// grouped differently, e.g. "Stride -> Longsword" vs "Stride, Longsword"), and what differs.
function planAtoms(plan) {
  const atoms = [];
  for (const step of plan?.steps ?? []) {
    const target = step?.suggestedTarget?.name ?? step?.preferredTarget?.name ?? "";
    for (const part of String(step?.name ?? "?").split(/\s*->\s*/)) {
      const label = part.trim() || "?";
      // Movement squares differ plan to plan; a Stride is a Stride.
      atoms.push(/^(?:stride|step)$/i.test(label) ? label : `${label}\t${target}`);
    }
  }
  return atoms;
}

function counts(values) {
  const map = new Map();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return map;
}

function difference(left, right) {
  const out = new Map();
  for (const [key, count] of left) {
    const extra = count - (right.get(key) ?? 0);
    if (extra > 0) out.set(key, extra);
  }
  return out;
}

function atomLabels(map) {
  return [...map].map(([key, count]) => {
    const [label, target] = key.split("\t");
    const named = target ? `${label} → ${target}` : label;
    return count > 1 ? `${named} ×${count}` : named;
  });
}

export function planComparison(selected, plans) {
  if (!selected?.steps?.length || !Array.isArray(plans)) return null;
  const mine = counts(planAtoms(selected));
  const index = plans.findIndex((plan) => {
    if (!plan || plan === selected || plan.id === selected.id || !plan.steps?.length) return false;
    const theirs = counts(planAtoms(plan));
    return difference(mine, theirs).size > 0 || difference(theirs, mine).size > 0;
  });
  if (index < 0) return null;
  const alternative = plans[index];
  const theirs = counts(planAtoms(alternative));
  return {
    alternative: alternative.summary ?? (alternative.steps ?? []).map((step) => step?.name ?? "?").join(", "),
    position: index + 1,
    margin: Math.round((Number(selected.score) || 0) - (Number(alternative.score) || 0)),
    chosen: atomLabels(difference(mine, theirs)),
    instead: atomLabels(difference(theirs, mine)),
  };
}
