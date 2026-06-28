// Localization helper. Keys live under the PF2E_COMBATER namespace in lang/<lang>.json.
//
// `t(key, fallback, data)` returns the localized string when Foundry's i18n is available and knows
// the key, otherwise the English `fallback`. Keeping the English text at every call site means the
// module still reads correctly before i18n loads and lets the headless self-test assert real text.
// Both Foundry's format() and the fallback use {placeholder} interpolation.

const NAMESPACE = "PF2E_COMBATER";

function interpolate(template, data) {
  if (!data) return String(template);
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    (data[name] === undefined || data[name] === null ? match : String(data[name])));
}

export function t(key, fallback, data = null) {
  const i18n = globalThis.game?.i18n;
  const fullKey = `${NAMESPACE}.${key}`;
  if (i18n && typeof i18n.has === "function" && i18n.has(fullKey)) {
    if (data && typeof i18n.format === "function") return i18n.format(fullKey, data);
    if (typeof i18n.localize === "function") return i18n.localize(fullKey);
  }
  return interpolate(fallback, data);
}

// The "PF2E_COMBATER.<key>" string for places Foundry localizes itself (template {{localize}},
// setting name/hint). Returns the namespaced key; the value must exist in the lang file.
export function locKey(key) {
  return `${NAMESPACE}.${key}`;
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pascalCase(value) {
  return String(value ?? "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

// Resolve a basic-action name from the PF2e system's own localization (PF2E.Actions.<Name>.Title) so
// it matches the system and its translations. Actions with no standalone system entry (e.g. retch,
// stabilize) fall back to the English name supplied at the call site.
export function pf2eActionName(slug, fallback) {
  const i18n = globalThis.game?.i18n;
  const key = `PF2E.Actions.${pascalCase(slug)}.Title`;
  if (i18n && typeof i18n.has === "function" && i18n.has(key) && typeof i18n.localize === "function") {
    return i18n.localize(key);
  }
  return fallback ?? titleCase(slug);
}

// Resolve a PF2e proper noun (trait/save/condition/area name) from the PF2e system's OWN
// localization so it matches the system and its translations, falling back to a title-cased slug
// when CONFIG.PF2E / i18n aren't available (pre-init, headless tests). CONFIG.PF2E maps hold either
// i18n keys or already-localized strings depending on version, so localize() handles both.
function pf2eTerm(maps, slug, fallback) {
  const key = String(slug ?? "").trim();
  if (!key) return fallback ?? "";
  const i18n = globalThis.game?.i18n;
  const cfg = globalThis.CONFIG?.PF2E ?? {};
  for (const mapName of maps) {
    const value = cfg?.[mapName]?.[key.toLowerCase()] ?? cfg?.[mapName]?.[key];
    if (value && typeof i18n?.localize === "function") {
      const localized = i18n.localize(value);
      if (localized && localized !== value) return localized;
      if (typeof value === "string" && !value.includes(".")) return value;
    }
  }
  return fallback ?? titleCase(key);
}

export function pf2eTrait(slug, fallback) {
  return pf2eTerm(["actionTraits", "weaponTraits", "spellTraits", "featTraits", "npcAttackTraits"], slug, fallback);
}

export function pf2eSave(slug, fallback) {
  return pf2eTerm(["saves"], slug, fallback);
}

export function pf2eCondition(slug, fallback) {
  return pf2eTerm(["conditionTypes"], slug, fallback);
}

export function pf2eAreaType(slug, fallback) {
  return pf2eTerm(["areaTypes"], slug, fallback);
}
