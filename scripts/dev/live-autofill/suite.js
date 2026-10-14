// Live Auto-fill suite: builds each case on one reusable scene in the running world, runs the real
// planner for the creature under test, and checks the plans. Dev tool, never imported by the module.
//
//   const { runLiveAutofillSuite } = await import("/modules/pf2e-combater/scripts/dev/live-autofill/suite.js");
//   await runLiveAutofillSuite();                       // everything
//   await runLiveAutofillSuite({ only: /^npc-/ });      // a subset by id
//
// Cases live in cases.js. Every plan is also held to the invariants below (no crash, within the
// action budget, every targeted step within range from where the creature will be standing).
/* global Actor, Scene, Combat, Folder, JournalEntry */
import { LIVE_AUTOFILL_CASES, iconicSmokeCases } from "./cases.js";

const BASE = "/modules/pf2e-combater/scripts";
const SCENE_NAME = "Combater Live Suite";
export const FOLDER_NAME = "Combater Live Suite";
const FLAG = "pf2e-combater";
const SOURCES = {
  iconic: { pack: "pf2e.iconics", name: (name) => `${name} (Level 5)` },
  mc: { pack: "pf2e.pathfinder-monster-core", name: (name) => name },
  npc: { pack: "pf2e.pathfinder-npc-core", name: (name) => name },
  pfs: { pack: "pf2e.pfs-season-5-bestiary", name: (name) => name },
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function engine() {
  const [ctx, planner, candidates, planState, intent, horizon, focus, rules] = await Promise.all([
    import(`${BASE}/state/combat-context.js`),
    import(`${BASE}/engine/planner.js`),
    import(`${BASE}/engine/candidates.js`),
    import(`${BASE}/engine/plan-state.js`),
    import(`${BASE}/engine/planner/turn-intent.js`),
    import(`${BASE}/rules/resource-horizon.js`),
    import(`${BASE}/ui/panel/auto-fill-context.js`),
    import(`${BASE}/engine/planner/rules.js`),
  ]);
  return { ctx, planner, candidates, planState, intent, horizon, focus, rules };
}

// The panel's own wrapping: resource horizon, then turn intent, then focus on locked targets.
// testCase.intent may name tokens by position (lockTargets: [2]) and a required action by slug.
function applyPlanningOptions(context, testCase, tokens, built, api) {
  let planned = context;
  if (testCase.playerView) planned = { ...planned, isGM: false };
  if (testCase.horizon) planned = api.horizon.withResourceHorizon(planned, testCase.horizon);
  if (!testCase.intent) return planned;
  const { lockTargets = [], requiredSlug = "", ...rest } = testCase.intent;
  const lockedTargetIds = lockTargets.map((index) => tokens[index]?.id).filter(Boolean);
  const required = requiredSlug ? built.candidates.find((candidate) => candidate.slug === requiredSlug || candidate.id === requiredSlug) : null;
  const intent = {
    ...rest,
    lockedTargetIds,
    ...(required ? { requiredActionKey: api.rules.actionKey(required) } : {}),
  };
  planned = api.intent.withTurnIntent(planned, intent);
  return lockedTargetIds.length ? api.focus.contextWithCurrentAutoFillTargets(planned, lockedTargetIds) : planned;
}

// Classes with no level-5 pregen, built like a real level-5 character: ancestry, heritage,
// background, the class with every feature it grants by 5th level (subclass choices answered from
// `choices`), class feats, attributes, trained skills, spells and gear.
const BUILT = {
  magus: {
    classId: "HQBA9Yx2s8ycvz3C",
    background: "Martial Disciple",
    attributes: { str: 4, dex: 1, con: 2, int: 3, wis: 1, cha: 0 },
    skills: ["arcana", "athletics", "intimidation", "occultism"],
    choices: [[/hybrid study/i, /inexorable iron/i]],
    feats: ["Raise a Tome", "Spell Parry", "Running Recharge"],
    gear: [["Greatsword", { potency: 1, striking: 1, held: 2 }], ["Breastplate", { worn: true }], ["Healing Potion (Lesser)", { quantity: 2 }]],
    spellcasting: {
      name: "Magus Spellcasting", tradition: "arcane", prepared: "prepared", ability: "int",
      spells: { 0: ["Ignition", "Frostbite", "Shield", "Gale Blast", "Detect Magic"], 2: ["Blazing Bolt", "Mirror Image"], 3: ["Fireball", "Lightning Bolt"] },
      slots: { 0: 5, 2: 2, 3: 2 },
    },
    focus: { name: "Conflux Spells", tradition: "arcane", prepared: "focus", ability: "int", spells: { 1: ["Thunderous Strike"] } },
  },
  // Starlit Span: Spellstrike with a ranged weapon.
  "magus-starlit": {
    classSlug: "magus",
    classId: "HQBA9Yx2s8ycvz3C",
    background: "Martial Disciple",
    attributes: { str: 1, dex: 4, con: 2, int: 3, wis: 1, cha: 0 },
    skills: ["arcana", "acrobatics", "stealth", "occultism"],
    choices: [[/hybrid study/i, /starlit span/i]],
    feats: ["Raise a Tome", "Spell Parry", "Running Recharge"],
    gear: [["Composite Longbow", { potency: 1, striking: 1, held: 2 }], ["Arrows", { quantity: 60 }], ["Studded Leather Armor", { worn: true }], ["Healing Potion (Lesser)", { quantity: 2 }]],
    spellcasting: {
      name: "Magus Spellcasting", tradition: "arcane", prepared: "prepared", ability: "int",
      spells: { 0: ["Ignition", "Frostbite", "Shield", "Gale Blast", "Detect Magic"], 2: ["Blazing Bolt", "Mirror Image"], 3: ["Fireball", "Lightning Bolt"] },
      slots: { 0: 5, 2: 2, 3: 2 },
    },
    focus: { name: "Conflux Spells", tradition: "arcane", prepared: "focus", ability: "int", spells: { 1: ["Shooting Star"] } },
  },
  summoner: {
    classId: "YtOm245r8GFSFYeD",
    background: "Animal Whisperer",
    attributes: { str: 1, dex: 2, con: 2, int: 0, wis: 1, cha: 4 },
    skills: ["nature", "athletics", "diplomacy", "medicine", "survival"],
    choices: [[/eidolon/i, /^beast/i]],
    feats: ["Unfetter Eidolon", "Reinforce Eidolon", "Lifelink Surge"],
    // Summoners are trained in unarmored defense only.
    gear: [["Staff", { held: 1 }], ["Healing Potion (Lesser)", { quantity: 2 }]],
    spellcasting: {
      name: "Summoner Spellcasting", tradition: "primal", prepared: "spontaneous", ability: "cha",
      spells: { 0: ["Tangle Vine", "Electric Arc", "Gale Blast", "Know the Way", "Stabilize"], 2: ["Heal", "Entangling Flora"], 3: ["Haste"] },
      slots: { 2: 2, 3: 2 },
    },
    // Link spells, plus the focus spells its feats (Unfetter Eidolon, Reinforce Eidolon, Lifelink Surge) teach.
    focus: { name: "Link Spells", tradition: "primal", prepared: "focus", ability: "cha", spells: { 0: ["Boost Eidolon", "Reinforce Eidolon"], 1: ["Evolution Surge", "Unfetter Eidolon", "Lifelink Surge"] } },
  },
  runesmith: {
    classId: "5RK0O6eiijmC7NmA",
    background: "Artisan",
    attributes: { str: 3, dex: 1, con: 2, int: 4, wis: 1, cha: 0 },
    skills: ["crafting", "athletics", "arcana", "intimidation"],
    choices: [],
    feats: ["Engraving Strike", "Runic Tattoo", "Terrifying Invocation"],
    gear: [["Warhammer", { potency: 1, striking: 1, held: 1 }], ["Steel Shield", { held: 1 }], ["Scale Mail", { worn: true }], ["Healing Potion (Lesser)", { quantity: 2 }]],
  },
};
const BUILD_ANCESTRY = ["Human", "Skilled Human"];

// PF2e asks ChoiceSet questions through a prompt whose class isn't exported: raise one throwaway
// prompt to get at it, then answer every question from the recipe while the build runs.
let pickPromptClass = null;
async function pickPromptPrototype(folder) {
  if (pickPromptClass) return pickPromptClass.prototype;
  const probe = await Actor.create({ name: "CLS prompt probe", type: "character", folder: folder.id });
  const pending = probe.createEmbeddedDocuments("Item", [{
    name: "Probe", type: "feat",
    system: { rules: [{ key: "ChoiceSet", flag: "probe", choices: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }] },
  }]).catch(() => null);
  for (let i = 0; i < 40 && !pickPromptClass; i++) {
    pickPromptClass = [...foundry.applications.instances.values()].find((app) => app.constructor.name === "PickAThingPrompt")?.constructor ?? null;
    if (!pickPromptClass) await wait(100);
  }
  for (const app of [...foundry.applications.instances.values()].filter((entry) => entry.constructor.name === "PickAThingPrompt")) await app.close();
  await Promise.race([pending, wait(2000)]);
  await probe.delete();
  if (!pickPromptClass) throw new Error("could not reach PF2e's choice prompt");
  return pickPromptClass.prototype;
}

async function withPresetChoices(folder, presets, run) {
  const proto = await pickPromptPrototype(folder);
  const original = proto.resolveSelection;
  proto.resolveSelection = async function resolvePreset() {
    const text = `${this.title ?? ""} ${this.prompt ?? ""}`;
    const preset = presets.find(([question]) => question.test(text));
    const choices = this.choices ?? [];
    return (preset?.[1] ? choices.find((choice) => preset[1].test(String(choice.label ?? ""))) : null) ?? choices[0] ?? null;
  };
  try {
    return await run();
  } finally {
    proto.resolveSelection = original;
  }
}

async function compendiumItem(packId, name) {
  const pack = game.packs.get(packId);
  const index = await pack.getIndex();
  const entry = index.find((item) => item.name === name);
  if (!entry) throw new Error(`"${name}" not found in ${packId}`);
  return (await pack.getDocument(entry._id)).toObject();
}

async function builtActor(name, label, folder) {
  const recipe = BUILT[name];
  if (!recipe) throw new Error(`No recipe to build "${name}"`);
  const abilities = Object.fromEntries(Object.entries(recipe.attributes).map(([key, mod]) => [key, { mod }]));
  const actor = await Actor.create({
    name: label, type: "character", folder: folder.id,
    prototypeToken: { actorLink: false, name },
    system: { details: { level: { value: 5 } }, build: { attributes: { manual: true } }, abilities },
  });
  await withLearnSpellBypass(actor, () => withPresetChoices(folder, recipe.choices ?? [], async () => {
    const add = async (data) => actor.createEmbeddedDocuments("Item", [data]);
    await add(await compendiumItem("pf2e.ancestries", BUILD_ANCESTRY[0]));
    await add(await compendiumItem("pf2e.heritages", BUILD_ANCESTRY[1]));
    await add(await compendiumItem("pf2e.backgrounds", recipe.background));
    await add((await game.packs.get("pf2e.classes").getDocument(recipe.classId)).toObject());
    for (const feat of recipe.feats ?? []) await add(await compendiumItem("pf2e.feats-srd", feat));
    await actor.update(Object.fromEntries(recipe.skills.map((skill) => [`system.skills.${skill}.rank`, 1])));
    for (const [itemName, options] of recipe.gear ?? []) {
      const item = await compendiumItem("pf2e.equipment-srd", itemName);
      if (options.potency) item.system.runes = { ...(item.system.runes ?? {}), potency: options.potency, striking: options.striking ?? 0 };
      if (options.held) item.system.equipped = { ...(item.system.equipped ?? {}), carryType: "held", handsHeld: options.held };
      if (options.worn) item.system.equipped = { ...(item.system.equipped ?? {}), carryType: "worn", inSlot: true };
      if (options.quantity) item.system.quantity = options.quantity;
      await add(item);
    }
    for (const casting of [recipe.spellcasting, recipe.focus].filter(Boolean)) await addSpellcasting(actor, casting);
    if (recipe.focus) await actor.update({ "system.resources.focus": { value: 1, max: 1 } });
  }));
  if (actor.class?.slug !== (recipe.classSlug ?? name)) throw new Error(`built ${name} has class "${actor.class?.slug ?? "none"}"`);
  await actor.update({ "system.attributes.hp.value": actor.hitPoints.max });
  return actor;
}

// PF2e Workbench's "learn spell" setting vetoes spells added to a character outside its own flow
// (feat-granted focus spells included). The world setting stays as the user has it: only the actor
// being built skips that hook, and only while it is built.
async function withLearnSpellBypass(actor, run) {
  const learnHooks = (Hooks.events?.preCreateItem ?? []).filter((hook) => String(hook?.fn ?? "").includes("enableGeneralLearnSpell"));
  const originals = learnHooks.map((hook) => hook.fn);
  learnHooks.forEach((hook, index) => {
    hook.fn = (item, ...args) => (item?.parent?.id === actor.id ? undefined : originals[index](item, ...args));
  });
  try {
    return await run();
  } finally {
    learnHooks.forEach((hook, index) => { hook.fn = originals[index]; });
  }
}

async function addSpellcasting(actor, casting) {
  const slots = Object.fromEntries(Object.entries(casting.slots ?? {}).map(([rank, max]) => [`slot${rank}`, { max: Number(max), value: Number(max), prepared: [] }]));
  const [created] = await actor.createEmbeddedDocuments("Item", [{
    name: casting.name, type: "spellcastingEntry",
    system: { tradition: { value: casting.tradition }, prepared: { value: casting.prepared }, ability: { value: casting.ability }, proficiency: { value: 1 }, slots },
  }]);
  const entry = actor.spellcasting.get(created.id) ?? created;
  const pack = game.packs.get("pf2e.spells-srd");
  const index = await pack.getIndex();
  for (const [rank, names] of Object.entries(casting.spells)) {
    const added = [];
    for (const spellName of names) {
      const indexEntry = index.find((item) => item.name === spellName);
      if (!indexEntry) throw new Error(`spell "${spellName}" not found`);
      await entry.addSpell(await pack.getDocument(indexEntry._id), { groupId: Number(rank) || "cantrips" });
      // addSpell resolves before the item is saved: wait for the actor's own copy.
      let saved = null;
      for (let i = 0; i < 40 && !saved; i++) {
        saved = actor.items.find((item) => item.type === "spell" && item.name === spellName && item.system.location?.value === entry.id && !added.includes(item));
        if (!saved) await wait(50);
      }
      if (!saved) throw new Error(`spell "${spellName}" was not added to ${actor.name}`);
      added.push(saved);
    }
    // Prepared casters fill every slot of the rank (cantrips too), cycling through its spells.
    if (casting.prepared === "prepared") {
      const max = Number(casting.slots?.[rank] ?? 0);
      const prepared = Array.from({ length: max }, (_, slot) => ({ id: added[slot % added.length]?.id ?? null, expended: false }));
      if (max) await entry.update({ [`system.slots.slot${rank}.prepared`]: prepared });
    }
  }
}

async function baseActor(ref, folder) {
  const [kind, ...rest] = ref.split(":");
  const name = rest.join(":");
  if (kind === "built") {
    const label = `CLS ${name}`;
    return game.actors.find((actor) => actor.name === label && actor.folder?.id === folder.id) ?? builtActor(name, label, folder);
  }
  const source = SOURCES[kind];
  if (!source) throw new Error(`Unknown source "${kind}" in ${ref}`);
  const label = `CLS ${name}`;
  const existing = game.actors.find((actor) => actor.name === label && actor.folder?.id === folder.id);
  if (existing) return existing;
  const pack = game.packs.get(source.pack);
  const entry = pack?.index.find((item) => item.name === source.name(name));
  if (!entry) throw new Error(`${ref}: not found in ${source.pack}`);
  const data = (await pack.getDocument(entry._id)).toObject();
  data.name = label;
  data.folder = folder.id;
  data.prototypeToken = { ...(data.prototypeToken ?? {}), actorLink: false, name };
  return Actor.create(data);
}

export async function suiteScene() {
  let scene = game.scenes.getName(SCENE_NAME);
  if (!scene) {
    scene = await Scene.create({
      name: SCENE_NAME, width: 3000, height: 2400, padding: 0,
      grid: { size: 100, distance: 5, units: "ft", type: 1 },
      backgroundColor: "#37443a", tokenVision: false, fog: { exploration: false },
    });
  }
  if (canvas.scene?.id !== scene.id) await scene.view();
  for (let i = 0; i < 60 && (canvas.scene?.id !== scene.id || !canvas.ready); i++) await wait(200);
  return scene;
}

// One encounter for the whole run, emptied between cases: deleting an encounter makes PF2e offer
// an "Award XP" dialog every time.
export function suiteCombat(scene) {
  return game.combats.find((entry) => entry._source?.scene === scene.id || entry.scene?.id === scene.id) ?? null;
}

export async function clearScene(scene) {
  const combat = suiteCombat(scene);
  if (combat?.combatants.size) await combat.deleteEmbeddedDocuments("Combatant", combat.combatants.map((entry) => entry.id));
  if (scene.tokens.size) await scene.deleteEmbeddedDocuments("Token", scene.tokens.map((token) => token.id));
  // Battles put walls up; the single-turn cases plan on an open field.
  if (scene.walls?.size) await scene.deleteEmbeddedDocuments("Wall", scene.walls.map((wall) => wall.id));
}

export async function placeCase(scene, testCase, folder) {
  const level = scene.levels?.contents?.[0]?.id;
  const docs = [];
  for (const [index, [ref, gx, gy, side, opts = {}]] of testCase.t.entries()) {
    const actor = await baseActor(ref, folder);
    // PF2e derives a token's disposition from the actor's alliance, so the suite copy must be on the right side.
    const alliance = side === "enemy" ? "opposition" : "party";
    if (actor.system?.details?.alliance !== undefined && actor.system.details.alliance !== alliance) {
      await actor.update({ "system.details.alliance": alliance });
    }
    const td = (await actor.getTokenDocument({ x: gx * 100, y: gy * 100, disposition: side === "enemy" ? -1 : 1, actorLink: false })).toObject();
    if (level) td.level = level;
    // Some prototypes (e.g. Mios) override the disposition passed to getTokenDocument: force the side.
    td.disposition = side === "enemy" ? -1 : 1;
    if (opts.name) td.name = opts.name;
    // Some compendium prototypes hide the name ("Unknown"); logs need to tell creatures apart.
    else if (/^unknown$/i.test(td.name ?? "")) td.name = actor.name.replace(/^CLS /, "");
    td.flags = { ...(td.flags ?? {}), [FLAG]: { ...(td.flags?.[FLAG] ?? {}), suiteIndex: index, ...(opts.tactic ? { tacticPersonalityOverride: opts.tactic } : {}) } };
    docs.push(td);
  }
  const created = await scene.createEmbeddedDocuments("Token", docs);
  // Foundry can return created tokens in a different order: map them back by our own index.
  const tokens = [];
  for (const token of created) tokens[token.getFlag(FLAG, "suiteIndex")] = token;
  for (const [index, entry] of testCase.t.entries()) {
    const opts = entry[4] ?? {};
    const actor = tokens[index].actor;
    // A commander set up in PF2e Commanderer: every allied suite token in the squad, every tactic
    // prepared, the banner raised.
    if (opts.commander) {
      const allies = tokens.filter((token, other) => other !== index && testCase.t[other]?.[3] !== "enemy");
      await actor.setFlag("pf2e-commanderer", "squad", allies.map((token) => ({ actorUuid: token.actor.uuid, tokenUuid: token.uuid, name: token.name })));
      const tacticIds = actor.items.filter((item) => item.system?.traits?.value?.includes("tactic")).map((item) => item.id);
      await actor.setFlag("pf2e-commanderer", "preparedTactics", tacticIds);
      // With PF2e Dailies, Commanderer reads the preparation from Dailies' flag on the base actor.
      await (actor.token?.baseActor ?? actor).setFlag("pf2e-dailies", "extra.dailies.commander-tactics.tactics", tacticIds);
      const banner = actor.items.find((item) => item.system?.rules?.some((rule) => rule.key === "RollOption" && rule.option === "commanders-banner" && rule.toggleable));
      if (banner && typeof actor.toggleRollOption === "function") await actor.toggleRollOption("all", "commanders-banner", banner.id, opts.commander !== "no-banner");
    }
    // Spellstrike already spent this combat (Combater's own tracking flag).
    if (opts.spellstrikeSpent) await actor.setFlag("pf2e-combater", "spellstrike", { expended: true, combatId: null });
    // Elite/weak adjustment (e.g. a level-4 eidolon brought up to the summoner's level 5).
    if (opts.elite && typeof actor.applyAdjustment === "function") await actor.applyAdjustment("elite");
    if (opts.hp !== undefined) await actor.update({ "system.attributes.hp.value": Math.round(actor.system.attributes.hp.max * opts.hp) });
    for (const [slug, value] of opts.conds ?? []) await actor.increaseCondition(slug, value ? { value } : {});
    // What the party has learned about this creature (Recall Knowledge results), e.g. { weaknesses: true }.
    if (opts.intel) await actor.setFlag(FLAG, "intelLedger", opts.intel);
    const weapons = actor.itemTypes?.weapon ?? [];
    if (opts.sheathe) {
      const updates = weapons.filter((w) => w.system.equipped?.carryType === "held").map((w) => ({ _id: w.id, "system.equipped.carryType": "worn", "system.equipped.handsHeld": 0 }));
      if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    }
    if (opts.hold) {
      const updates = weapons.filter((w) => opts.hold.some((name) => w.name.toLowerCase().includes(name)))
        .map((w) => ({ _id: w.id, "system.equipped.carryType": "held", "system.equipped.handsHeld": Number(w.system.usage?.hands ?? 1) || 1 }));
      if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    }
  }
  return tokens;
}

export async function startCombat(scene, tokens, testCase) {
  if (testCase.combat === false) {
    // Out of combat: the suite's (empty) encounter must not be the scene's running one.
    const existing = suiteCombat(scene);
    if (existing?.active) await existing.update({ active: false });
    return null;
  }
  const combat = suiteCombat(scene) ?? await Combat.create({ scene: scene.id, active: true });
  if (!combat.active) await combat.update({ active: true });
  await combat.createEmbeddedDocuments("Combatant", tokens.map((token, index) => ({
    tokenId: token.id, sceneId: scene.id, actorId: token.actorId, initiative: 40 - index,
  })));
  if (!combat.started) await combat.startCombat();
  await combat.update({ turn: 0, round: 1 });
  return combat;
}

function targetName(step) {
  return step?.suggestedTarget?.name ?? step?.preferredTarget?.name ?? "";
}

export function planText(plan) {
  return (plan?.steps ?? []).map((step) => `${step.name}${targetName(step) ? `→${targetName(step)}` : ""}`).join(" | ");
}

// "30 feet" / "touch" / 60 -> feet; null when unknown or not a single-target range.
function stepRange(step) {
  // Ranged and thrown weapons reach six range increments (at a penalty past the first).
  const increment = Number(step?.range?.increment);
  if (Number.isFinite(increment) && increment > 0) return Math.max(increment * 6, Number(step?.range?.max) || 0);
  for (const value of [step?.range?.max, step?.targetingProfile?.maxRange]) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  const text = String(step?.item?.system?.range?.value ?? "").toLowerCase();
  if (/touch/.test(text)) return 5;
  const feet = Number(text.match(/(\d+)\s*(?:feet|ft)/)?.[1]);
  return Number.isFinite(feet) && feet > 0 ? feet : null;
}

function movesBeforeAttack(step) {
  const includes = step?.activityProfile?.includes ?? [];
  return Number(step?.activityProfile?.strideCount) > 0 || includes.includes("stride") || includes.includes("step");
}

// Every targeted step must be in range from where the creature stands when it takes that step.
function rangeViolations(context, plan, { planState }) {
  const problems = [];
  let state = planState.createPlanState(context);
  for (const step of plan?.steps ?? []) {
    const name = targetName(step);
    const range = stepRange(step);
    const areaOrSelf = step?.targetingProfile?.self === true && !step?.targetingProfile?.ally && !step?.targetingProfile?.enemy
      || step?.targetingProfile?.area === true || Boolean(step?.activityProfile?.areaPlacementCenter);
    if (name && range && !movesBeforeAttack(step) && !areaOrSelf) {
      const projected = planState.projectContextFromPlanState(context, state);
      const pool = [...(projected.battlefield?.enemies ?? projected.enemies ?? []), ...(projected.battlefield?.allies ?? projected.allies ?? [])];
      const id = step?.suggestedTarget?.id ?? step?.preferredTarget?.id;
      const entity = (id && pool.find((entry) => entry?.id === id)) || pool.find((entry) => entry?.name === name);
      const distance = Number(entity?.distance);
      if (Number.isFinite(distance) && distance > range + 0.1) problems.push(`${step.name}→${name} at ${distance} ft (range ${range})`);
    }
    state = planState.advancePlanState(context, state, step);
  }
  return problems;
}

function runChecks(testCase, result) {
  const failures = [];
  const texts = result.plans.map(planText);
  const top = texts[0] ?? "";
  const top3 = texts.slice(0, 3);
  for (const check of testCase.expect ?? []) {
    const label = check.label ?? JSON.stringify(Object.fromEntries(Object.entries(check).map(([k, v]) => [k, String(v)])));
    if (check.top && !check.top.test(top)) failures.push(`expected top plan to match ${check.top} (${label})`);
    if (check.notTop && check.notTop.test(top)) failures.push(`top plan should not match ${check.notTop} (${label})`);
    if (check.top3 && !top3.some((text) => check.top3.test(text))) failures.push(`expected a top-3 plan to match ${check.top3} (${label})`);
    if (check.never && texts.some((text) => check.never.test(text))) failures.push(`no plan should match ${check.never} (${label}): ${texts.find((text) => check.never.test(text))}`);
    if (check.first && !check.first.test(top.split(" | ")[0] ?? "")) failures.push(`expected first step to match ${check.first} (${label})`);
    if (check.fn) {
      const verdict = check.fn(result);
      if (verdict !== true) failures.push(`${label}: ${verdict || "failed"}`);
    }
  }
  return failures;
}

async function runCase(testCase, scene, folder, api) {
  const started = performance.now();
  await clearScene(scene);
  const tokens = await placeCase(scene, testCase, folder);
  const combat = await startCombat(scene, tokens, testCase);
  // Wait until every token of this case is drawn (stale placeables from the last case don't count).
  const drawn = () => tokens.every((token) => canvas.tokens.get(token.id)?.document?.id === token.id);
  for (let i = 0; i < 60 && !drawn(); i++) await wait(100);
  await wait(150);
  if (testCase.setup) await testCase.setup({ tokens, combat, scene });
  canvas.tokens.releaseAll();
  for (const target of [...game.user.targets]) target.setTarget(false, { releaseOthers: false });
  let context;
  if (combat) {
    context = await api.ctx.readCombatContext("manual", { combat, combatant: combat.combatant });
  } else {
    // Out of combat the panel plans for the selected token: wait for it to be drawn, then select it.
    let placeable = null;
    for (let i = 0; i < 40 && !placeable; i++) { placeable = canvas.tokens.get(tokens[0].id); if (!placeable) await wait(100); }
    placeable?.control({ releaseOthers: true });
    context = await api.ctx.readCombatContext("manual", {});
    canvas.tokens.releaseAll();
  }
  if (!context) return { id: testCase.id, title: testCase.title, pass: false, failures: ["no planning context"], top: "", ms: 0 };
  const planStart = performance.now();
  // Player view reads intel the way a player's panel does; candidates are built on that view too.
  const viewContext = testCase.playerView ? { ...context, isGM: false } : context;
  const firstBuild = api.candidates.buildCandidates(applyPlanningOptions(viewContext, { ...testCase, intent: null }, tokens, null, api));
  const planningContext = applyPlanningOptions(viewContext, testCase, tokens, firstBuild, api);
  const built = testCase.intent || testCase.horizon ? api.candidates.buildCandidates(planningContext) : firstBuild;
  const plans = api.planner.buildTurnPlans(planningContext, built.candidates, { includeCoverage: false, approachCandidates: built.approachable });
  const planMs = Math.round(performance.now() - planStart);
  const result = { context: planningContext, built, plans, tokens, combat };
  // Kept for inspection after a run: window.__liveAutofillCases[id].
  (globalThis.__liveAutofillCases ??= {})[testCase.id] = result;
  const failures = [];
  if (!plans.length && !testCase.allowNoPlan) failures.push("no plan produced");
  if (planMs > (testCase.maxMs ?? (testCase.group === "highlevel" ? 1500 : 600))) failures.push(`planning took ${planMs} ms`);
  for (const plan of plans.slice(0, 3)) {
    const budget = Number(plan.actionBudget?.totalActions ?? plan.actionBudget?.total ?? 3);
    if (Number(plan.totalCost) > budget) failures.push(`plan over budget (${plan.totalCost}/${budget}): ${planText(plan)}`);
    for (const problem of rangeViolations(context, plan, api)) failures.push(`out of range: ${problem} in "${planText(plan)}"`);
  }
  // Determinism: the same board must give the same top plans (no hidden order or time dependence).
  const again = api.candidates.buildCandidates(planningContext);
  const replans = api.planner.buildTurnPlans(planningContext, again.candidates, { includeCoverage: false, approachCandidates: again.approachable });
  const topThree = (list) => list.slice(0, 3).map(planText).join(" || ");
  if (topThree(replans) !== topThree(plans)) failures.push(`not deterministic: "${topThree(plans)}" then "${topThree(replans)}"`);
  failures.push(...runChecks(testCase, result));
  return {
    id: testCase.id, group: testCase.group, title: testCase.title, pass: failures.length === 0,
    failures: [...new Set(failures)], top: planText(plans[0]), second: planText(plans[1]),
    planMs, ms: Math.round(performance.now() - started),
  };
}

function reportHtml(results) {
  const passed = results.filter((entry) => entry.pass).length;
  const row = (entry) => `<tr><td>${entry.pass ? "✅" : "❌"}</td><td>${entry.id}</td><td>${entry.title}</td><td>${entry.top || "—"}</td><td>${entry.failures.join("<br>")}</td><td>${entry.planMs ?? ""}</td></tr>`;
  return `<p><b>${passed}/${results.length} passed</b> · ${new Date().toLocaleString()}</p>
<table><thead><tr><th></th><th>Case</th><th>What</th><th>Top plan</th><th>Problems</th><th>ms</th></tr></thead>
<tbody>${results.filter((entry) => !entry.pass).map(row).join("")}${results.filter((entry) => entry.pass).map(row).join("")}</tbody></table>`;
}

export async function runLiveAutofillSuite({ only = null, includeIconics = true, report = true } = {}) {
  // Started right after a reload, Foundry may still be loading: tokens wouldn't draw.
  for (let i = 0; i < 100 && !(game.ready && canvas.ready); i++) await wait(300);
  if (game.user?.isGM !== true) throw new Error("Run the live suite as a GM.");
  const folder = game.folders.find((entry) => entry.name === FOLDER_NAME && entry.type === "Actor")
    ?? await Folder.create({ name: FOLDER_NAME, type: "Actor" });
  const scene = await suiteScene();
  for (const panel of [...foundry.applications.instances.values()].filter((app) => app.constructor.name === "CombaterPanel")) await panel.close();
  const api = await engine();
  const cases = [...LIVE_AUTOFILL_CASES, ...(includeIconics ? iconicSmokeCases() : [])]
    .filter((testCase) => !only || (only instanceof RegExp ? only.test(testCase.id) : testCase.id === only));
  const results = [];
  for (const testCase of cases) {
    try {
      results.push(await runCase(testCase, scene, folder, api));
    } catch (error) {
      results.push({ id: testCase.id, group: testCase.group, title: testCase.title, pass: false, failures: [`crashed: ${error?.message ?? error}`], top: "" });
    }
  }
  await clearScene(scene);
  if (report) {
    const html = reportHtml(results);
    const journal = game.journal.getName("Combater Live Suite Report")
      ?? await JournalEntry.create({ name: "Combater Live Suite Report", pages: [{ name: "Latest run", type: "text", text: { content: html } }] });
    await journal.pages.contents[0].update({ "text.content": html });
  }
  const summary = { passed: results.filter((entry) => entry.pass).length, total: results.length };
  console.table(results.map((entry) => ({ pass: entry.pass, id: entry.id, top: entry.top, problems: entry.failures.join(" / ") })));
  return { summary, results };
}
