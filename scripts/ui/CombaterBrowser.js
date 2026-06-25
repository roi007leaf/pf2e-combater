import { MODULE_ID, STORAGE_KEYS } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function readBrowserState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.browserState) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function writeBrowserState(patch) {
  try {
    localStorage.setItem(STORAGE_KEYS.browserState, JSON.stringify({ ...readBrowserState(), ...patch }));
  } catch (_error) {
    // Some browser privacy modes deny storage; the window still works without persistence.
  }
}

// Separate window holding the action browser (cost tabs, search, action sections). It is a thin
// view over the owning CombaterPanel: it renders the panel's already-computed builder model and
// routes every mutation back through the panel, which re-renders both windows.
export class CombaterBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-browser`,
    classes: [MODULE_ID, "combater-panel", "combater-browser"],
    tag: "aside",
    window: {
      frame: true,
      icon: "fa-solid fa-layer-group",
      positioned: true,
      resizable: true,
    },
    position: {
      width: 460,
      height: 620,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/combater-browser.hbs`,
    },
  };

  constructor(panel, options = {}) {
    super(options);
    this._panel = panel;
    this._restoredPosition = false;
  }

  get title() {
    const actorName = this._panel?._context?.actor?.name;
    return actorName ? `Combater Actions - ${actorName}` : "Combater Actions";
  }

  async _prepareContext(options) {
    await super._prepareContext(options);
    return this._panel?.browserViewContext?.() ?? { builder: null, readonly: true, showDebug: false, debug: {} };
  }

  _restorePosition() {
    if (this._restoredPosition) return;
    this._restoredPosition = true;
    const saved = readBrowserState();
    const patch = {};
    if (Number.isFinite(saved.left)) patch.left = saved.left;
    if (Number.isFinite(saved.top)) patch.top = saved.top;
    if (Number.isFinite(saved.width)) patch.width = saved.width;
    if (Number.isFinite(saved.height)) patch.height = saved.height;
    if (Object.keys(patch).length) {
      this.setPosition(patch);
      return;
    }
    // Default: dock just right of the owning panel.
    const panelEl = this._panel?.element;
    const rect = panelEl?.getBoundingClientRect?.();
    if (rect) this.setPosition({ left: Math.round(rect.right + 8), top: Math.round(rect.top) });
  }

  _savePosition() {
    const { left, top, width, height } = this.position ?? {};
    writeBrowserState({ left, top, width, height });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._restorePosition();

    const element = this.element;
    const panel = this._panel;
    if (!panel) return;

    for (const button of element.querySelectorAll("[data-tab]")) {
      button.addEventListener("click", () => panel._setActiveTab(button.dataset.tab));
    }

    for (const input of element.querySelectorAll("[data-search-actions]")) {
      input.addEventListener("input", () => panel._setSearchQuery(input.value, input));
    }
    panel._restoreSearchFocus(element);

    for (const button of element.querySelectorAll("[data-add-action]")) {
      button.addEventListener("click", () => panel._addAction(button.dataset.addAction));
    }

    for (const button of element.querySelectorAll("[data-add-unconditional]")) {
      button.addEventListener("click", () => panel._addUnconditionalAction(button.dataset.addUnconditional));
    }

    for (const button of element.querySelectorAll("[data-favorite-action]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        panel._toggleFavorite(button.dataset.favoriteAction);
      });
    }

    for (const button of element.querySelectorAll("[data-open-action]")) {
      button.addEventListener("click", () => panel._openBuilderAction(button.dataset.openAction));
    }

    element.addEventListener("pointerup", () => this._savePosition(), { passive: true });
  }

  async close(options) {
    try {
      return await super.close(options);
    } finally {
      this._panel?._onBrowserClosed?.(this);
    }
  }
}
