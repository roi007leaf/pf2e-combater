import assert from "node:assert/strict";
import { buildFlankingIllustrations, mountFlankingSettingsCards } from "../../flanking/flanking-settings-ui.js";

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.classes = new Set();
    this.classList = { toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name) };
  }
  append(...elements) { this.children.push(...elements); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  dispatchEvent(event) { this.listeners[event.type]?.(event); return true; }
}

const previousGame = globalThis.game;
const previousEvent = globalThis.Event;
try {
  globalThis.game = { i18n: { localize: (key) => key } };
  globalThis.Event = class { constructor(type) { this.type = type; } };
  const cards = buildFlankingIllustrations();
  assert.deepEqual(cards.map((card) => card.value), ["raw", "anySquare", "anyCorner", "oppositeArcs", "lineThrough"]);
  assert.ok(cards.every((card) => card.svg.includes("<svg") && card.svg.includes("</svg>")));

  const group = new Element("div");
  const select = new Element("select");
  select.value = "raw";
  select.closest = () => group;
  group.querySelector = (selector) => selector === ".combater-flanking-cards" ? group.children[0] ?? null : null;
  const root = { querySelector: (selector) => selector === 'select[name="pf2e-combater.flankingSizeRule"]' ? select : null };
  const document = { createElement: (tagName) => new Element(tagName) };
  assert.equal(mountFlankingSettingsCards(root, document), true);
  assert.equal(mountFlankingSettingsCards(root, document), false, "rerender must not duplicate cards");
  const chooser = group.children[0];
  assert.equal(chooser.children.length, 5);
  assert.ok(chooser.children.every((button) => button.innerHTML.includes("<svg")));
  chooser.children[1].listeners.click();
  assert.equal(select.value, "anySquare");
  assert.ok(chooser.children[1].classes.has("active"));
  assert.ok(!chooser.children[0].classes.has("active"));
  console.log("PF2e Combater flanking settings SVG test passed");
} finally {
  globalThis.game = previousGame;
  globalThis.Event = previousEvent;
}
