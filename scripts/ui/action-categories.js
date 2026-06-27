const CATEGORY_ORDER = [
  { id: "situational", label: "Situational" },
  { id: "attacks", label: "Attacks" },
  { id: "movement", label: "Movement" },
  { id: "defense", label: "Defense" },
  { id: "skills", label: "Skills" },
  { id: "spells", label: "Spells" },
  { id: "support", label: "Support" },
  { id: "items", label: "Items" },
  { id: "class", label: "Class Actions" },
  { id: "utility", label: "Utility" },
  { id: "other", label: "Other" },
];

const CATEGORY_BY_ID = new Map(CATEGORY_ORDER.map((category) => [category.id, category]));
const MOVEMENT_SLUGS = new Set(["stride", "step", "crawl", "tumble-through", "balance", "climb", "swim", "high-jump", "long-jump"]);
const DEFENSE_SLUGS = new Set(["raise-a-shield", "take-cover", "shield", "defend", "parry"]);
const UTILITY_SLUGS = new Set(["interact", "seek", "sense-motive", "recall-knowledge", "administer-first-aid", "aid"]);
const ATTACK_ROLES = new Set(["attack", "attacks", "damage", "offense", "offensive", "blast"]);
const DEFENSE_ROLES = new Set(["defense", "defensive", "protection", "protect", "cover"]);
const SUPPORT_ROLES = new Set(["support", "healing", "heal", "buff", "setup"]);
const UTILITY_ROLES = new Set(["utility", "detection", "exploration", "knowledge"]);
const CLASS_SOURCES = new Set(["custom-curated", "custom-unknown", "system-inferred"]);
// Self-condition gates that make an action only relevant while the actor carries that condition
// (Stand/Crawl for prone, Retch for sickened, Escape for grabbed/restrained).
const SITUATIONAL_REQUIRES = ["requiresProne", "requiresSickened", "requiresGrabbedOrRestrained"];

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function actionSlugs(action) {
  return [
    action?.slug,
    action?.id,
    action?.key,
    action?.baseKey,
    action?.actionKey,
    action?.item?.slug,
    action?.item?.system?.slug,
    action?.name,
  ].map(normalize).filter(Boolean);
}

function actionTraits(action) {
  const values = [
    ...(Array.isArray(action?.traits) ? action.traits : []),
    ...(Array.isArray(action?.item?.system?.traits?.value) ? action.item.system.traits.value : []),
  ];
  return new Set(values.map((trait) => normalize(trait?.slug ?? trait?.name ?? trait)).filter(Boolean));
}

function actionIncludes(action) {
  return new Set(
    (Array.isArray(action?.activityProfile?.includes) ? action.activityProfile.includes : [])
      .map(normalize)
      .filter(Boolean),
  );
}

function categoryMeta(id) {
  return CATEGORY_BY_ID.get(id) ?? CATEGORY_BY_ID.get("other");
}

// Situational = a self-remedy gated by a condition the actor currently has (Stand, Crawl, Retch,
// Escape). Composite move-and-strikes that merely Stand first stay under Attacks, and spells keep
// their own category, so both are excluded here.
function isSituationalAction(action, profile, source, includesStrike) {
  if (includesStrike || source.startsWith("spell")) return false;
  if (profile.removesCondition || profile.reducesCondition) return true;
  return SITUATIONAL_REQUIRES.some((flag) => action?.[flag] === true);
}

export function builderActionCategory(action) {
  const source = normalize(action?.source);
  const role = normalize(action?.role);
  const itemType = normalize(action?.item?.type);
  const itemCategory = normalize(action?.category ?? action?.item?.system?.category);
  const slugs = new Set(actionSlugs(action));
  const traits = actionTraits(action);
  const includes = actionIncludes(action);
  const profile = action?.activityProfile ?? {};
  const includesStrike = profile.includesStrike === true || includes.has("strike") || source === "strike";

  if (isSituationalAction(action, profile, source, includesStrike)) return categoryMeta("situational");
  if (source.startsWith("spell") || itemType === "spell" || profile.spell === true) return categoryMeta("spells");
  if (source === "strike" || action?.attackTrait === true || action?.damageProfile || ATTACK_ROLES.has(role) || traits.has("attack")) return categoryMeta("attacks");
  if (action?.requiresDestination === true || role === "mobility" || [...slugs].some((slug) => MOVEMENT_SLUGS.has(slug)) || includes.has("move") || includes.has("stride")) return categoryMeta("movement");
  if (DEFENSE_ROLES.has(role) || itemCategory === "defensive" || [...slugs].some((slug) => DEFENSE_SLUGS.has(slug))) return categoryMeta("defense");
  if (action?.skill || action?.statistic || action?.targetSave || action?.targetDefense) return categoryMeta("skills");
  if (itemType === "consumable" || itemType === "equipment" || itemCategory === "potion" || itemCategory === "consumable") return categoryMeta("items");
  if (itemCategory === "classfeature" || itemCategory === "class-feature" || CLASS_SOURCES.has(source)) return categoryMeta("class");
  if (SUPPORT_ROLES.has(role)) return categoryMeta("support");
  if (UTILITY_ROLES.has(role) || [...slugs].some((slug) => UTILITY_SLUGS.has(slug))) return categoryMeta("utility");
  return categoryMeta("other");
}

export function groupActionsByBuilderCategory(actions) {
  const buckets = new Map(CATEGORY_ORDER.map((category) => [category.id, []]));
  for (const action of Array.isArray(actions) ? actions : []) {
    const category = builderActionCategory(action);
    // Situational actions are condition-gated: surface one only when its triggering condition is
    // currently met. `available === false` on these means the condition is absent (not prone, not
    // sickened, not grabbed). A condition-met action that is merely over budget stays available, so
    // Stand/Crawl still show while prone even with no actions left.
    if (category.id === "situational" && action?.available === false) continue;
    buckets.get(category.id)?.push(action);
  }
  return CATEGORY_ORDER
    .map((category) => {
      const categoryActions = buckets.get(category.id) ?? [];
      return {
        id: category.id,
        label: category.label,
        actions: categoryActions,
        count: categoryActions.length,
        countLabel: String(categoryActions.length),
      };
    })
    .filter((section) => section.actions.length > 0);
}
