/* global Roll */
// Dev-only: a real encounter where every combatant takes its top Auto-fill plan, turn after turn.
// PF2e doesn't apply damage or conditions by itself, so a small resolution layer does: real attack,
// damage and save rolls, then the damage/condition each outcome implies. Logged turn by turn so the
// planner's decisions can be reviewed (window.__battleLog, journal "Combater Battle Log").
import { FOLDER_NAME, clearScene, engine, placeCase, planText, startCombat, suiteScene } from "./suite.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = (promise, ms = 8000) => Promise.race([promise, wait(ms).then(() => "TIMEOUT")]);
// With "show check dialogs" on, PF2e skips its roll dialog for a Shift-click.
const shift = () => new MouseEvent("click", { shiftKey: true });

const PARTY = [
  ["iconic:Valeros", 5, 10, "party"], ["iconic:Kyra", 3, 12, "party"], ["iconic:Ezren", 2, 9, "party"],
  ["iconic:Harsk", 3, 6, "party"], ["iconic:Merisiel", 6, 13, "party"], ["iconic:Seoni", 2, 14, "party"],
];

// The other classes, six to a party, on the same starting squares: `runAutofillBattle({ party })`.
const SLOTS = PARTY.map(([, x, y]) => [x, y]);
const party = (names) => names.map((name, index) => [name.includes(":") ? name : `iconic:${name}`, ...SLOTS[index], "party"]);
export const PARTIES = {
  core: PARTY,
  b: party(["Amiri", "Lini", "Seelah", "Feiya", "Lem", "Jirelle"]),
  c: party(["Sajan", "Fumbus", "Quinn", "Yoon", "Korakai", "Thaleon"]),
  // Daji (a familiar) and Whirp (Droven's minion) don't take turns of their own: core iconics fill in.
  // Ulka commands the rest of the party through PF2e Commanderer (squad, prepared tactics, banner).
  d: party(["Samo", "Merisiel", "Ulka", "Mios", "Droven", "Grimmyr"]).map((entry) => (entry[0] === "iconic:Ulka" ? [...entry, { commander: true }] : entry)),
  // The last iconics plus the classes with no level-5 pregen.
  // PF2e has no eidolon actor: a level-4 PFS eidolon, made elite, fights beside the summoner.
  e: [...party(["Seoni", "Nahoa", "Nhalmika", "built:magus", "built:summoner", "built:runesmith"]),
    ["pfs:Three-Headed Goat Eidolon", 7, 11, "party", { elite: true, name: "Eidolon" }]],
};

// Walls in grid squares [x1, y1, x2, y2]: pillars and low walls that block sight and give cover.
export const BATTLES = {
  warband: {
    title: "Six heroes vs a mixed NPC warband among pillars",
    walls: [[10, 7, 10, 9], [10, 12, 10, 14], [16, 9, 17, 9], [16, 13, 17, 13]],
    t: [...PARTY,
      ["npc:Tournament Combatant", 14, 10, "enemy"], ["npc:Sniper", 21, 8, "enemy"], ["npc:Watchmage", 20, 12, "enemy"],
      ["npc:Plague Doctor", 19, 14, "enemy"], ["npc:Leaping Thief", 14, 14, "enemy"], ["npc:Mage for Hire", 21, 11, "enemy"]],
  },
  ruins: {
    title: "Hobgoblin squad holding a ruined wall",
    walls: [[14, 6, 14, 10], [14, 12, 14, 16], [11, 4, 13, 4], [11, 18, 13, 18]],
    t: [...PARTY,
      ["mc:Hobgoblin Soldier", 13, 10, "enemy"], ["mc:Hobgoblin Soldier", 13, 12, "enemy"], ["mc:Hobgoblin Archer", 16, 8, "enemy"],
      ["mc:Hobgoblin Archer", 16, 14, "enemy"], ["npc:Hobgoblin Spellbreaker", 15, 11, "enemy"], ["mc:Goblin Pyro", 17, 11, "enemy"],
      ["npc:Priest of Sarenrae", 19, 11, "enemy"]],
  },
  beasts: {
    title: "Beasts that grab and trip, led by an ogre boss",
    walls: [[11, 6, 11, 8], [11, 14, 11, 16]],
    t: [...PARTY,
      ["mc:Giant Octopus", 13, 10, "enemy"], ["mc:Wolf", 12, 7, "enemy"], ["mc:Wolf", 12, 14, "enemy"], ["mc:Warg", 15, 13, "enemy"],
      ["mc:Ogre Boss", 17, 10, "enemy"], ["mc:Ogre Warrior", 16, 8, "enemy"], ["mc:Ogre Warrior", 16, 12, "enemy"]],
  },
  necromancer: {
    title: "Necromancer, undead and beasts in a walled corridor",
    walls: [[8, 5, 18, 5], [8, 17, 18, 17], [12, 8, 12, 10], [12, 13, 12, 15]],
    t: [...PARTY,
      ["npc:Necromancer", 20, 11, "enemy"], ["mc:Zombie Shambler", 15, 9, "enemy"], ["mc:Zombie Shambler", 15, 13, "enemy"],
      ["mc:Ogre Boss", 17, 11, "enemy"], ["mc:Wolf", 14, 7, "enemy"], ["mc:Wolf", 14, 15, "enemy"], ["mc:Warg", 18, 14, "enemy"]],
  },
};

