import assert from "node:assert/strict";
import { buildFlankingIllustrations, mountFlankingSettingsCards, registerFlankingSettingsCardClicks } from "../../flanking/flanking-settings-ui.js";
import { registerSettings } from "../../settings.js";

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name),
    };
  }
  append(...elements) { this.children.push(...elements); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  dispatchEvent(event) { this.listeners[event.type]?.(event); return true; }
  setAttribute(name, value) { this[name] = value; }
}

const previousGame = globalThis.game;
const previousEvent = globalThis.Event;
const previousFoundry = globalThis.foundry;
try {
  const registered = new Map();
  globalThis.game = {
    i18n: { localize: (key) => key },
    settings: { register: (_module, key, definition) => registered.set(key, definition) },
  };
  globalThis.Event = class { constructor(type) { this.type = type; } };
  const cards = buildFlankingIllustrations();
  assert.deepEqual(cards.map((card) => card.value), ["raw", "anySquare", "anyCorner", "lineThrough"]);
  assert.ok(cards.every((card) => card.svg.includes("<svg") && card.svg.includes("</svg>")));

  const group = new Element("div");
  const select = new Element("select");
  select.value = "raw";
  select.closest = () => group;
  group.querySelector = (selector) => {
    if (selector === 'select[name="pf2e-combater.flankingSizeRule"]') return select;
    return selector === ".combater-flanking-cards" ? group.children[0] ?? null : null;
  };
  const root = { querySelector: (selector) => selector === 'select[name="pf2e-combater.flankingSizeRule"]' ? select : null };
  const document = {
    listeners: {},
    createElement: (tagName) => new Element(tagName),
    addEventListener(name, callback) { this.listeners[name] = callback; },
  };
  registerFlankingSettingsCardClicks(document);
  const clickCard = (button, cardGroup) => {
    button.closest = (selector) => selector === ".combater-flanking-card" ? button : cardGroup;
    document.listeners.click({ target: button });
  };
  assert.equal(mountFlankingSettingsCards(root, document), true);
  assert.equal(mountFlankingSettingsCards(root, document), false, "rerender must not duplicate cards");
  const chooser = group.children[0];
  assert.equal(chooser.children.length, cards.length);
  assert.ok(chooser.children.every((button) => button.innerHTML.includes("<svg")));
  clickCard(chooser.children[1], group);
  assert.equal(select.value, "anySquare");
  assert.ok(chooser.children[1].classes.has("active"));
  assert.ok(!chooser.children[0].classes.has("active"));

  class StringField {
    constructor(options) { this.options = options; }
    toFormGroup() { return group; }
  }
  globalThis.foundry = { data: { fields: { StringField } } };
  group.children.length = 0;
  group.querySelector = (selector) => {
    if (selector === 'select[name="pf2e-combater.flankingSizeRule"]') return select;
    return selector === ".combater-flanking-cards" ? group.children[0] ?? null : null;
  };
  const previousDocument = globalThis.document;
  globalThis.document = document;
  try {
    registerSettings({ decorateFlankingFormGroup: mountFlankingSettingsCards });
    const field = registered.get("flankingSizeRule").type;
    assert.ok(field instanceof StringField);
    assert.deepEqual(Object.keys(field.options.choices), cards.map((card) => card.value));
    assert.equal(field.toFormGroup(), group);
    assert.equal(group.children[0].children.length, cards.length, "setting field must include SVGs when rendered");

    const renderedGroup = new Element("div");
    const renderedChooser = new Element("div");
    for (const card of cards) {
      const button = new Element("button");
      button.dataset.value = card.value;
      renderedChooser.append(button);
    }
    renderedGroup.append(renderedChooser);
    renderedGroup.querySelector = (selector) => {
      if (selector === 'select[name="pf2e-combater.flankingSizeRule"]') return select;
      return selector === ".combater-flanking-cards" ? renderedChooser : null;
    };
    select.closest = () => renderedGroup;
    select.value = "raw";
    assert.equal(mountFlankingSettingsCards(renderedGroup, document), false, "render hook rebinds serialized cards");
    clickCard(renderedChooser.children[2], renderedGroup);
    assert.equal(select.value, "anyCorner");
    assert.ok(renderedChooser.children[2].classes.has("active"));
    assert.ok(renderedGroup.classes.has("combater-flanking-setting"));
  } finally {
    globalThis.document = previousDocument;
  }
  console.log("PF2e Combater flanking settings SVG test passed");
} finally {
  globalThis.game = previousGame;
  globalThis.Event = previousEvent;
  globalThis.foundry = previousFoundry;
}
