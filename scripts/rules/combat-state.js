import { actorItems } from "../foundry-data.js";
import { slugify as normalize } from "../engine/action/text.js";
import { pf2eRuntime } from "../runtime/pf2e-runtime.js";

function itemSlug(item) {
  return normalize(
    item?.slug
      ?? item?.system?.slug?.value
      ?? item?.system?.slug
      ?? item?.name
      ?? item?.label,
  );
}

function itemText(item) {
  return [
    itemSlug(item),
    item?.name,
    item?.label,
    item?.sourceId,
    item?.system?.source?.value,
    item?.system?.source?.id,
    item?.flags?.core?.sourceId,
  ].map(normalize).filter(Boolean).join(" ");
}

function values(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  if (value instanceof Map) return Array.from(value.values());
  if (typeof value.values === "function") return Array.from(value.values());
  if (typeof value === "object") return Object.values(value);
  return [value];
}

function conditionEntries(entity) {
  const conditions = entity?.conditions;
  if (!conditions) return [];
  if (Array.isArray(conditions)) return conditions;
  const slugs = Array.isArray(conditions.slugs) ? conditions.slugs : [];
  const valued = Object.entries(conditions.values ?? {})
    .filter(([, value]) => Number(value) > 0)
    .map(([slug]) => slug);
  return [...slugs, ...valued];
}

function entityStateEntries(entity) {
  return [
    ...conditionEntries(entity),
    ...values(entity?.effects),
    ...values(entity?.actor?.effects),
    ...values(entity?.actor?.itemTypes?.effect),
    ...values(entity?.actor?.itemTypes?.condition),
    ...values(entity?.actor?.document?.itemTypes?.effect),
    ...values(entity?.actor?.document?.itemTypes?.condition),
  ];
}

function entryMatchesPatterns(entry, patterns) {
  const text = typeof entry === "string" ? normalize(entry) : itemText(entry);
  return patterns.map(normalize).some((pattern) =>
    text === pattern
      || text.includes(pattern)
      || text.includes(`effect-${pattern}`),
  );
}

function stateFlag(entity, keys) {
  const roots = [
    entity?.targetState,
    entity?.combatState,
    entity?.state,
  ];
  return keys.some((key) =>
    roots.some((root) => root?.[key] === true || root?.[normalize(key)] === true),
  );
}

const TARGET_MARK_PATTERNS = {
  "devised-stratagem": ["devised-stratagem", "devise-a-stratagem"],
  "exploited-vulnerability": [
    "exploited-vulnerability",
    "exploit-vulnerability",
    "primary-ev-target",
    "ev-target",
    "personal-antithesis",
    "mortal-weakness",
  ],
  "hunted-prey": ["hunted-prey", "hunt-prey"],
  "traced-rune": ["traced-rune", "trace-rune", "etched-rune", "rune"],
};

export function hasTargetState(target, patterns) {
  const values = Array.isArray(patterns) ? patterns : [patterns];
  return entityStateEntries(target).some((entry) => entryMatchesPatterns(entry, values));
}

export function targetHasMarkState(target, mark) {
  const normalized = normalize(mark);
  const patterns = TARGET_MARK_PATTERNS[normalized] ?? [normalized];
  return hasTargetState(target, patterns);
}

export function readTargetCombatState(target) {
  return {
    devisedStratagem: stateFlag(target, ["devisedStratagem", "devised-stratagem"])
      || targetHasMarkState(target, "devised-stratagem"),
    exploited: stateFlag(target, ["exploited", "exploitedVulnerability", "exploited-vulnerability"])
      || targetHasMarkState(target, "exploited-vulnerability"),
    huntedPrey: stateFlag(target, ["huntedPrey", "hunted-prey"])
      || targetHasMarkState(target, "hunted-prey"),
    tracedRune: stateFlag(target, ["tracedRune", "traced-rune"])
      || targetHasMarkState(target, "traced-rune"),
  };
}

function stateEntries(actor) {
  return [
    ...actorItems(actor, "condition"),
    ...actorItems(actor, "effect"),
  ];
}

function hasEntry(actor, patterns) {
  const normalizedPatterns = patterns.map(normalize);
  return stateEntries(actor).some((entry) => {
    const text = itemText(entry);
    return normalizedPatterns.some((pattern) =>
      text === pattern
        || text.includes(pattern)
        || text.includes(`effect-${pattern}`),
    );
  });
}

function hasFlagPath(actor, path, expected = true) {
  let value = actor;
  for (const key of path) value = value?.[key];
  if (expected === undefined) return value !== undefined && value !== null;
  return value === expected;
}