async function placeWalls(scene, walls = []) {
  if (scene.walls.size) await scene.deleteEmbeddedDocuments("Wall", scene.walls.map((wall) => wall.id));
  if (!walls.length) return;
  const normal = 20;
  await scene.createEmbeddedDocuments("Wall", walls.map(([x1, y1, x2, y2]) => ({
    c: [x1 * 100, y1 * 100, x2 * 100, y2 * 100], move: normal, sight: normal, light: normal, sound: normal,
  })));
}

const MANEUVERS = {
  trip: { skill: "athletics", dc: "reflex", success: ["prone"], attack: true },
  grapple: { skill: "athletics", dc: "fortitude", success: ["grabbed"], critical: ["restrained"], attack: true },
  shove: { skill: "athletics", dc: "fortitude", success: [], attack: true },
  disarm: { skill: "athletics", dc: "reflex", success: [], attack: true },
  reposition: { skill: "athletics", dc: "fortitude", success: [], attack: true },
  demoralize: { skill: "intimidation", dc: "will", success: [["frightened", 1]], critical: [["frightened", 2]] },
  feint: { skill: "deception", dc: "perception", success: ["off-guard"] },
  "create-a-diversion": { skill: "deception", dc: "perception", success: ["off-guard"] },
};
const MULTI_STRIKE = /double slice|flurry of blows|twin takedown|hunted shot|twin feint|two-weapon/i;

function tokenDoc(id) {
  return canvas.scene?.tokens.get(id) ?? null;
}

function stepTargetToken(step) {
  const id = step?.suggestedTarget?.id ?? step?.preferredTarget?.id ?? step?.targetingProfile?.preferredTargetId;
  return id ? tokenDoc(id) : null;
}

function hp(actor) {
  return Number(actor?.system?.attributes?.hp?.value ?? 0);
}

async function moveTo(doc, center) {
  if (!doc || !center) return false;
  const size = canvas.grid.size;
  const x = Math.round(center.x - (doc.width * size) / 2);
  const y = Math.round(center.y - (doc.height * size) / 2);
  if (doc.x === x && doc.y === y) return true;
  // Teleport to the planned square: the planner already routed around walls (a straight-line update
  // would stop at the first wall it crosses).
  await doc.update({ x, y }, { animate: false, teleport: true });
  return true;
}

function setTarget(doc) {
  for (const target of [...game.user.targets]) target.setTarget(false, { releaseOthers: false });
  canvas.tokens.get(doc?.id)?.setTarget(true, { releaseOthers: true });
}

async function applyDamage(targetDoc, damage, label) {
  const actor = targetDoc?.actor;
  if (!actor || !(damage?.total > 0 || Number(damage) > 0)) return `${label}: no damage`;
  const before = hp(actor);
  await timeout(actor.applyDamage({ damage, token: targetDoc, skipIWR: false }), 6000);
  // PF2e leaves a PC at 0 HP conscious; at the table they fall unconscious and start dying.
  let dying = "";
  if (actor.type === "character" && before > 0 && hp(actor) <= 0 && !actor.hasCondition("dying")) {
    const wounded = Number(actor.getCondition?.("wounded")?.value) || 0;
    await actor.increaseCondition("dying", { value: 1 + wounded });
    if (!actor.hasCondition("unconscious")) await actor.increaseCondition("unconscious");
    dying = `, dying ${1 + wounded}`;
  }
  return `${label}: ${targetDoc.name} ${before}→${hp(actor)} HP${dying}`;
}

// Healed above 0 HP: no longer dying or unconscious, and one step more wounded.
async function reviveIfDying(actor) {
  if (!actor?.hasCondition?.("dying") || hp(actor) <= 0) return;
  await actor.decreaseCondition("dying", { forceRemove: true });
  await actor.increaseCondition("wounded");
  if (actor.hasCondition("unconscious")) await actor.decreaseCondition("unconscious", { forceRemove: true });
}

async function addCondition(targetDoc, entry) {
  const [slug, value] = Array.isArray(entry) ? entry : [entry, null];
  try {
    await targetDoc.actor.increaseCondition(slug, value ? { value } : {});
    return `${targetDoc.name} ${slug}${value ? ` ${value}` : ""}`;
  } catch {
    return `${targetDoc.name} ${slug} (failed to apply)`;
  }
}

function degreeName(degree) {
  return ["critical failure", "failure", "success", "critical success"][degree] ?? "?";
}

// The last creature each attacker hit this turn: Strike riders (Grab, Knockdown) land on it.
const lastHit = new Map();
const RIDERS = [
  [/\b(?:improved )?grab\b/i, ["grabbed"]],
  [/\bknockdown\b|\bimproved knockdown\b/i, ["prone"]],
];

async function strikeOnce(actor, step, targetDoc, attackIndex) {
  const itemId = step?.item?.id ?? step?.strike?.item?.id;
  // An eidolon's Strike is rolled by the eidolon (on the summoner's shared MAP).
  const eidolonActor = step?.activityProfile?.eidolonStrike ? canvas.scene.tokens.get(step.activityProfile.eidolonTokenId)?.actor : null;
  const strikes = (eidolonActor ?? actor).system.actions ?? [];
  const strike = strikes.find((entry) => entry.item?.id === itemId && entry.ready !== false)
    ?? strikes.find((entry) => entry.item?.id === itemId)
    ?? strikes.find((entry) => entry.type === "strike" && entry.ready !== false);
  if (!strike) return "no Strike found";
  setTarget(targetDoc);
  const variant = strike.variants?.[Math.min(2, attackIndex)] ?? strike.variants?.[0];
  const roll = await timeout(variant.roll({ event: shift() }));
  if (roll === "TIMEOUT" || !roll) return `${strike.label}: roll timed out`;
  const degree = roll.degreeOfSuccess;
  let text = `${strike.label} (MAP ${attackIndex}) vs ${targetDoc.name}: ${roll.total} ${degreeName(degree)}`;
  if (degree >= 2) {
    lastHit.set(actor.id, targetDoc.id);
    const damage = await timeout(degree === 3 ? strike.critical({ event: shift() }) : strike.damage({ event: shift() }));
    if (damage && damage !== "TIMEOUT") text += `; ${await applyDamage(targetDoc, damage, "damage")}`;
  }
  return text;
}

