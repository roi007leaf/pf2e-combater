// Quality-sweep harness: real iconic actor sources -> live-shaped combat context -> buildCandidates -> buildTurnPlans.
// The engine reads `canvas` at import time, so it is stubbed before the (dynamic) engine imports.
globalThis.canvas = { scene: { id: "scene", grid: { distance: 5, size: 100 } }, grid: { size: 100, distance: 5 }, tokens: { placeables: [] } };
export const { buildCandidates } = await import("../../engine/candidates.js");
export const { buildTurnPlans } = await import("../../engine/planner.js");
export const { readActorProfile } = await import("../../readers/actor-profile.js");
export const TP = await import("../../rules/tactic-personality.js");

// Iconic actor sources (name -> actor JSON with embedded items), see iconics.mjs.
let ICONICS = {};
export function useIconics(iconics) { ICONICS = iconics; }
const GRID = 100;
export const at = (gx, gy) => ({ x: gx * GRID + GRID / 2, y: gy * GRID + GRID / 2 });
export const slugify = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function flagDoc(type, flags, extra = {}) { return { ...extra, type, flags, getFlag: (m, k) => flags?.[m]?.[k] }; }

export function highestLevelBuilds({ skipCompanions = true } = {}) {
  const best = {};
  for (const name of Object.keys(ICONICS)) {
    const base = name.replace(/ \(Level \d+\)/, "");
    const lv = Number(name.match(/Level (\d+)/)?.[1] ?? 0);
    if (!best[base] || best[base].lv < lv) best[base] = { lv, name };
  }
  return Object.values(best).map((b) => b.name).filter((n) => {
    if (!skipCompanions) return true;
    const cls = ICONICS[n].items.find((i) => i.type === "class")?.name ?? "";
    return !/Companion/i.test(cls);
  }).sort();
}

const SKILL_ABILITY = { acrobatics: "dex", arcana: "int", athletics: "str", crafting: "int", deception: "cha", diplomacy: "cha", intimidation: "cha", medicine: "wis", nature: "wis", occultism: "int", performance: "cha", religion: "wis", society: "int", stealth: "dex", survival: "wis", thievery: "dex" };
const CASTERS = new Set(["wizard", "sorcerer", "witch", "cleric", "druid", "bard", "oracle", "psychic", "animist", "summoner"]);

function sel(v) { if (!v) return []; if (typeof v === "string") return [v]; if (v.selected) return [v.selected]; if (Array.isArray(v.value) && v.value.length === 1) return v.value; return []; }
export function abilityMods(src) {
  const boosts = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  const add = (a, n = 1) => { if (a in boosts) boosts[a] += n; };
  const anc = src.items.find((i) => i.type === "ancestry"); const bg = src.items.find((i) => i.type === "background"); const cls = src.items.find((i) => i.type === "class");
  for (const b of Object.values(anc?.system?.boosts ?? {})) { if (b.selected) add(b.selected); else if (b.value?.length === 1) add(b.value[0]); }
  for (const f of Object.values(anc?.system?.flaws ?? {})) { if (f.selected) add(f.selected, -1); else if (f.value?.length === 1) add(f.value[0], -1); }
  for (const b of Object.values(bg?.system?.boosts ?? {})) { if (b.selected) add(b.selected); else if (b.value?.length === 1) add(b.value[0]); }
  const key = sel(cls?.system?.keyAbility)[0] ?? src.system?.details?.keyability?.value;
  if (key) add(key);
  for (const list of Object.values(src.system?.build?.attributes?.boosts ?? {})) for (const a of list ?? []) add(a);
  const mods = {};
  for (const [a, n] of Object.entries(boosts)) { let m = 0; for (let i = 0; i < n; i++) m += m < 4 ? 1 : 0.5; mods[a] = Math.floor(m); }
  return { mods, key };
}

function weaponScore(w) { const d = w.system?.damage ?? {}; return (Number(d.dice) || 1) * ((Number(String(d.die ?? "d4").slice(1)) || 4) + 1) / 2 + (w.system?.runes?.striking ?? 0) * 3 + (w.system?.runes?.potency ?? 0); }
const isRangedW = (w) => Number(w.system?.range) > 0;
const traitsOf = (w) => w.system?.traits?.value ?? [];

export function readyWeapons(weapons) {
  const held = weapons.filter((w) => w.system?.equipped?.carryType === "held");
  if (held.length) return new Set(held.map((w) => w._id));
  const pick = (list) => list.toSorted((a, b) => weaponScore(b) - weaponScore(a))[0];
  const melee = pick(weapons.filter((w) => !isRangedW(w)));
  const ranged = pick(weapons.filter((w) => isRangedW(w) && !(traitsOf(w).includes("thrown") && !isRangedW(w))));
  return new Set([melee?._id, ranged?._id].filter(Boolean));
}

