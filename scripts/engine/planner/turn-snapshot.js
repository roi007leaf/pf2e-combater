// Turns a live Auto-fill turn into a planner quality-lab scenario: the planning context and scored
// candidates as plain JSON (no Foundry documents, PIXI objects or functions), plus what the GM says
// the right answer was. Recorded turns load into the lab, so every "why did it do that?" becomes a
// permanent regression test.

export const RECORDED_TURN_VERSION = 1;
export const RECORDED_TURNS_DIR = "modules/pf2e-combater/tests/recorded-turns";

const MAX_DEPTH = 8;
// Back-references and render state that are large, circular, or meaningless outside Foundry.
const SKIPPED_KEYS = new Set([
  "parent", "collection", "_source", "apps", "_sheet", "sheet", "layer", "mesh", "children",
  "texture", "scene", "_object", "object", "combat", "combatant", "_events", "_stats", "ownership",
  "compendium", "pack", "overlay", "controlIcon", "border", "_preview",
]);

function isPlainNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isDocument(value) {
  return Boolean(value && typeof value === "object" && typeof value.documentName === "string" && "id" in value);
}

function documentSummary(document, depth, seen) {
  const summary = {
    id: document.id ?? null,
    uuid: document.uuid ?? null,
    name: document.name ?? null,
    type: document.type ?? null,
    img: document.img ?? null,
    documentName: document.documentName,
    flags: snapshotValue(document.flags ?? {}, depth + 1, seen),
  };
  if (document.documentName === "Item") {
    const system = document.system ?? {};
    summary.system = snapshotValue({
      damage: system.damage,
      traits: system.traits,
      range: system.range,
      category: system.category,
      usage: system.usage,
      bonus: system.bonus,
      reload: system.reload,
    }, depth + 1, seen);
    summary.isRanged = typeof document.isRanged === "boolean" ? document.isRanged : undefined;
  }
  if (document.documentName === "Actor") {
    summary.level = isPlainNumber(Number(document.level)) ? Number(document.level) : null;
  }
  return summary;
}

export function snapshotValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object") return value;
  if (depth > MAX_DEPTH || seen.has(value)) return undefined;
  seen.add(value);
  if (isDocument(value)) return documentSummary(value, depth, seen);
  if (value instanceof Map) return snapshotValue(Object.fromEntries(value), depth + 1, seen);
  if (value instanceof Set) return snapshotValue([...value], depth + 1, seen);
  if (Array.isArray(value)) {
    return value.map((entry) => snapshotValue(entry, depth + 1, seen)).filter((entry) => entry !== undefined);
  }
  // A placeable Token: keep identity and geometry, not the render tree.
  if (value.document && isDocument(value.document) && value.center) {
    return {
      id: value.id ?? value.document.id ?? null,
      name: value.name ?? value.document.name ?? null,
      center: { x: Number(value.center.x), y: Number(value.center.y) },
      w: isPlainNumber(value.w) ? value.w : undefined,
      h: isPlainNumber(value.h) ? value.h : undefined,
      document: documentSummary(value.document, depth, seen),
    };
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SKIPPED_KEYS.has(key)) continue;
    const snapped = snapshotValue(entry, depth + 1, seen);
    if (snapped !== undefined) result[key] = snapped;
  }
  return result;
}

function planReferences(plan) {
  return (plan?.steps ?? []).map((step) => String(step?.id ?? step?.slug ?? step?.name ?? "")).filter(Boolean);
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "turn";
}

// verdict: { kind: "correct", planIndex } -- that Auto-fill plan should rank first;
//          { kind: "wrong" } -- the current top plan must not rank first.
export function buildRecordedTurn({ context, candidates, approachCandidates = [], plans, verdict, note = "", recordedAt = new Date().toISOString() }) {
  const actorName = context?.actor?.name ?? "Actor";
  const top = plans?.[0] ?? null;
  const chosen = verdict?.kind === "correct" ? plans?.[Number(verdict.planIndex) || 0] ?? top : null;
  const expect = verdict?.kind === "correct"
    ? { rankedPlans: [{ rank: 1, sequence: planReferences(chosen), totalCost: Number(chosen?.totalCost) || undefined }] }
    : { forbiddenInTop: [{ n: 1, sequence: planReferences(top) }] };
  const stamp = recordedAt.replace(/[^0-9]/g, "").slice(0, 14);
  return {
    version: RECORDED_TURN_VERSION,
    id: `recorded-${slug(actorName)}-${stamp}`,
    name: note ? `${actorName}: ${note}` : `${actorName}: recorded turn`,
    recordedAt,
    note,
    verdict: verdict?.kind ?? "correct",
    recordedPlans: (plans ?? []).slice(0, 5).map((plan) => ({ summary: plan?.summary ?? "", score: plan?.score ?? null, sequence: planReferences(plan) })),
    context: snapshotValue(context),
    candidates: snapshotValue(candidates ?? []),
    approachCandidates: snapshotValue(approachCandidates ?? []),
    expect,
  };
}

export function recordedTurnFileName(turn) {
  return `${turn.id}.json`;
}