// Enemies (relative to the caster) under an area: within its size of the placement centre.
function areaTargets(casterDoc, step) {
  const center = step.activityProfile?.areaPlacementCenter ?? step.activityProfile?.areaPlacementAimPoint;
  const size = Number(step.targetingProfile?.distance) || 15;
  if (!center) return [];
  const grid = canvas.grid.size;
  return canvas.scene.tokens.contents.filter((doc) => doc.id !== casterDoc.id && doc.disposition !== casterDoc.disposition && hp(doc.actor) > 0)
    .filter((doc) => Math.hypot(doc.x + (doc.width * grid) / 2 - center.x, doc.y + (doc.height * grid) / 2 - center.y) / grid * 5 <= size);
}

// A buff (no damage, no condition on a foe): its planned recipient, or every ally in an emanation
// (Bless); self when the plan names nobody. null for anything else.
function buffTargets(casterDoc, step, average, conditions) {
  if (average || conditions.length) return null;
  const named = stepTargetToken(step);
  if (named && named.disposition !== casterDoc.disposition) return null;
  if (step.targetingProfile?.area === true || /\bemanation\b/i.test(String(step.item?.system?.area?.type ?? ""))) {
    const size = Number(step.targetingProfile?.distance ?? step.item?.system?.area?.value) || 15;
    const grid = canvas.grid.size;
    return canvas.scene.tokens.contents.filter((doc) => doc.disposition === casterDoc.disposition && hp(doc.actor) > 0
      && Math.hypot(doc.x - casterDoc.x, doc.y - casterDoc.y) / grid * 5 <= size);
  }
  return [named ?? casterDoc];
}

// The spell's own effect items (Spell Effect: Haste, Effect: Guidance Immunity...), linked in its
// description, applied to the recipients. Immunities that only follow a later trigger (Shield's,
// after a Shield Block) are left out.
async function applySpellEffects(spell, casterDoc, step, targets) {
  const links = [...String(spell.system?.description?.value ?? "").matchAll(/@UUID\[(Compendium\.pf2e\.spell-effects\.Item\.[^\]]+)\](?:\{([^}]+)\})?/g)]
    .map((match) => ({ uuid: match[1], label: match[2] ?? "" }))
    .filter((link) => !/immunity/i.test(link.label) || /guidance/i.test(link.label));
  // Conditions the spell grants its target outright (Invisibility -> invisible).
  const conditionSlugs = step.targetingProfile?.enemy === true ? [] : [...String(spell.system?.description?.value ?? "")
    .matchAll(/@UUID\[Compendium\.pf2e\.conditionitems\.Item\.([A-Za-z-]+)\]/g)].map((match) => match[1].toLowerCase())
    .filter((slug) => ["invisible", "concealed", "quickened"].includes(slug));
  if (!links.length && !conditionSlugs.length) return "";
  const applied = [];
  for (const slug of new Set(conditionSlugs)) for (const doc of targets) applied.push(await addCondition(doc, slug));
  for (const link of links) {
    const effect = await fromUuid(link.uuid).catch(() => null);
    if (!effect) continue;
    for (const doc of targets) {
      try {
        await doc.actor.createEmbeddedDocuments("Item", [effect.toObject()]);
        applied.push(`${doc.name}: ${effect.name}`);
      } catch { /* leave it */ }
    }
  }
  return applied.join(", ");
}

