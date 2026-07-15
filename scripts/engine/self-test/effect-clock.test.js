import assert from "node:assert/strict";
import { buildEffectClock } from "../effect-clock.js";

function timedEffect(id, name, remaining, unit = "rounds", extra = {}) {
  return {
    id,
    uuid: `Actor.test.Item.${id}`,
    name,
    type: "effect",
    remainingDuration: { remaining, expired: extra.expired === true },
    system: {
      duration: { unit, value: 1, expiry: extra.expiry ?? "turn-end" },
      start: { initiative: extra.initiative ?? 12 },
      expired: extra.expired === true,
    },
    ...extra,
  };
}

function condition(id, slug, value = 1, name = null) {
  return {
    id,
    uuid: `Actor.test.Item.${id}`,
    name: name ?? (slug === "persistent-damage" ? "Persistent Fire Damage" : "Frightened"),
    slug,
    type: "condition",
    active: true,
    system: { value: { value } },
  };
}

const haste = timedEffect("haste", "Haste", 6);
const heroism = timedEffect("heroism", "Heroism", 18);
const stance = timedEffect("stance", "Stance", Infinity, "encounter");
const unlimited = timedEffect("unlimited", "Permanent Blessing", Infinity, "unlimited");
const sustainedEffect = timedEffect("wall-effect", "Effect: Wall of Fire", 6);
const persistent = condition("persistent", "persistent-damage");
const frightened = condition("frightened", "frightened", 2, "Frightened 2");
const actor = {
  id: "clock-actor",
  type: "character",
  items: [haste, heroism, stance, unlimited, sustainedEffect, persistent, frightened],
  itemTypes: {
    effect: [haste, heroism, stance, unlimited, sustainedEffect],
    condition: [persistent, frightened],
  },
};
const context = { actor: { id: actor.id, document: actor } };
const wall = {
  id: "wall-of-fire",
  name: "Wall of Fire",
  spellUuid: "Actor.test.Item.wall-spell",
  effectIds: ["wall-effect"],
  planned: false,
  sustained: false,
};

const clock = buildEffectClock(context, { draft: { steps: [] }, sustainedEntries: [wall] });
assert.equal(clock.hasEntries, true, "clock should report native timed events");
assert.equal(clock.entries.some((entry) => entry.id === "effect-unlimited"), false, "clock should omit unlimited effects");
assert.equal(clock.entries.some((entry) => entry.id === "effect-wall-effect"), false, "sustained effect should not be duplicated");
assert.equal(clock.entries.some((entry) => entry.kind === "sustain"), false,
  "clock should leave sustained spell display and planning to the main panel");
assert.equal(clock.entries.find((entry) => entry.id === "effect-haste")?.bucket, "attention",
  "one-round native duration should need attention");
assert.equal(clock.entries.find((entry) => entry.id === "effect-heroism")?.bucket, "later",
  "longer native duration should stay in later timeline");
assert.equal(clock.entries.find((entry) => entry.id === "effect-stance")?.timingLabel, "Until encounter ends",
  "encounter effects should use native encounter semantics");
assert.equal(clock.entries.find((entry) => entry.id === "condition-persistent")?.bucket, "attention",
  "persistent damage should expose its end-turn event");
assert.equal(clock.entries.find((entry) => entry.id === "condition-frightened")?.timingLabel, "Decreases by 1",
  "frightened should expose its normal end-turn decrement");
assert.equal(clock.entries.find((entry) => entry.id === "condition-frightened")?.name, "Frightened 2",
  "frightened should not duplicate PF2e's value-bearing condition name");

const previousGame = globalThis.game;
try {
  globalThis.game = { user: { isGM: false } };
  const hidden = timedEffect("hidden-effect", "Secret Effect", 6, "rounds", { hidden: true });
  const privateActor = {
    id: "private-clock",
    items: [hidden],
    itemTypes: { effect: [hidden], condition: [] },
  };
  const privateClock = buildEffectClock({ actor: { document: privateActor } }, {
    draft: { steps: [] },
    sustainedEntries: [{ ...wall, effectIds: ["hidden-effect"] }],
  });
  assert.equal(privateClock.totalCount, 0, "player clock should not leak hidden effect documents");
} finally {
  globalThis.game = previousGame;
}
