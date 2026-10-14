// Automatic judges for the quality sweep. Each judge looks at one ranked plan and returns
// { judge, rank, msg } flags. GATED judges must stay at zero on the top-1 plan; the rest are
// heuristics worth eyeballing but noisy by design (role preference, MAP trade-offs...).
import { actionCategories } from "../../rules/tactic-personality.js";

export const GATED_JUDGES = Object.freeze([
  "crash", "slow-planning", "orphan-draw", "thrown-twice-no-draw", "flourish-twice", "attack-out-of-reach", "over-budget",
]);
export const SLOW_PLANNING_MS = 300;

const ROLE_PREFER = {
  "melee-striker": ["melee", "mobilityAttack"], "ranged-striker": ["ranged"], "spell-damage": ["areaDamage", "rangedSpell", "meleeSpell"],
  healer: ["healing"], buffer: ["buff"], debuffer: ["debuff"], defender: ["defense"], support: ["support", "debuff"], skirmisher: ["mobility", "mobilityAttack"],
};

const slugOf = (s) => String(s?.slug ?? s?.id ?? "").toLowerCase();
const nameSlug = (s) => String(s?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
const traitsOf = (s) => (Array.isArray(s?.traits) ? s.traits : []).map((t) => String(t?.name ?? t?.slug ?? t).toLowerCase()).concat((s?.item?.system?.traits?.value ?? []).map((t) => String(t).toLowerCase()));
const isMove = (s) => /(^|-)(stride|step|tumble-through|crawl|leap|sudden-charge)($|-)/.test(slugOf(s)) || (s?.activityProfile?.includes ?? []).some((x) => ["stride", "step", "move"].includes(x)) || Number(s?.activityProfile?.strideCount) > 0 || s?.role === "mobility";
// planner.js isPlainMovement: Stride/Step only (Stand out of prone is not padding).
const isPlainMove = (s) => s?.activityProfile?.includesStrike !== true && /(^|-)(stride|step)$/.test(slugOf(s));
const isStand = (s) => slugOf(s) === "stand" || slugOf(s).endsWith("-stand") || /^stand/.test(nameSlug(s));
const isAttack = (s) => s?.source === "strike" || s?.activityProfile?.includesStrike === true || s?.attackTrait === true || traitsOf(s).includes("attack") || s?.activityProfile?.multiStrike === true;
const isStrikeLike = (s) => s?.source === "strike" || s?.activityProfile?.includesStrike === true;
const isHealing = (s) => s?.role === "healing" || s?.curated?.role === "healing";
const isBuff = (s) => s?.role === "buff" || s?.activityProfile?.spellBuff === true;
const isOffGuardSetup = (s) => /feint|create-a-diversion/.test(slugOf(s) + " " + nameSlug(s));
const reloadOf = (s) => Number(s?.reload ?? s?.item?.system?.reload?.value ?? 0) || 0;
const weaponKey = (s) => s?.item?.id ?? s?.item?._id ?? null;

// Reach of a weapon-backed strike: an explicit range, else the weapon's range increment (a ranged
// weapon can shoot out to 6 increments; the planner may take the volley/increment penalty), else
// melee reach (5 ft, or 10 ft with the reach trait).
function strikeReach(strike) {
  const explicit = Number(strike?.range?.max ?? strike?.targetingProfile?.maxRange);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const item = strike?.item ?? strike?.strike?.item;
  const range = item?.system?.range;
  const increment = Number(range?.increment ?? range?.max ?? range);
  if (Number.isFinite(increment) && increment > 0) return Number(range?.max) > 0 ? Number(range.max) : increment * 6;
  return traitsOf(strike).includes("reach") || (item?.system?.traits?.value ?? []).includes("reach") ? 10 : 5;
}

// Same rule as planner.js orphanSetupSteps: only an attack usable without moving makes a Stride
// "padding". When every attack needs a move first, a Stride is progress.
function attackUsableInPlace(candidates) {
  return candidates.some((c) => c?.available !== false && !c?.needsApproach && Number(c?.score) > 0 && isAttack(c)
    && !(Number(c?.activityProfile?.strideCount) > 0));
}

export function judgePlan(ctx, build, plan, rank) {
  const flags = [];
  const add = (judge, msg) => flags.push({ judge, rank, msg });
  const steps = plan.steps.filter((s) => !s.quickenedNextTurn);
  const budget = plan.actionBudget?.totalActions ?? 3;
  const enemies = ctx.battlefield.enemies;
  const allies = ctx.battlefield.allies;
  const profile = ctx.actor.profile;
  const inPlan = new Set(steps.map((s) => s.id));
  const inPlanSlug = new Set(steps.map((s) => s.slug));
  const cost = steps.reduce((t, s) => t + (typeof s.actionCost === "number" ? s.actionCost : 0), 0);

  // wasted actions
  if (cost < budget) {
    const left = budget - cost;
    const unused = build.candidates.filter((c) => !inPlan.has(c.id) && !inPlanSlug.has(c.slug) && typeof c.actionCost === "number" && c.actionCost > 0 && c.actionCost <= left && c.score > 0);
    if (unused.length) add("wasted-actions", `cost ${cost}/${budget}; unused: ${unused.slice(0, 4).map((c) => `${c.name}[${c.actionCost}]=${Math.round(c.score)}`).join(", ")}`);
  }
  if (cost > budget) add("over-budget", `cost ${cost} > ${budget}`);

  // orphan setups
  const lastAttackIdx = steps.map(isAttack).lastIndexOf(true);
  steps.forEach((s, i) => {
    if (isOffGuardSetup(s) && i > lastAttackIdx) add(lastAttackIdx >= 0 ? "setup-after-payoff" : "orphan-setup", `${s.name} at #${i + 1} with no later attack`);
  });
  if (steps.some(isPlainMove) && !steps.some(isAttack) && attackUsableInPlace(build.candidates)
    && !steps.some((s) => isHealing(s) || isBuff(s) || /spell/.test(String(s.source)) || s.needsApproach)) {
    add("orphan-setup", `movement padded with non-attacks while an attack was on offer: ${steps.map((s) => s.name).join(" -> ")}`);
  }
  if (plan.orphanSetups > 0) add("orphan-setup(planner)", `planner counted ${plan.orphanSetups}`);

  // attack out of reach, tracking feet closed by earlier steps
  const speed = Number(profile.speed ?? 25);
  const feetOf = (s) => {
    const inc = s.activityProfile?.includes ?? [];
    let f = 0;
    if (/(^|-)stride$/.test(slugOf(s))) f += speed;
    if (/(^|-)step$/.test(slugOf(s))) f += 5;
    f += inc.filter((x) => x === "stride").length * speed + inc.filter((x) => x === "step").length * 5;
    if (!f && Number(s.activityProfile?.strideCount) > 0) f = Number(s.activityProfile.strideCount) * speed;
    if (!f && s.activityProfile?.fixedDistance) f = Number(s.activityProfile.fixedDistance);
    if (!f && isMove(s)) f = speed; // unknown mover: be lenient
    if (s.activityProfile?.retreatBeforeStrike || /away/.test(slugOf(s))) f = -f;
    return f;
  };
  const readyStrikes = (ctx.actor.document.system.actions ?? []).filter((a) => a.type === "strike" && a.ready !== false);
  let moved = 0;
  steps.forEach((s) => {
    const before = moved;
    moved += feetOf(s);
    const tid = s.suggestedTarget?.id ?? s.preferredTarget?.id;
    const tgt = enemies.find((e) => e.id === tid);
    if (!tgt) return;
    const closed = Math.max(before, Math.max(0, moved)); // a compound step may move first
    let reach = null;
    const ap = s.activityProfile ?? {};
    if (ap.multiStrike || ap.requiresBackingStrike) {
      const backing = [ap.backingStrike, ...(ap.backingStrikes ?? [])].filter(Boolean);
      // The backing strike is only the planner's damage estimate (best average damage). Unless the
      // action restricts its weapon (unarmed, reload-0 ranged, two held melee weapons), the player
      // may Strike with any ready weapon: Harsk's Skirmish Strike can fire the arbalest.
      if (!ap.backingStrikeFilter && !ap.requiresDualBackingStrike) backing.push(...readyStrikes);
      reach = backing.length ? Math.max(...backing.map(strikeReach)) : 5;
    } else if (isStrikeLike(s)) reach = Number(s.range?.max ?? s.targetingProfile?.maxRange ?? ap.strikeReach) || strikeReach(s);
    else if (String(s.source).startsWith("spell") && s.targetingProfile?.enemy) reach = Number(s.targetingProfile?.maxRange ?? s.targetingProfile?.range);
    else if (["trip", "grapple", "shove", "disarm", "reposition", "feint"].includes(s.slug)) reach = Number(profile.maneuverReach?.[s.slug] ?? 5);
    else if (s.slug === "demoralize") reach = 30;
    if (Number.isFinite(reach) && reach > 0 && tgt.distance - closed > reach) add("attack-out-of-reach", `${s.name}@${tgt.name} dist ${tgt.distance} moved ${closed} > reach ${reach}`);
  });

  // healing when no one needs it
  const needy = [...allies, { hpPercent: profile.hp?.percent, conditions: profile.conditions }].some((a) => Number(a.hpPercent) < 0.75 || (a.conditions?.slugs ?? []).includes("dying"));
  for (const s of steps) if (isHealing(s) && !needy) add("needless-healing", s.name);

  // duplicate buff on the same target
  const buffSeen = new Set();
  for (const s of steps) {
    if (!isBuff(s)) continue;
    const key = `${s.slug}@${s.suggestedTarget?.id ?? "?"}`;
    if (buffSeen.has(key)) add("duplicate-buff", `${s.name} twice on ${s.suggestedTarget?.name ?? "?"}`);
    buffSeen.add(key);
  }

  // reload weapon fired twice
  const fired = new Map();
  for (const s of steps) {
    if (/reload|interact/.test(slugOf(s) + nameSlug(s))) { fired.clear(); continue; }
    if (!isStrikeLike(s)) continue;
    const key = weaponKey(s);
    if (reloadOf(s) > 0 && key) {
      if (fired.get(key) && !s.reloadIncluded && !(s.actionCost > 1)) add("reload-double-fire", `${s.name} fired twice without reload`);
      fired.set(key, true);
    }
  }

  // thrown weapon / bomb thrown twice without drawing again
  const thrown = new Map();
  for (const s of steps) {
    if (/draw|interact|quick-bomber|quick-alchemy/.test(slugOf(s) + nameSlug(s))) { thrown.clear(); continue; }
    if (s.source !== "strike") continue;
    const tr = traitsOf(s);
    const isBomb = tr.includes("bomb") || s.item?.system?.category === "bomb" || tr.includes("consumable");
    const isThrownUse = s.altUsage === "thrown" || isBomb || (tr.some((t) => t.startsWith("thrown")) && s.isRanged);
    const key = weaponKey(s);
    if (!isThrownUse || !key) continue;
    if (thrown.get(key)) add("thrown-twice-no-draw", `${s.name} thrown twice`);
    thrown.set(key, true);
  }

  // plain Draw with no later attack using that weapon
  steps.forEach((s, j) => {
    if (!(s.activityProfile?.drawsWeapon && !s.activityProfile?.includesStrike)) return;
    const w = s.item?.id;
    // The weapon is used by a later Strike, or backs a later Sudden Charge / Skirmish Strike.
    const usesWeapon = (t) => [t.item?.id, t.strike?.item?.id, t.activityProfile?.backingStrike?.item?.id].includes(w);
    if (!steps.slice(j + 1).some((t) => usesWeapon(t) && isAttack(t))) add("orphan-draw", `${s.name} never used`);
  });

  // flourish / once-per-turn twice
  const flourishes = steps.filter((s) => traitsOf(s).includes("flourish"));
  if (flourishes.length > 1) add("flourish-twice", flourishes.map((s) => s.name).join(", "));
  const onceCounts = {};
  for (const s of steps) if (/hunt-prey|devise-a-stratagem|exploit-vulnerability|rage/.test(s.slug)) onceCounts[s.slug] = (onceCounts[s.slug] ?? 0) + 1;
  for (const [k, n] of Object.entries(onceCounts)) if (n > 1) add("once-per-turn-twice", `${k} x${n}`);

  // Raise a Shield without a shield
  for (const s of steps) if (/raise-a-shield/.test(slugOf(s)) && !profile.hasShield) add("raise-shield-no-shield", s.name);

  // maneuvers needing a free hand
  for (const s of steps) {
    if (!["trip", "grapple", "shove", "disarm", "reposition", "battle-medicine", "administer-first-aid"].includes(s.slug)) continue;
    if (Number(profile.handsFree) > 0) continue;
    const held = (ctx.actor.document.system.actions ?? []).filter((a) => a.ready !== false && a.item?.id !== "fist").some((a) => (a.item?.system?.traits?.value ?? []).includes(s.slug));
    if (!held) add("needs-free-hand", `${s.name} with handsFree=${profile.handsFree}`);
  }

  // chosen player tactic not reflected while a fitting action was usable
  const role = ctx._meta.role;
  if (role !== "auto" && ROLE_PREFER[role]) {
    const pref = ROLE_PREFER[role];
    const planHas = steps.some((s) => { const c = actionCategories(s, s.role); return pref.some((p) => c.has(p)); });
    const usable = build.candidates.filter((c) => c.score > 0 && c.available !== false && !c.needsApproach && c.actionCost !== "reaction" && !/drop-prone/.test(slugOf(c)) && pref.some((p) => actionCategories(c, c.role).has(p)));
    if (!planHas && usable.length) add("role-mismatch", `${role}: usable ${usable.slice(0, 3).map((c) => `${c.name}=${Math.round(c.score)}`).join(", ")} absent`);
  }

  // third Strike at full MAP over a better non-attack of the same cost
  steps.forEach((s) => {
    if (!isStrikeLike(s) || !(Number(s.mapPenalty) >= 8)) return;
    const alt = build.candidates.filter((c) => !inPlan.has(c.id) && !inPlanSlug.has(c.slug) && !isAttack(c) && c.actionCost === s.actionCost && c.score > Number(s.score) && !isMove(c));
    if (alt.length) add("map-swap", `${s.name} at MAP-${s.mapPenalty} (${Math.round(s.score)}) over ${alt.slice(0, 3).map((c) => `${c.name}=${Math.round(c.score)}`).join(", ")}`);
  });

  // moving while prone without Standing first
  if ((profile.conditions?.slugs ?? []).includes("prone")) {
    let stood = false;
    for (const s of steps) {
      if (isStand(s) || s.activityProfile?.includes?.includes?.("stand")) stood = true;
      else if (isMove(s) && !/crawl/.test(slugOf(s)) && !stood && !/stand/.test(nameSlug(s))) add("move-while-prone", s.name);
    }
  }
  return flags;
}