async function castSpell(actor, casterDoc, step) {
  const spell = actor.items.get(step.item?.id) ?? null;
  if (!spell) return "spell item not found";
  const entry = spell.spellcasting;
  const rank = Number(step.castRank ?? step.rank ?? spell.rank) || spell.rank;
  try {
    // Posts the real spell card, so the chat shows what was cast (resolution below is still ours).
    if (typeof entry?.cast === "function") await timeout(entry.cast(spell, { rank }), 6000);
  } catch (error) {
    return `cast failed: ${error.message}`;
  }
  // Cast from a scroll: it's used up (a wand would spend its charge the same way).
  const scroll = actor.itemTypes.consumable.find((item) => item.system?.spell?._id === spell.id || (step.name && item.name === step.item?.name));
  if (scroll?.system?.category === "scroll") await scroll.update({ "system.quantity": Math.max(0, (Number(scroll.system.quantity) || 1) - 1) });
  const role = String(step.role ?? "");
  const average = Number(step.damageProfile?.average ?? step.averageDamage ?? step.activityProfile?.averageDamage) || 0;
  const conditions = [
    ...(step.activityProfile?.appliesCondition ? [step.activityProfile.appliesCondition] : []),
    ...(Array.isArray(step.activityProfile?.appliesConditions) ? step.activityProfile.appliesConditions : []),
  ];
  if (role === "healing") {
    const targetDoc = stepTargetToken(step) ?? casterDoc;
    const amount = average || 8 * rank;
    const before = hp(targetDoc.actor);
    await targetDoc.actor.update({ "system.attributes.hp.value": Math.min(targetDoc.actor.system.attributes.hp.max, before + amount) });
    await reviveIfDying(targetDoc.actor);
    return `${spell.name} (rank ${rank}) heals ${targetDoc.name} ${before}→${hp(targetDoc.actor)} HP`;
  }
  const buffRecipients = buffTargets(casterDoc, step, average, conditions);
  const targets = buffRecipients ?? (step.targetingProfile?.area === true ? areaTargets(casterDoc, step) : [stepTargetToken(step)].filter(Boolean));
  if (!targets.length) return `${spell.name} (rank ${rank}) cast; no target resolved`;
  if (!average && !conditions.length) {
    const applied = await applySpellEffects(spell, casterDoc, step, targets);
    return `${spell.name} (rank ${rank}) cast on ${targets.map((doc) => doc.name).join(", ")}${applied ? `; ${applied}` : " (effect not simulated)"}`;
  }
  const save = spell.system?.defense?.save?.statistic;
  const basic = spell.system?.defense?.save?.basic === true;
  const dc = Number(entry?.statistic?.dc?.value ?? entry?.system?.spelldc?.dc) || 20;
  const parts = [];
  for (const targetDoc of targets) {
    let degree;
    if (save && targetDoc.actor.saves?.[save]) {
      const roll = await timeout(targetDoc.actor.saves[save].roll({ dc: { value: dc }, event: shift() }));
      degree = roll === "TIMEOUT" ? 1 : roll.degreeOfSuccess;
      // From the target's side: its success is the spell's failure.
      degree = 3 - degree;
    } else {
      const mod = Number(entry?.statistic?.check?.mod ?? entry?.statistic?.mod) || 10;
      const d20 = (await new Roll("1d20").evaluate()).total;
      const ac = Number(targetDoc.actor.system?.attributes?.ac?.value) || 20;
      const total = d20 + mod;
      degree = total >= ac + 10 ? 3 : total >= ac ? 2 : total <= ac - 10 ? 0 : 1;
      if (d20 === 20) degree = Math.min(3, degree + 1);
      if (d20 === 1) degree = Math.max(0, degree - 1);
    }
    const multiplier = save ? (basic ? [0, 0.5, 1, 2][degree] : (degree >= 2 ? 1 : 0)) : [0, 0, 1, 2][degree];
    let text = `${targetDoc.name}: ${save ? `${save} ${degreeName(3 - degree)}` : `attack ${degreeName(degree)}`}`;
    if (average && multiplier > 0) text += `; ${await applyDamage(targetDoc, Math.round(average * multiplier), "damage")}`;
    if (conditions.length && degree >= 2) for (const condition of conditions) text += `; ${await addCondition(targetDoc, condition)}`;
    parts.push(text);
  }
  return `${spell.name} (rank ${rank}, DC ${dc}): ${parts.join(" / ")}`;
}

async function maneuver(actor, step, targetDoc, rule, attackIndex) {
  const statistic = actor.skills?.[rule.skill];
  if (!statistic || !targetDoc) return `${step.name}: no ${rule.skill} or target`;
  const dc = rule.dc === "perception"
    ? Number(targetDoc.actor.perception?.dc?.value ?? targetDoc.actor.system?.perception?.dc)
    : Number(targetDoc.actor.saves?.[rule.dc]?.dc?.value);
  const map = rule.attack ? [0, -5, -10][Math.min(2, attackIndex)] : 0;
  setTarget(targetDoc);
  const modifiers = map ? [new game.pf2e.Modifier({ label: "MAP", modifier: map, type: "untyped" })] : [];
  const roll = await timeout(statistic.roll({ dc: { value: dc }, event: shift(), modifiers }));
  if (roll === "TIMEOUT" || !roll) return `${step.name}: roll timed out`;
  const degree = roll.degreeOfSuccess;
  let text = `${step.name} vs ${targetDoc.name} (DC ${dc}${map ? `, MAP ${map}` : ""}): ${roll.total} ${degreeName(degree)}`;
  const applied = degree === 3 ? (rule.critical ?? rule.success) : degree === 2 ? rule.success : [];
  for (const condition of applied) text += `; ${await addCondition(targetDoc, condition)}`;
  // PF2e: whatever the result, the target is then immune to this creature's Demoralize for 10
  // minutes. The planner reads that effect, so it has to exist.
  if (rule.skill === "intimidation") {
    try {
      await targetDoc.actor.createEmbeddedDocuments("Item", [{ name: "Effect: Demoralize Immunity", type: "effect", img: "icons/svg/aura.svg" }]);
      text += "; now immune to Demoralize";
    } catch { /* effect schema differs: leave it */ }
  }
  return text;
}

// Reactive Strike: one reaction per creature per round, against a foe that leaves (Stride, not
// Step) or uses a manipulate action within its reach.
const reactionsUsed = new Map();

function footprintGapFeet(a, b) {
  const size = canvas.grid.size;
  const box = (doc) => ({ x0: doc.x / size, y0: doc.y / size, x1: doc.x / size + doc.width, y1: doc.y / size + doc.height });
  const A = box(a);
  const B = box(b);
  const gapX = Math.max(0, Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1));
  const gapY = Math.max(0, Math.max(A.y0, B.y0) - Math.min(A.y1, B.y1));
  return (Math.max(gapX, gapY) + 1) * 5;
}

function hasReactiveStrike(actor) {
  return Array.from(actor?.items ?? []).some((item) => /^(?:reactive strike|attack of opportunity)$/i.test(String(item?.name ?? "").trim()));
}

