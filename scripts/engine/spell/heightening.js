import { systemValue } from "../../foundry-data.js";

function clonePlain(value) {
  if (value === undefined || value === null) return value;
  if (globalThis.foundry?.utils?.deepClone) return globalThis.foundry.utils.deepClone(value);
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function mergePlain(base, overlay) {
  if (!base || typeof base !== "object" || Array.isArray(base)) return clonePlain(overlay);
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return clonePlain(overlay);

  const merged = clonePlain(base);
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] = mergePlain(merged[key], value);
  }
  return merged;
}

export function spellBaseRank(spell) {
  const rank = Number(spell?.rank ?? spell?.system?.level?.value ?? spell?.system?.rank?.value);
  return Number.isFinite(rank) ? rank : null;
}

function setSpellRank(system, rank) {
  if (!Number.isFinite(rank)) return;
  if (system.level && typeof system.level === "object") system.level.value = rank;
  else system.level = { value: rank };
  if (system.rank && typeof system.rank === "object") system.rank.value = rank;
}

function simpleDice(formula) {
  const match = String(formula ?? "").trim().match(/^(\d+)d(\d+)$/i);
  if (!match) return null;
  return { count: Number(match[1]), faces: Number(match[2]) };
}

function combinedFormula(baseFormula, incrementFormula, steps) {
  const base = String(baseFormula ?? "").trim();
  const increment = String(incrementFormula ?? "").trim();
  if (!base || !increment || steps <= 0) return base || increment || null;

  const baseDice = simpleDice(base);
  const incrementDice = simpleDice(increment);
  if (baseDice && incrementDice && baseDice.faces === incrementDice.faces) {
    return `${baseDice.count + incrementDice.count * steps}d${baseDice.faces}`;
  }

  return [base, ...Array.from({ length: steps }, () => increment)]
    .filter(Boolean)
    .map((part) => `(${part})`)
    .join(" + ");
}

function damageIncrementFormula(entry) {
  if (entry && typeof entry === "object") return String(entry.formula ?? entry.value ?? "").trim();
  return String(entry ?? "").trim();
}

function applyIntervalDamage(system, damageHeightening, steps) {
  if (!damageHeightening || typeof damageHeightening !== "object" || steps <= 0) return;
  const damage = system.damage && typeof system.damage === "object" ? clonePlain(system.damage) : {};

  for (const [key, incrementEntry] of Object.entries(damageHeightening)) {
    const baseEntry = damage[key] && typeof damage[key] === "object" ? damage[key] : {};
    const nextFormula = combinedFormula(
      baseEntry.formula ?? baseEntry.value,
      damageIncrementFormula(incrementEntry),
      steps,
    );
    damage[key] = {
      ...baseEntry,
      ...(incrementEntry && typeof incrementEntry === "object" ? clonePlain(incrementEntry) : {}),
      formula: nextFormula,
    };
  }

  system.damage = damage;
}

function numeric(value) {
  const number = Number(systemValue(value));
  return Number.isFinite(number) ? number : null;
}

function applyIntervalArea(system, areaHeightening, steps) {
  const increment = numeric(areaHeightening);
  if (!Number.isFinite(increment) || increment === 0 || steps <= 0) return;

  const area = system.area && typeof system.area === "object" ? clonePlain(system.area) : {};
  const base = numeric(area.value ?? area.radius ?? area.distance);
  if (!Number.isFinite(base)) return;

  if ("value" in area || !("radius" in area) && !("distance" in area)) area.value = base + increment * steps;
  else if ("radius" in area) area.radius = base + increment * steps;
  else area.distance = base + increment * steps;
  system.area = area;
}

function fixedOverlayForRank(levels, castRank) {
  if (!levels || typeof levels !== "object" || !Number.isFinite(castRank)) return null;
  return Object.entries(levels)
    .map(([rank, overlay]) => ({ rank: Number(rank), overlay }))
    .filter((entry) => Number.isFinite(entry.rank) && entry.rank <= castRank)
    .toSorted((left, right) => right.rank - left.rank)[0]?.overlay ?? null;
}

function applyFixedOverlay(system, overlay) {
  if (!overlay || typeof overlay !== "object") return;
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "heightening") continue;
    system[key] = mergePlain(system[key], value);
  }
}

function applyIntervalHeightening(system, heightening, baseRank, castRank) {
  const interval = Number(heightening?.interval ?? 1);
  if (!Number.isFinite(interval) || interval <= 0) return;

  const steps = Math.floor((castRank - baseRank) / interval);
  if (steps <= 0) return;

  applyIntervalArea(system, heightening.area, steps);
  applyIntervalDamage(system, heightening.damage, steps);
}

export function heightenedSpellForRank(spell, castRank) {
  const baseRank = spellBaseRank(spell);
  const rank = Number(castRank);
  if (!Number.isFinite(rank) || !Number.isFinite(baseRank) || rank <= baseRank) return spell;

  const system = clonePlain(spell?.system ?? {});
  const heightening = system.heightening ?? {};
  const fixedOverlay = fixedOverlayForRank(heightening.levels, rank);
  if (fixedOverlay) applyFixedOverlay(system, fixedOverlay);
  else applyIntervalHeightening(system, heightening, baseRank, rank);
  setSpellRank(system, rank);

  return {
    ...spell,
    rank,
    system,
    heightenedFromRank: baseRank,
    castRank: rank,
  };
}

export function spellNameForRank(name, baseRank, castRank) {
  if (!Number.isFinite(baseRank) || !Number.isFinite(castRank) || castRank <= baseRank) return name;
  return `${name} (Rank ${castRank})`;
}