export function buildActorDoc(src, { role = "auto", hpFraction = 1, conditions = [] } = {}) {
  const level = src.system?.details?.level?.value ?? 1;
  const { mods, key } = abilityMods(src);
  const cls = src.items.find((i) => i.type === "class");
  const anc = src.items.find((i) => i.type === "ancestry");
  const clsSlug = slugify(cls?.system?.slug ?? cls?.name);
  const items = src.items.map((i) => ({ ...structuredClone(i), id: i._id, slug: i.system?.slug ?? slugify(i.name) }));
  // condition items
  for (const c of conditions) items.push({ _id: `cond-${c.slug}`, id: `cond-${c.slug}`, type: "condition", name: c.slug, slug: c.slug, system: { slug: c.slug, value: { value: c.value ?? null } } });
  const itemTypes = {};
  for (const it of items) (itemTypes[it.type] ??= []).push(it);
  // spellcasting entries: give slot values (remaining) and DC
  for (const e of itemTypes.spellcastingEntry ?? []) {
    for (const s of Object.values(e.system?.slots ?? {})) {
      const n = s.max ?? s.prepared?.length ?? 0;
      s.max = n; if (s.value === undefined) s.value = n;
    }
    const abil = e.system?.ability?.value ?? key ?? "cha";
    const dc = 10 + level + 2 + (level >= 7 && CASTERS.has(clsSlug) ? 2 : 0) + (mods[abil] ?? 3);
    e.system.spelldc = { ...(e.system.spelldc ?? {}), dc, value: dc - 10 };
    e.statistic = { dc: { value: dc }, mod: dc - 10 };
  }
  // strikes
  const weapons = (itemTypes.weapon ?? []);
  const ready = readyWeapons(weapons);
  const attacks = cls?.system?.attacks ?? {};
  const martialBump = level >= 5 && !CASTERS.has(clsSlug) ? 1 : 0;
  const prof = (cat) => { const r = Number(attacks[cat] ?? (cat === "advanced" ? 0 : 1)); return r > 0 ? level + 2 * (r + martialBump) : 0; };
  const spec = level >= 7 && !CASTERS.has(clsSlug) ? 2 : 0;
  const mkStrike = (w, isReady) => {
    const tr = traitsOf(w);
    const ranged = isRangedW(w);
    const finesse = tr.includes("finesse");
    const abil = ranged ? mods.dex : (finesse ? Math.max(mods.str, mods.dex) : mods.str);
    const cat = w.system?.category ?? "simple";
    const pot = Number(w.system?.runes?.potency ?? 0);
    const total = prof(cat) + abil + pot;
    const agile = tr.includes("agile");
    const dmgMod = ranged ? (tr.includes("propulsive") ? Math.floor(Math.max(0, mods.str) / 2) : (tr.some((t) => t.startsWith("thrown")) ? mods.str : 0)) : mods.str;
    const item = structuredClone(w);
    item.id = w._id; item.slug = w.system?.slug ?? slugify(w.name); item.isRanged = ranged; item.isMelee = !ranged;
    item.system.damage = { ...(item.system.damage ?? {}), dice: (Number(item.system.damage?.dice) || 1) + Number(w.system?.runes?.striking ?? 0), modifier: dmgMod + spec };
    if (item.system.reload && !item.system.reload.value) delete item.system.reload;
    return {
      type: "strike", slug: item.slug, label: w.name, item, ready: isReady, visible: true, canAttack: true,
      totalModifier: total,
      variants: [0, agile ? 4 : 5, agile ? 8 : 10].map((m) => ({ label: `${total - m >= 0 ? "+" : ""}${total - m}` })),
      traits: tr.map((t) => ({ name: t })), weaponTraits: [],
    };
  };
  const strikes = weapons.map((w) => mkStrike(w, ready.has(w._id)));
  const monk = clsSlug === "monk";
  const fist = { _id: "fist", name: "Fist", type: "weapon", system: { slug: "fist", category: "unarmed", group: "brawling", damage: { dice: 1, die: monk ? "d6" : "d4", damageType: "bludgeoning" }, traits: { value: ["agile", "finesse", "nonlethal", "unarmed"] }, runes: { potency: 0, striking: 0 }, equipped: { carryType: "held", handsHeld: 0 } } };
  strikes.unshift(mkStrike(fist, true));
  // skills / hp / speed
  const skills = {};
  for (const [s, v] of Object.entries(src.system?.skills ?? {})) {
    const rank = Number(v?.rank ?? 0); const ab = mods[SKILL_ABILITY[s]] ?? 0;
    skills[s] = { rank, mod: (rank > 0 ? level + 2 * rank : 0) + ab, totalModifier: (rank > 0 ? level + 2 * rank : 0) + ab };
  }
  const hpMax = Number(anc?.system?.hp ?? 8) + (Number(cls?.system?.hp ?? 8) + mods.con) * level;
  const flags = { "pf2e-combater": { tacticPersonality: { role, temperament: "auto" } } };
  if (clsSlug === "kineticist") flags.pf2e = { kineticist: { elementalBlast: { fire: { element: "fire", dieFaces: 6, damageTypes: ["fire"], range: 30 } } } };
  const system = structuredClone(src.system);
  system.actions = strikes;
  system.skills = skills;
  system.abilities = Object.fromEntries(Object.entries(mods).map(([k, m]) => [k, { mod: m }]));
  system.attributes = { ...system.attributes, hp: { value: Math.max(0, Math.round(hpMax * hpFraction)), max: hpMax, temp: 0 }, speed: { value: Number(anc?.system?.speed ?? 25) }, ac: { value: 10 + level + 4 + 3 } };
  system.perception = { mod: level + 2 + mods.wis, rank: 1 };
  system.resources = { ...system.resources, focus: { value: Math.max(1, system.resources?.focus?.value ?? 1), max: Math.max(1, system.resources?.focus?.max ?? system.resources?.focus?.value ?? 1) } };
  system.details = { ...system.details, level: { value: level } };
  const doc = flagDoc("character", flags, {
    ...src, id: src._id, uuid: `Actor.${src._id}`, name: src.name, items, itemTypes, system, level,
    spellcasting: itemTypes.spellcastingEntry ?? [],
  });
  return { doc, level, mods, clsSlug, hpMax };
}