async function provokeReactions(moverDoc, why, round) {
  const results = [];
  for (const doc of canvas.scene.tokens.contents) {
    if (doc.id === moverDoc.id || doc.disposition === moverDoc.disposition || hp(doc.actor) <= 0 || hp(moverDoc.actor) <= 0) continue;
    if (reactionsUsed.get(doc.id) === round || !hasReactiveStrike(doc.actor)) continue;
    const reach = Number(doc.actor.getReach?.({ action: "attack" })) || 5;
    if (footprintGapFeet(doc, moverDoc) > reach) continue;
    const strike = (doc.actor.system.actions ?? []).find((entry) => entry.type === "strike" && entry.ready !== false && entry.item?.isRanged !== true);
    if (!strike) continue;
    reactionsUsed.set(doc.id, round);
    const text = await strikeOnce(doc.actor, { item: strike.item }, moverDoc, 0);
    results.push(`REACTION ${doc.name} Reactive Strike (${why}): ${text}`);
  }
  return results;
}

const MANIPULATE_EXECUTABLES = /^(?:draw-weapon|reload-weapon|swap-items)$/;

async function resolveStep(api, context, plannedStep, turn) {
  const actor = context.actor?.document ?? canvas.scene.tokens.get(context.token?.id)?.actor;
  const casterDoc = tokenDoc(context.token?.id);
  // The planned target died earlier this turn: a player would pick the nearest living foe instead
  // (the panel asks for a new target in that case).
  let step = plannedStep;
  const planned = stepTargetToken(plannedStep);
  const retarget = [];
  if (planned && planned.disposition !== casterDoc?.disposition && hp(planned.actor) <= 0) {
    const living = canvas.scene.tokens.contents
      .filter((doc) => doc.disposition !== casterDoc.disposition && hp(doc.actor) > 0)
      .toSorted((left, right) => Math.hypot(left.x - casterDoc.x, left.y - casterDoc.y) - Math.hypot(right.x - casterDoc.x, right.y - casterDoc.y))[0];
    if (living) {
      const reference = { id: living.id, name: living.name, type: "enemy" };
      step = { ...plannedStep, suggestedTarget: reference, preferredTarget: reference };
      retarget.push(`retargets ${living.name} (planned target is down)`);
    }
  }
  const slug = String(step.slug ?? "").toLowerCase();
  const moves = [...retarget];
  // Movement part (plain Stride/Step, or the move of a move-and-Strike composite).
  const center = step.destination ?? step.activityProfile?.attackCenter;
  const isStep = /(^|-)step(-|$)/.test(slug) || step.activityProfile?.fixedDistance === 5 || /^Step\b/.test(step.name ?? "");
  if (center && (step.activityProfile?.strideCount > 0 || /(^|-)(stride|step)$/.test(slug) || step.requiresDestination)) {
    if (!isStep) moves.push(...await provokeReactions(casterDoc, "moved", turn.round));
    if (hp(actor) <= 0) return moves.join("; ");
    await moveTo(casterDoc, center);
    moves.push(`moves to ${Math.round(center.x / 100)},${Math.round(center.y / 100)}`);
  }
  const targetDoc = stepTargetToken(step);
  if (step.activityProfile?.drawsWeapon && step.item?.id) {
    const weapon = actor.items.get(step.item.id);
    if (weapon) await weapon.update({ "system.equipped.carryType": "held", "system.equipped.handsHeld": Number(weapon.system.usage?.hands ?? 1) || 1 });
    moves.push(`draws ${step.item.name ?? "weapon"}`);
  }
  const rule = Object.entries(MANEUVERS).find(([key]) => slug === key || slug.endsWith(`-${key}`))?.[1];
  let outcome;
  const spellItem = step.item?.type === "spell" || String(step.source ?? "").startsWith("spell");
  // Casting a manipulate spell, drawing, reloading: provokes within reach.
  const traits = [...(step.item?.system?.traits?.value ?? []), ...(Array.isArray(step.traits) ? step.traits : [])].map((trait) => String(trait).toLowerCase());
  if ((spellItem && traits.includes("manipulate")) || MANIPULATE_EXECUTABLES.test(String(step.executable ?? "")) || step.activityProfile?.drawsWeapon) {
    moves.push(...await provokeReactions(casterDoc, "manipulate", turn.round));
    if (hp(actor) <= 0) return moves.join("; ");
  }
  // A Strike-ish activity aimed at an ally (a commander's Pincer Attack) is the ally's Strike, not ours.
  const allyTarget = targetDoc && casterDoc && targetDoc.disposition === casterDoc.disposition;
  if (!spellItem && !allyTarget && (step.source === "strike" || step.activityProfile?.includesStrike === true)) {
    if (!targetDoc) outcome = "no target";
    else {
      // "Reload -> Strike", or a first shot from an unloaded weapon: load it the way the panel does.
      if (/^Reload -> /.test(step.name ?? "") || step.startsUnloaded) {
        const equipment = await import(`${globalThis.location.origin}/modules/pf2e-combater/scripts/engine/execution/equipment.js`);
        await timeout(equipment.executeReloadWeapon({ actor, action: step }), 5000);
        moves.push("reloads");
      }
      const count = MULTI_STRIKE.test(step.name) ? 2 : 1;
      const results = [];
      for (let i = 0; i < count; i += 1) {
        results.push(await strikeOnce(actor, step, targetDoc, turn.attacks));
        if (!MULTI_STRIKE.test(step.name)) turn.attacks += 1;
      }
      if (MULTI_STRIKE.test(step.name)) turn.attacks += 2;
      outcome = results.join(" | ");
    }
  } else if (slug === "act-together" && step.activityProfile?.minionPlan) {
    // Act Together: the eidolon takes its planned action, its best Strike on the planned target.
    const plan = step.activityProfile.minionPlan;
    const eidolonDoc = canvas.scene.tokens.get(plan.minionId);
    const victim = canvas.scene.tokens.get(plan.targetId);
    const strikeItem = eidolonDoc?.actor?.system?.actions?.find((entry) => plan.steps?.includes(entry.label))?.item;
    const strikeStep = { item: { id: strikeItem?.id }, activityProfile: { eidolonStrike: true, eidolonTokenId: plan.minionId } };
    outcome = eidolonDoc && victim && hp(victim.actor) > 0 && strikeItem
      ? `Act Together: ${await strikeOnce(actor, strikeStep, victim, turn.attacks)}`
      : "Act Together: the eidolon moves";
    if (strikeItem) turn.attacks += 1;
  } else if (/(^|-)recall-knowledge$/.test(slug) && targetDoc) {
    outcome = await recallKnowledge(actor, targetDoc);
  } else if (spellItem) {
    outcome = await castSpell(actor, casterDoc, step);
  } else if (step.item?.type === "consumable" && step.role === "healing") {
    // PF2e posts the potion's healing roll for the GM to apply: apply it to whoever was fed it.
    const patient = (targetDoc && targetDoc.disposition === casterDoc?.disposition) ? targetDoc : casterDoc;
    const item = actor.items.get(step.item.id);
    const formula = String(item?.system?.damage?.formula ?? item?.system?.damage?.value ?? "").trim();
    const amount = formula ? (await new Roll(formula).evaluate()).total : (Number(step.damageProfile?.average ?? step.averageDamage) || 8);
    const before = hp(patient.actor);
    await patient.actor.update({ "system.attributes.hp.value": Math.min(patient.actor.system.attributes.hp.max, before + amount) });
    await reviveIfDying(patient.actor);
    if (item) await item.update({ "system.quantity": Math.max(0, (Number(item.system.quantity) || 1) - 1) });
    outcome = `${step.item.name} heals ${patient.name} ${before}→${hp(patient.actor)} HP`;
  } else if (rule) {
    outcome = await maneuver(actor, step, targetDoc, rule, turn.attacks);
    if (rule.attack) turn.attacks += 1;
  } else if (RIDERS.some(([pattern]) => pattern.test(step.name ?? ""))) {
    // A rider after a Strike: applies to the creature just hit (PF2e leaves it to the GM).
    const hitId = lastHit.get(actor.id);
    const hitDoc = hitId ? tokenDoc(hitId) : null;
    if (!hitDoc) outcome = "no Strike hit this turn: nothing to apply";
    else {
      const conditions = RIDERS.find(([pattern]) => pattern.test(step.name))[1];
      outcome = (await Promise.all(conditions.map((condition) => addCondition(hitDoc, condition)))).join("; ");
    }
  } else if (/\bconstrict\b/i.test(step.name ?? "")) {
    const grabbed = canvas.scene.tokens.contents.find((doc) => doc.disposition !== casterDoc.disposition
      && doc.actor?.conditions?.bySlug?.("grabbed")?.length && Math.hypot(doc.x - casterDoc.x, doc.y - casterDoc.y) <= 2 * canvas.grid.size * Math.max(casterDoc.width, 1));
    outcome = grabbed ? await applyDamage(grabbed, Number(step.averageDamage ?? step.damageProfile?.average) || 10, "Constrict") : "nobody grabbed";
  } else if (/(^|-)(stride|step)$/.test(slug) || step.requiresDestination) {
    outcome = "";
  } else {
    // Everything else runs through the module's own executor (Raise a Shield, Stand, Exploit...).
    const result = await timeout(api.executor.executeDraftStep({ context, step, event: shift(), choices: targetDoc ? { targetTokenIds: [targetDoc.id] } : {} }), 6000);
    outcome = result === "TIMEOUT" ? "executor timed out" : `${result?.status ?? "?"}${result?.error ? `: ${result.error}` : ""}`;
  }
  // Spellstrike resolves as a plain Strike here (no Spellstrike card), so mark it spent the way
  // Combater does in play; a conflux spell recharges it.
  const spellstrikeState = await import(`${globalThis.location.origin}/modules/pf2e-combater/scripts/rules/spellstrike-state.js`);
  if (step.activityProfile?.spellstrike === true || slug === "spellstrike") await spellstrikeState.setSpellstrikeExpended(actor, true);
  else if (spellstrikeState.isConfluxSpell(actor.items.get(step.item?.id))) await spellstrikeState.setSpellstrikeExpended(actor, false);
  return [...moves, outcome].filter(Boolean).join("; ");
}

