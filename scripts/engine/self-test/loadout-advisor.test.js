import assert from "node:assert/strict";
import { buildLoadoutAdvice } from "../loadout-advisor.js";

function weapon(id, name, { carryType, handsHeld, hands = 1, range = null, damage = "1d6", damageType = "slashing", traits = [] }) {
  return {
    id,
    uuid: `Actor.test.Item.${id}`,
    name,
    type: "weapon",
    img: `${id}.webp`,
    system: {
      category: "martial",
      equipped: { carryType, handsHeld },
      usage: { value: hands === 2 ? "held-in-two-hands" : "held-in-one-hand", hands },
      range: range ? { increment: range } : null,
      reload: { value: "0" },
      traits: { value: traits },
      damageRolls: { main: { damage, damageType } },
    },
  };
}

function strike(item, { ready, range = null, damage = "1d6", damageType = "slashing", modifier = 10 }) {
  return {
    type: "strike",
    id: `strike-${item.id}`,
    slug: item.id,
    label: item.name,
    name: item.name,
    ready,
    visible: true,
    canAttack: true,
    item,
    variants: [{ modifier }],
    traits: item.system.traits.value,
    damageFormula: damage,
    damageType,
    range: range ? { increment: range } : null,
  };
}

function contextFor(actor, target) {
  return {
    actor: { id: actor.id, name: actor.name, document: actor, profile: { hp: { percent: 1 } } },
    profile: { hp: { percent: 1 } },
    targets: [target],
    enemies: [target],
    battlefield: { targets: [target], enemies: [target] },
  };
}

const sword = weapon("sword", "Longsword", { carryType: "held", handsHeld: 1, damage: "1d8", damageType: "slashing" });
const bow = weapon("bow", "Shortbow", { carryType: "worn", handsHeld: 0, hands: 2, range: 60, damage: "1d6", damageType: "piercing" });
const rangedActor = {
  id: "ranged-actor",
  name: "Ranger",
  type: "character",
  items: [sword, bow],
  itemTypes: { weapon: [sword, bow] },
  system: { actions: [strike(sword, { ready: true, damage: "1d8", damageType: "slashing" }), strike(bow, { ready: false, range: 60, damageType: "piercing" })] },
};
const distantTarget = { id: "distant", name: "Archer", distance: 40, threatReach: 5 };
const rangedAdvice = buildLoadoutAdvice(contextFor(rangedActor, distantTarget));
assert.equal(rangedAdvice[0].heldItemId, "sword", "advisor should put away unreachable held melee weapon");
assert.equal(rangedAdvice[0].drawItemId, "bow", "advisor should draw unready ranged weapon derived from PF2e strike data");
assert.ok(rangedAdvice[0].reasons[0].includes("can reach"), "advisor should explain range improvement");

const neutralBuckler = {
  id: "neutral-buckler",
  name: "Buckler",
  type: "armor",
  system: { category: "shield", equipped: { carryType: "worn", handsHeld: 0 }, usage: { value: "held-in-one-hand", hands: 1 } },
};
const defensiveSwapActor = {
  ...rangedActor,
  items: [sword, neutralBuckler],
  itemTypes: { weapon: [sword] },
  system: { actions: [strike(sword, { ready: true, damage: "1d8", damageType: "slashing" })] },
};
const defensiveSwap = buildLoadoutAdvice(contextFor(defensiveSwapActor, distantTarget))
  .find((entry) => entry.drawItemId === "neutral-buckler");
assert.ok(defensiveSwap?.reasons[0].includes("cannot reach"),
  "defensive replacement for an unreachable weapon should explain its fit instead of using generic copy");

const fireSword = weapon("fire-sword", "Flame Blade", { carryType: "held", handsHeld: 1, damageType: "fire" });
const coldSword = weapon("cold-sword", "Frost Blade", { carryType: "worn", handsHeld: 0, damageType: "cold" });
const elementalActor = {
  id: "elemental-actor",
  name: "Fighter",
  type: "character",
  items: [fireSword, coldSword],
  itemTypes: { weapon: [fireSword, coldSword] },
  system: { actions: [
    strike(fireSword, { ready: true, damageType: "fire" }),
    strike(coldSword, { ready: false, damageType: "cold" }),
  ] },
};
const elementalTarget = {
  id: "elemental",
  name: "Elemental",
  distance: 5,
  threatReach: 5,
  resistances: [{ type: "fire", value: 10 }],
  weaknesses: [{ type: "cold", value: 5 }],
};
const elementalAdvice = buildLoadoutAdvice(contextFor(elementalActor, elementalTarget));
assert.equal(elementalAdvice[0].drawItemId, "cold-sword", "known weakness/resistance should drive damage-type swap");
assert.ok(elementalAdvice[0].reasons.some((reason) => reason.toLowerCase().includes("weakness")),
  "advisor should explain known weakness without bypassing intel visibility helpers");

const torch = {
  id: "torch",
  name: "Torch",
  type: "equipment",
  system: { equipped: { carryType: "held", handsHeld: 1 }, usage: { value: "held-in-one-hand", hands: 1 } },
};
const shield = {
  id: "shield",
  name: "Steel Shield",
  type: "armor",
  system: { category: "shield", equipped: { carryType: "worn", handsHeld: 0 }, usage: { value: "held-in-one-hand", hands: 1 } },
};
const shieldActor = {
  id: "shield-actor",
  name: "Guardian",
  type: "character",
  items: [torch, shield],
  itemTypes: { weapon: [] },
  system: { actions: [] },
};
const shieldContext = contextFor(shieldActor, { id: "brute", name: "Brute", distance: 5, threatReach: 10 });
shieldContext.profile.hp.percent = 0.4;
shieldContext.actor.profile.hp.percent = 0.4;
const shieldAdvice = buildLoadoutAdvice(shieldContext);
assert.equal(shieldAdvice[0].drawItemId, "shield", "nearby threat and low HP should recommend readying a worn shield");

const dagger = weapon("dagger", "Dagger", { carryType: "held", handsHeld: 1 });
const fullHandsActor = {
  ...rangedActor,
  items: [sword, dagger, bow],
  itemTypes: { weapon: [sword, dagger, bow] },
  system: { actions: [...rangedActor.system.actions, strike(dagger, { ready: true })] },
};
assert.equal(
  buildLoadoutAdvice(contextFor(fullHandsActor, distantTarget)).some((entry) => entry.drawItemId === "bow"),
  false,
  "advisor should reject swaps that leave insufficient hands for drawn item",
);