// level-appropriate moderate creature (GM Core-ish "high" AC, moderate saves/hp)
const AC = { 1: 16, 2: 18, 3: 19, 4: 21, 5: 22, 6: 24, 7: 25, 8: 27 };
const SAVE = { 1: 7, 2: 8, 3: 9, 4: 11, 5: 12, 6: 14, 7: 15, 8: 16 };
const HP = { 1: 20, 2: 30, 3: 45, 4: 60, 5: 75, 6: 95, 7: 115, 8: 135 };
export function enemyEntry(id, { level = 5, gx = 1, gy = 0, origin = at(0, 0), hpPercent = 1, conditions = { slugs: [], values: {} }, extra = {} } = {}) {
  const center = at(gx, gy);
  const dx = Math.abs(gx - Math.round((origin.x - 50) / 100)); const dy = Math.abs(gy - Math.round((origin.y - 50) / 100));
  const feet = (Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2)) * 5;
  const L = Math.max(1, Math.min(8, level));
  const doc = { id, name: id, type: "npc", itemTypes: {}, items: [], system: { details: { level: { value: level } }, attributes: { hp: { value: Math.round(HP[L] * hpPercent), max: HP[L] }, ac: { value: AC[L] } }, saves: { fortitude: { dc: 10 + SAVE[L] + 2 }, reflex: { dc: 10 + SAVE[L] }, will: { dc: 10 + SAVE[L] - 1 } }, traits: { value: ["humanoid"] } } };
  return {
    id, name: id, disposition: -1,
    actor: { id, name: id, type: "npc", document: doc },
    token: { id: `${id}-tok`, name: id, disposition: -1, center, width: 1, height: 1 },
    distance: feet, meleeReach: 5, traits: ["humanoid"], attackTargetable: true, hpPercent, level,
    conditions, effects: [], ac: AC[L], saves: { fortitude: 10 + SAVE[L] + 2, reflex: 10 + SAVE[L], will: 10 + SAVE[L] - 1 },
    perception: { dc: 10 + SAVE[L], mod: SAVE[L] }, perceptionDC: 10 + SAVE[L], resistances: [], weaknesses: [], immunities: [],
    ...extra,
  };
}
export function allyEntry(id, { gx = 0, gy = 2, hpPercent = 1, conditions = { slugs: [], values: {} }, level = 5 } = {}) {
  const dx = Math.abs(gx), dy = Math.abs(gy);
  const feet = (Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2)) * 5;
  const doc = { id, name: id, type: "character", itemTypes: {}, items: [], system: { details: { level: { value: level } }, attributes: { hp: { value: Math.round(60 * hpPercent), max: 60 } } } };
  return { id, name: id, disposition: 1, actor: { id, name: id, type: "character", document: doc }, token: { id: `${id}-tok`, name: id, disposition: 1, center: at(gx, gy), width: 1, height: 1 }, distance: feet, hpPercent, conditions, effects: [], traits: ["humanoid"], attackTargetable: true, level };
}