// Recall Knowledge without the GM's question dialog: the best listed skill against the creature's
// DC for this attempt. The attempt is recorded (a failure blocks retries) and a success reveals the
// next unknown category, as answering one question would.
const RK_CATEGORIES = ["weaknesses", "saves", "resistances", "immunities", "actions"];
async function recallKnowledge(actor, targetDoc) {
  const rk = await import(`${globalThis.location.origin}/modules/pf2e-combater/scripts/rules/recall-knowledge.js`);
  const matrix = rk.recallKnowledgeDcMatrix(actor, targetDoc.actor);
  if (!matrix.allowed || !matrix.standardDc) return `Recall Knowledge: ${matrix.reason || "not allowed"}`;
  const skill = matrix.skills.map((slug) => actor.skills?.[slug]).filter(Boolean)
    .toSorted((left, right) => (Number(right.mod) || 0) - (Number(left.mod) || 0))[0];
  if (!skill) return "Recall Knowledge: no identifying skill";
  const roll = await timeout(skill.roll({ dc: { value: matrix.standardDc }, event: shift() }));
  const degree = roll === "TIMEOUT" ? 1 : roll.degreeOfSuccess;
  const outcome = ["criticalFailure", "failure", "success", "criticalSuccess"][degree];
  await rk.recordRecallKnowledgeAttempt(actor, targetDoc.actor, { outcome, skill: skill.slug });
  let learned = "";
  if (degree >= 2) {
    const ledger = foundry.utils.deepClone(targetDoc.actor.getFlag("pf2e-combater", "intelLedger") ?? {});
    const reveal = RK_CATEGORIES.filter((category) => !ledger[category]).slice(0, degree === 3 ? 2 : 1);
    for (const category of ["identity", ...reveal]) ledger[category] = true;
    await targetDoc.actor.setFlag("pf2e-combater", "intelLedger", ledger);
    learned = `; learns ${reveal.join(", ") || "nothing new"}`;
  }
  return `Recall Knowledge (${skill.slug}, DC ${matrix.standardDc}) on ${targetDoc.name}: ${degreeName(degree)}${learned}`;
}

