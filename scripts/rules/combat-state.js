function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Map) return Array.from(collection.values());
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection === "object") return Object.values(collection);
  return [];
}

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

function actorItems(actor, type) {
  const typed = collectionValues(actor?.itemTypes?.[type]);
  const typedIds = new Set(typed.map((item) => item?.id ?? item?._id).filter(Boolean));
  const fallback = collectionValues(actor?.items)
    .filter((item) => item?.type === type)
    .filter((item) => !typedIds.has(item?.id ?? item?._id));
  return [...typed, ...fallback];
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

  const huntedPreyActive = hasEntry(actor, ["hunt-prey", "hunted-prey"])
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