function flagBoolean(actor, paths) {
  for (const path of paths) {
    let value = actor;
    for (const key of path) value = value?.[key];
    if (value === true || value === false) return value;
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
}

function activeStances(actor) {
  return stateEntries(actor)
    .filter((entry) => itemText(entry).includes("stance"))
    .map((entry) => itemSlug(entry))
    .filter(Boolean);
}

function tokenMarkUuids(actor, patterns) {
  const marks = pf2eRuntime.readActor(actor).tokenMarks;
  const entries = marks instanceof Map
    ? Array.from(marks.entries())
    : marks && typeof marks === "object"
      ? Object.entries(marks)
      : [];
  return entries
    .filter(([, slugs]) => values(slugs).some((slug) => entryMatchesPatterns(slug, patterns)))
    .map(([uuid]) => String(uuid ?? "").trim())
    .filter(Boolean);
}

function targetTokenIdentityValues(target) {
  const token = target?.token ?? null;
  const document = token?.document ?? token;
  return [
    target?.tokenUuid,
    token?.uuid,
    document?.uuid,
    target?.uuid,
  ].filter(Boolean).map(String);
}

export function targetHasTokenMark(target, tokenUuids = []) {
  const marked = new Set((Array.isArray(tokenUuids) ? tokenUuids : [tokenUuids]).filter(Boolean).map(String));
  return marked.size > 0 && targetTokenIdentityValues(target).some((uuid) => marked.has(uuid));
}

export function targetIsDefeated(target) {
  const directHp = target?.hpPercent ?? target?.hp?.percent;
  if (directHp !== null && directHp !== undefined && Number.isFinite(Number(directHp)) && Number(directHp) <= 0) {
    return true;
  }
  return conditionEntries(target).some((entry) => ["dead", "destroyed"].includes(normalize(entry?.slug ?? entry)));
}

export function livingMarkedTarget(context, tokenUuids = [], mark = "") {
  const enemies = context?.enemies ?? context?.battlefield?.enemies ?? context?.targets ?? context?.battlefield?.targets ?? [];
  return enemies.find((target) =>
    !targetIsDefeated(target)
    && (targetHasTokenMark(target, tokenUuids) || (mark && targetHasMarkState(target, mark)))) ?? null;
}

export function readCombatState(actor) {
  if (!actor) return {};

  const kineticistAuraActive = hasEntry(actor, [
    "channel-elements",
    "kinetic-aura",
    "elemental-aura",
  ]) || hasFlagPath(actor, ["flags", "pf2e", "kineticist", "auraActive"]);

  const spellstrikeNeedsRecharge = hasEntry(actor, [
    "spellstrike-expended",
    "spellstrike-spent",
    "spellstrike-unavailable",
    "recharge-spellstrike",
    "spellstrike-needs-recharge",
  ]) || flagBoolean(actor, [
    ["flags", "pf2e", "magus", "spellstrikeCharged"],
    ["system", "resources", "spellstrike", "charged"],
    ["system", "resources", "spellstrike", "value"],
  ]) === false;

  const spellstrikeChargedFlag = flagBoolean(actor, [
    ["flags", "pf2e", "magus", "spellstrikeCharged"],
    ["system", "resources", "spellstrike", "charged"],
    ["system", "resources", "spellstrike", "value"],
  ]);
  const spellstrikeCharged = spellstrikeNeedsRecharge
    ? false
    : spellstrikeChargedFlag === true || hasEntry(actor, ["spellstrike-charged", "spellstrike-ready"])
      ? true
      : null;

  const exploitVulnerabilityActive = hasEntry(actor, [
    "exploit-vulnerability",
    "exploited-vulnerability",
    "personal-antithesis",
    "mortal-weakness",
  ]);

  const huntedPreyTokenUuids = tokenMarkUuids(actor, ["hunt-prey", "hunted-prey"]);
  const huntedPreyActive = huntedPreyTokenUuids.length > 0
    || hasEntry(actor, ["hunt-prey", "hunted-prey"])
    || hasFlagPath(actor, ["flags", "pf2e", "ranger", "huntPrey"], undefined);

  return {
    activeStances: [...new Set(activeStances(actor))],
    arcaneCascadeActive: hasEntry(actor, ["arcane-cascade"]),
    compositionActive: hasEntry(actor, [
      "composition",
      "courageous-anthem",
      "inspire-courage",
      "dirge-of-doom",
      "rallying-anthem",
    ]),
    curseActive: hasEntry(actor, ["cursebound", "oracular-curse", "curse"]),
    deviseStratagemActive: hasEntry(actor, ["devise-a-stratagem", "devised-stratagem"]),
    eidolonManifested: hasEntry(actor, ["manifest-eidolon", "eidolon-manifested", "eidolon"]),
    exploitVulnerabilityActive,
    huntedPreyActive,
    huntedPreyTokenUuids,
    lingeringCompositionActive: hasEntry(actor, ["lingering-composition"]),
    kineticistAuraActive,
    channelElementsActive: kineticistAuraActive,
    mutagenActive: hasEntry(actor, ["mutagen"]),
    overdriveActive: hasEntry(actor, ["overdrive"]),
    panacheActive: hasEntry(actor, ["panache"]),
    rageActive: hasEntry(actor, ["rage"]),
    smiteActive: hasEntry(actor, ["smite"]),
    spellstrikeCharged,
    spellstrikeNeedsRecharge,
    unleashPsycheActive: hasEntry(actor, ["unleash-psyche"]),
    unstableUsed: hasEntry(actor, ["unstable", "unstable-function"]),
  };
}