async function markDefeated(combat) {
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor || combatant.defeated) continue;
    if (actor.type === "npc" && hp(actor) <= 0) await combatant.update({ defeated: true });
  }
}

function sideAlive(combat, disposition) {
  return combat.combatants.contents.some((combatant) => combatant.token?.disposition === disposition && hp(combatant.actor) > 0 && !combatant.defeated);
}

function snapshot(combat) {
  return combat.combatants.contents.map((combatant) => `${combatant.token?.name}:${hp(combatant.actor)}`).join(" ");
}

export async function runAutofillBattle({ battle = "warband", maxRounds = 5, playerView = true, party: partyKey = "core" } = {}) {
  if (game.dice3d && !globalThis.__combaterDsnStub) {
    // Dice So Nice waits on its 3D animation before posting; not needed for a scripted fight.
    game.dice3d.showForRoll = async () => true;
    globalThis.__combaterDsnStub = true;
  }
  const base = BATTLES[battle];
  if (!base) throw new Error(`Unknown battle "${battle}"`);
  if (!PARTIES[partyKey]) throw new Error(`Unknown party "${partyKey}"`);
  const spec = { ...base, t: [...PARTIES[partyKey], ...base.t.filter((entry) => entry[3] !== "party")] };
  const api = await engine();
  api.executor = await import(`${globalThis.location.origin}/modules/pf2e-combater/scripts/engine/action/executor.js`);
  const folder = game.folders.find((entry) => entry.name === FOLDER_NAME && entry.type === "Actor");
  const scene = await suiteScene();
  await clearScene(scene);
  await placeWalls(scene, spec.walls);
  const tokens = await placeCase(scene, spec, folder);
  const combat = await startCombat(scene, tokens, spec);
  for (let i = 0; i < 60 && !tokens.every((token) => canvas.tokens.get(token.id)); i++) await wait(100);
  // Random initiative (no roll prompts): the order changes from fight to fight.
  await combat.updateEmbeddedDocuments("Combatant", combat.combatants.contents.map((combatant) => ({ _id: combatant.id, initiative: Math.floor(Math.random() * 20) + 10 })));
  await combat.update({ turn: 0, round: 1 });
  const log = [];
  globalThis.__battleLog = log;
  reactionsUsed.clear();
  for (let round = 1; round <= maxRounds; round += 1) {
    // Foundry's nextTurn skips defeated combatants and wraps into the next round on its own: follow
    // combat.round rather than counting turns, or later turns run under the wrong round.
    // Each combatant acts once per round, in initiative order. The harness picks the turn itself:
    // other modules may re-sort the tracker as combatants fall, which makes nextTurn jump around.
    const order = combat.combatants.contents.toSorted((left, right) => (Number(right.initiative) || 0) - (Number(left.initiative) || 0)).map((entry) => entry.id);
    if (combat.round !== round) await combat.update({ round });
    for (const combatantId of order) {
      const turnIndex = combat.turns.findIndex((entry) => entry.id === combatantId);
      if (turnIndex < 0) continue;
      if (combat.turn !== turnIndex) await combat.update({ turn: turnIndex });
      const combatant = combat.combatants.get(combatantId);
      const actor = combatant?.actor;
      const name = combatant?.token?.name ?? "?";
      // A dying PC still takes its turn (the recovery check); a dead one, or an NPC at 0 HP, doesn't.
      const dead = actor?.type === "character" ? Boolean(actor.hasCondition?.("dead")) : hp(actor) <= 0;
      if (!actor || combatant.defeated || dead) {
        log.push({ round, name, skipped: dead ? "dead" : "defeated" });
        continue;
      }
      canvas.tokens.releaseAll();
      for (const target of [...game.user.targets]) target.setTarget(false, { releaseOthers: false });
      const base = await api.ctx.readCombatContext("manual", { combat, combatant });
      const isPc = actor.type === "character";
      const context = playerView && isPc ? { ...base, isGM: false } : base;
      const started = performance.now();
      const built = api.candidates.buildCandidates(context);
      const plans = api.planner.buildTurnPlans(context, built.candidates, { includeCoverage: false, approachCandidates: built.approachable });
      const planMs = Math.round(performance.now() - started);
      const plan = plans[0];
      const entry = { round, name, hp: `${hp(actor)}/${actor.system.attributes.hp.max}`, planMs, plan: planText(plan), score: Math.round(plan?.score ?? 0), cost: Number(plan?.totalCost ?? 0), budget: Number(plan?.actionBudget?.totalActions ?? plan?.actionBudget?.total ?? 3), alternatives: plans.slice(1, 3).map((alt) => `${Math.round(alt.score)}: ${planText(alt)}`), steps: [] };
      // An outsized score points at a pricing bug: keep the per-step internals for inspection.
      if (Number(plan?.score) > 900) {
        entry.debug = plan.steps.map((step) => ({ name: step.name, score: step.score, delta: step.projectedScoreDelta, boosted: Boolean(step.rangeBoostedFrom), approach: Boolean(step.needsApproach), mapBase: step.mapBase?.score }));
      }
      const turn = { attacks: 0, round };
      lastHit.delete(actor.id);
      for (const step of plan?.steps ?? []) {
        let result;
        try {
          result = await resolveStep(api, context, step, turn);
        } catch (error) {
          result = `ERROR ${error.message}`;
        }
        entry.steps.push(`${step.name}: ${result}`);
        await markDefeated(combat);
        // Close any PF2e roll dialog that slipped through.
        for (const app of Object.values(ui.windows)) if (/roll-modifiers-dialog/.test(app.options?.classes?.join(" ") ?? "")) await app.close();
        // Item cards / effect sheets the executor opens (Exploit, Bespell, Cover...): not needed here.
        for (const app of [...Object.values(ui.windows), ...foundry.applications.instances.values()]) {
          if (/sheet|^Effect:/.test(`${app.options?.classes?.join(" ") ?? ""} ${app.title ?? ""}`) && app.document?.type !== "character") await app.close();
        }
      }
      entry.after = snapshot(combat);
      log.push(entry);
      if (!sideAlive(combat, 1) || !sideAlive(combat, -1)) break;
    }
    if (!sideAlive(combat, 1) || !sideAlive(combat, -1)) break;
  }
  const winner = sideAlive(combat, 1) && !sideAlive(combat, -1) ? "party" : !sideAlive(combat, 1) ? "enemies" : "undecided";
  globalThis.__battleResult = { winner, rounds: log.at(-1)?.round, log };
  return globalThis.__battleResult;
}

