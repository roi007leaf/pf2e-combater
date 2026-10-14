// PF2e Commanderer integration: a commander's tactics are planned with Commanderer's own state
// (prepared tactics, squad, banner aura) and issued through its workflow (responders, chat orders).
const MODULE = "pf2e-commanderer";
let commanderer = null;

export function commandererActive() {
  return commanderer !== null && globalThis.game?.modules?.get?.(MODULE)?.active === true;
}

// Commanderer's modules, loaded once at ready (the same module instances its own main.js uses).
export async function initCommandererIntegration() {
  if (globalThis.game?.modules?.get?.(MODULE)?.active !== true) return;
  try {
    const base = `/modules/${MODULE}/scripts`;
    const [tactics, runtime, banner, squad, readiness] = await Promise.all([
      import(`${base}/domain/tactics.js`),
      import(`${base}/foundry/runtime.js`),
      import(`${base}/foundry/banner.js`),
      import(`${base}/foundry/squad.js`),
      import(`${base}/domain/squad-readiness.js`),
    ]);
    commanderer = {
      tacticDefinition: tactics.tacticDefinition,
      isTacticItem: tactics.isTacticItem,
      preparedTacticIds: runtime.preparedTacticIds,
      bannerActive: runtime.bannerActive,
      bannerOrigin: banner.bannerOrigin,
      bannerRangeToToken: banner.bannerRangeToToken,
      storedSquad: squad.storedSquad,
      dependsOnBannerAura: readiness.tacticDependsOnBannerAura,
    };
  } catch (error) {
    commanderer = null;
    console.warn("pf2e-combater | PF2e Commanderer integration unavailable:", error);
  }
}

function hp(actor) {
  return Number(actor?.system?.attributes?.hp?.value ?? 1);
}

function squadTokens(actor) {
  const placeables = globalThis.canvas?.tokens?.placeables ?? [];
  return (commanderer.storedSquad(actor) ?? []).map((entry) => globalThis.fromUuidSync?.(entry.tokenUuid)?.object
    ?? placeables.find((token) => token.actor?.uuid === entry.actorUuid) ?? null)
    .filter((token) => token?.actor && hp(token.actor) > 0);
}

// Whether a tactic can be issued now and who could answer it, or null when Commanderer isn't
// handling this item.
export function commanderTacticState(actor, item) {
  if (!commandererActive() || !actor || !item || !commanderer.isTacticItem(item)) return null;
  let prepared = true;
  try {
    prepared = commanderer.preparedTacticIds(actor).has(item.id);
  } catch (_error) {
    prepared = true;
  }
  const definition = commanderer.tacticDefinition(item.slug);
  const bannerActive = commanderer.bannerActive(actor) === true;
  const auraNeeded = commanderer.dependsOnBannerAura(definition);
  const origin = bannerActive ? commanderer.bannerOrigin(actor) : null;
  const members = squadTokens(actor).map((token) => ({
    token,
    inAura: Boolean(origin && commanderer.bannerRangeToToken(actor, token) <= origin.radius),
  }));
  const responders = auraNeeded ? (bannerActive ? members.filter((member) => member.inAura) : []) : members;
  return { slug: item.slug, prepared, definition, bannerActive, auraNeeded, members, responders };
}

// Issue the tactic through Commanderer (responder choice, chat order, resolution).
export async function executeCommanderTactic(item, actor) {
  const api = globalThis.game?.modules?.get?.(MODULE)?.api;
  if (!commandererActive() || typeof api?.execute !== "function" || !commanderer.isTacticItem(item)) return null;
  const result = await api.execute(item, actor);
  return result ?? { executed: true, commanderer: true };
}
