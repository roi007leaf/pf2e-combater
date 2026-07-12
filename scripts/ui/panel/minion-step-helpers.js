import { t } from "../../i18n.js";

// Shared by draft-workflow.js and view-model.js, which both need to name/key/dedupe minion
// substeps and movement options identically -- previously two byte-identical copies of each
// function lived in each file.

export function normalizeMinionStepKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function titleCaseSlug(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function minionStepName(value) {
  const direct = typeof value === "object" && value !== null
    ? value.name ?? value.label ?? value.title
    : value;
  const name = String(direct ?? "").trim();
  if (name) return name;
  const slug = typeof value === "object" && value !== null
    ? value.slug ?? value.key ?? value.action
    : "";
  return titleCaseSlug(slug) || t("Panel.UnknownAction", "Unknown action");
}

export function minionStepKey(value, fallbackName = "") {
  const raw = typeof value === "object" && value !== null
    ? value.slug ?? value.key ?? value.action ?? value.name ?? value.label ?? value.title
    : value;
  return normalizeMinionStepKey(raw) || normalizeMinionStepKey(fallbackName);
}

export function uniqueMinionStepNames(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const name = minionStepName(value);
    const key = minionStepKey(value, name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

export function normalizeMovementOptions(options) {
  const seen = new Set();
  const result = [];
  for (const option of Array.isArray(options) ? options : []) {
    const action = String(option?.action ?? "").trim().toLowerCase();
    if (!action || seen.has(action)) continue;
    seen.add(action);
    const speed = Number(option?.speed);
    result.push({ action, speed: Number.isFinite(speed) ? speed : 0 });
  }
  return result;
}

export function mergeMovementOptions(...optionLists) {
  const merged = [];
  const seen = new Set();
  for (const option of optionLists.flat()) {
    const action = String(option?.action ?? "").trim().toLowerCase();
    if (!action || seen.has(action)) continue;
    seen.add(action);
    merged.push(option);
  }
  return merged;
}