const PARTY_NAMES = new Set(PARTY.map(([ref]) => ref.split(":")[1]));
const WASTE = /no target|nothing to apply|timed out|cast; no target resolved|failed|needs-choice|nobody grabbed/i;

// Decision-quality numbers for one fight's log.
export function summarizeBattle(result) {
  const turns = result.log.filter((entry) => !entry.skipped);
  const side = (entry) => (PARTY_NAMES.has(entry.name) ? "party" : "enemies");
  const stats = { winner: result.winner, rounds: result.rounds, turns: turns.length, idle: 0, wasted: 0, deadTargetAttacks: 0, reactions: { party: 0, enemies: 0 }, maxPlanMs: 0, totalPlanMs: 0 };
  for (const entry of turns) {
    stats.totalPlanMs += entry.planMs ?? 0;
    stats.maxPlanMs = Math.max(stats.maxPlanMs, entry.planMs ?? 0);
    if (!entry.steps?.length || Number(entry.score) <= 0) stats.idle += 1;
    for (const step of entry.steps ?? []) {
      if (WASTE.test(step)) stats.wasted += 1;
      if (/\b0→0 HP/.test(step)) stats.deadTargetAttacks += 1;
      // A reaction this creature provoked: count it against the provoking side.
      stats.reactions[side(entry)] += (step.match(/REACTION /g) ?? []).length;
    }
  }
  stats.avgPlanMs = Math.round(stats.totalPlanMs / Math.max(1, turns.length));
  delete stats.totalPlanMs;
  return stats;
}

// Several fights per battle (random initiative each time), summarized: win rate and waste per fight.
export async function runBattleSeries({ battles = Object.keys(BATTLES), runs = 3, maxRounds = 5, party: partyKey = "core" } = {}) {
  const series = {};
  globalThis.__battleSeries = series;
  for (const battle of battles) {
    series[battle] = [];
    for (let run = 0; run < runs; run += 1) {
      const result = await runAutofillBattle({ battle, maxRounds, party: partyKey });
      series[battle].push(summarizeBattle(result));
    }
  }
  const table = Object.fromEntries(Object.entries(series).map(([battle, fights]) => {
    const avg = (key) => Math.round(fights.reduce((total, fight) => total + (fight[key] ?? 0), 0) / fights.length * 10) / 10;
    return [battle, {
      partyWins: fights.filter((fight) => fight.winner === "party").length,
      fights: fights.length,
      rounds: avg("rounds"),
      wastedPerFight: avg("wasted"),
      deadTargetAttacks: avg("deadTargetAttacks"),
      idleTurns: avg("idle"),
      reactionsProvokedByParty: Math.round(fights.reduce((total, fight) => total + fight.reactions.party, 0) / fights.length * 10) / 10,
      reactionsProvokedByEnemies: Math.round(fights.reduce((total, fight) => total + fight.reactions.enemies, 0) / fights.length * 10) / 10,
      avgPlanMs: avg("avgPlanMs"),
      maxPlanMs: Math.max(...fights.map((fight) => fight.maxPlanMs)),
    }];
  }));
  globalThis.__battleSeriesTable = table;
  return table;
}