export const SITUATIONS = {
  "adjacent": (L) => ({ enemies: [enemyEntry("Foe", { level: L, gx: 1, gy: 0 })] }),
  "enemy-15ft": (L) => ({ enemies: [enemyEntry("Foe", { level: L, gx: 3, gy: 0 })] }),
  "enemy-40ft": (L) => ({ enemies: [enemyEntry("Foe", { level: L, gx: 8, gy: 0 })] }),
  "enemy-80ft": (L) => ({ enemies: [enemyEntry("Foe", { level: L, gx: 16, gy: 0 })] }),
  "cluster3-25ft": (L) => ({ enemies: [enemyEntry("FoeA", { level: L - 1, gx: 5, gy: 0 }), enemyEntry("FoeB", { level: L - 1, gx: 5, gy: 1 }), enemyEntry("FoeC", { level: L - 1, gx: 6, gy: 0 })] }),
  "ally-dying": (L) => ({ enemies: [enemyEntry("Foe", { level: L, gx: 6, gy: 0 })], allies: [allyEntry("Dying Ally", { gx: 0, gy: 2, hpPercent: 0, conditions: { slugs: ["dying", "unconscious", "prone"], values: { dying: 1 } }, level: L })] }),
  "ally-40pct-25ft": (L) => ({ enemies: [enemyEntry("Foe", { level: L, gx: 3, gy: 0 })], allies: [allyEntry("Hurt Ally", { gx: 0, gy: 5, hpPercent: 0.4, level: L })] }),
  "self-25pct-adjacent": (L) => ({ enemies: [enemyEntry("Foe", { level: L, gx: 1, gy: 0 })], hpFraction: 0.25 }),
  "self-prone-adjacent": (L) => ({ enemies: [enemyEntry("Foe", { level: L, gx: 1, gy: 0 })], conditions: [{ slug: "prone" }] }),
  "target-fright2-prone": (L) => ({ enemies: [enemyEntry("Foe", { level: L, gx: 1, gy: 0, conditions: { slugs: ["frightened", "prone", "off-guard"], values: { frightened: 2 } } })] }),
  "hidden-target": (L) => ({ enemies: [enemyEntry("Foe", { level: L, gx: 3, gy: 0, conditions: { slugs: ["hidden"], values: {} }, extra: { visionerDetectionState: "hidden" } })] }),
};

const DEFAULT_ALLY = (L) => allyEntry("Ally", { gx: -1, gy: 1, level: L });

export function buildContext(name, situation, role = "auto", { mutate = null } = {}) {
  let src = ICONICS[name];
  if (mutate) { src = structuredClone(src); mutate(src); }
  const L = src.system?.details?.level?.value ?? 1;
  const sit = SITUATIONS[situation](L);
  const { doc, level, clsSlug, hpMax } = buildActorDoc(src, { role, hpFraction: sit.hpFraction ?? 1, conditions: sit.conditions ?? [] });
  const profile = readActorProfile(doc);
  const allies = [...(sit.allies ?? []), DEFAULT_ALLY(L)];
  const enemies = sit.enemies;
  const nearest = [...enemies].sort((a, b) => a.distance - b.distance);
  return {
    refreshSource: "manual", isGM: false,
    combat: { id: "combat", round: 1, turn: 0, started: true },
    combatant: { id: "cmb", name: src.name, actor: doc },
    actor: { id: doc.id, uuid: doc.uuid, name: src.name, type: "character", document: doc, profile },
    token: { id: "self-tok", name: src.name, disposition: 1, center: at(0, 0), width: 1, height: 1, document: flagDoc("character", {}, { id: "self-tok", x: 0, y: 0, width: 1, height: 1 }) },
    actionsSpent: { movement: 0, normal: 0, total: 0 },
    battlefield: { allies, enemies, targets: nearest.slice(0, 1) },
    minions: [], summons: [],
    _meta: { name, situation, role, level, clsSlug, hpMax },
  };
}

export function runPipeline(context) {
  const t0 = performance.now();
  const build = buildCandidates(context);
  const t1 = performance.now();
  const plans = buildTurnPlans(context, build.candidates, { includeCoverage: false, approachCandidates: build.approachable });
  const t2 = performance.now();
  return { build, plans, candMs: t1 - t0, planMs: t2 - t1 };
}

export function fmtStep(s) {
  const tgt = s.suggestedTarget?.name ?? s.preferredTarget?.name;
  return `${s.name}${tgt ? "@" + tgt : ""}[${s.actionCost}]{${Math.round(s.score)}${s.mapPenalty ? " MAP" + s.mapPenalty : ""}}`;
}
export function fmtPlan(p) { return `${Math.round(p.score)} :: ${p.steps.map(fmtStep).join(" -> ")} (cost ${p.totalCost}, tactic ${p.tactic?.scoreDelta ?? 0})`; }
