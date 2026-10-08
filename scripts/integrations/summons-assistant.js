import { t } from "../i18n.js";

const MODULE = "pf2e-summons-assistant";
// Traditional creature summons supported by Summons Assistant's public summon API.
const SPELLS = {
  "summon-animal": ["4YnON9JHYqtLzccu", ["animal"]],
  "summon-construct": ["lKcsmeOrgHtK4xQa", ["construct"]],
  "summon-dragon": ["kghwmH3tQjMIhdH1", ["dragon"]],
  "summon-undead": ["9WGeBwIIbbUuWKq0", ["undead"]],
  "summon-celestial": ["lTDixrrNKaCvLKwX", ["celestial"]],
  "summon-fey": ["hs7h8f4Z1ZNdUt3s", ["fey"]],
  "summon-lesser-servitor": ["B0FZLkoHsiRgw7gv", ["celestial", "fiend", "monitor", "animal"]],
  "summon-plant-or-fungus": ["jSRAyd57kd4WZ4yE", ["plant", "fungus"]],
  "summon-elemental": ["lpT6LotUaQPfinjj", ["elemental"]],
  "summon-entity": ["i1TvBID5QLyXrUCa", ["aberration"]],
  "summon-fiend": ["29ytKctjg7qSW2ff", ["fiend"]],
  "summon-giant": ["e9UJoVYUd5kJWUpi", ["giant"]],
  "summon-monitor": ["ZbEHglw5tkJ3grQZ", ["monitor"]],
};
const LEVELS = [-1, -1, 1, 2, 3, 5, 7, 9, 11, 13, 15];

function api() {
  if (globalThis.game?.modules?.get?.(MODULE)?.active !== true) return null;
  return globalThis.window?.[MODULE] ?? globalThis[MODULE] ?? null;
}

export function summonSpellConfig(action) {
  const spell = SPELLS[action?.slug];
  const castRank = Number(action?.castRank ?? action?.rank);
  if (!spell || !Number.isInteger(castRank) || castRank < 1 || castRank > 10 || action?.consumableItem) return null;
  const rank = action.slug === "summon-lesser-servitor" ? Math.min(4, castRank) : castRank;
  return { sourceUuid: `Compendium.pf2e.spells-srd.Item.${spell[0]}`, traits: spell[1], rank, castRank, level: LEVELS[rank] };
}

export function canPlanSummon(action) {
  return Boolean(summonSpellConfig(action) && typeof api()?.summon === "function"
    && typeof globalThis.foundrySummons?.SummonMenu?.start === "function"
    && typeof globalThis.Sequencer?.Crosshair?.show === "function");
}

export function eligibleSummon(actor, config) {
  const level = Number(actor?.level ?? actor?.system?.details?.level?.value);
  const traits = actor?.system?.traits?.value ?? [];
  return Boolean(config && Number.isFinite(level) && level <= config.level
    && actor?.system?.traits?.rarity === "common"
    && config.traits.some((trait) => Array.from(traits).includes(trait)));
}

function casterToken(context) {
  const token = globalThis.canvas?.tokens?.get?.(context?.token?.id)
    ?? context?.token?.object ?? context?.token;
  // A drafted Stride may precede this spell. Its projected center determines
  // planning range; the real token has not moved yet.
  return context?.token?.plannedCenter
    ? { center: context.token.plannedCenter, w: token?.w, h: token?.h } : token;
}

function summonRange(action) {
  const value = Number(action?.targetingProfile?.maxRange ?? action?.range?.max ?? 30);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

export async function planSummon(context, action) {
  if (!canPlanSummon(action)) return null;
  const config = summonSpellConfig(action);
  const uuid = await globalThis.foundrySummons.SummonMenu.start({
    noSummon: true,
    filter: (actor) => eligibleSummon(actor, config),
    // Foundry Summons requests extra compendium fields through its filter controls.
    // Level alone is indexed by default; eligibility also requires traits and rarity.
    toggles: [{
      id: "onlyWithArtwork",
      name: t("Summon.OnlyWithArtwork", "Only creatures with artwork"),
      default: false,
      indexedFields: ["system.details.level.value", "system.traits.value", "system.traits.rarity"],
      func: (actor, enabled) => !enabled || Boolean(actor?.img && !actor.img.endsWith("default-icons/npc.svg")),
    }],
  }).catch((error) => {
    if (/closed summon menu|selection cancel/i.test(String(error?.message ?? error))) return null;
    throw error;
  });
  if (!uuid) return null;
  const actor = await globalThis.fromUuid(uuid);
  if (!eligibleSummon(actor, config)) return null;
  const placement = await globalThis.Sequencer.Crosshair.show({
    texture: actor.prototypeToken?.texture?.src,
    distance: (actor.prototypeToken?.height ?? 1) * (globalThis.canvas?.grid?.distance ?? 5) / 2,
    lockDrag: true,
    label: { text: t("Summon.PlanPlacement", "Plan placement: {name}", { name: actor.name }) },
    location: { obj: casterToken(context), limitMaxRange: summonRange(action), showRange: true, displayRangePoly: true },
  });
  if (!placement || !Number.isFinite(placement.x) || !Number.isFinite(placement.y)) return null;
  return {
    actorUuid: uuid,
    actorName: actor.name,
    center: { x: placement.x, y: placement.y },
    sceneId: globalThis.canvas?.scene?.id,
    castRank: config.castRank,
  };
}

export async function validateSummonPlan(context, action, plan) {
  const config = summonSpellConfig(action);
  if (!canPlanSummon(action) || !config || plan?.castRank !== config.castRank
    || plan?.sceneId !== globalThis.canvas?.scene?.id
    || !Number.isFinite(plan?.center?.x) || !Number.isFinite(plan?.center?.y)) return false;
  const actor = await globalThis.fromUuid(plan.actorUuid);
  if (!eligibleSummon(actor, config)) return false;
  const origin = casterToken(context)?.center;
  const cost = origin && globalThis.canvas?.grid?.measurePath?.([origin, plan.center])?.cost;
  return Number.isFinite(cost) && cost <= summonRange(action);
}

let activeCast = false;

// Assistant owns the automatic chat-card summon. Its public menu/pick seam lets
// us supply the draft choice without casting silently or suppressing chat hooks.
export async function preparePlannedSummon(actor, action, plan) {
  const summons = globalThis.foundrySummons;
  const hooks = globalThis.Hooks;
  if (activeCast || !api() || typeof summons?.pick !== "function" || typeof hooks?.on !== "function") {
    throw new Error(t("Summon.Unavailable", "Summons Assistant is unavailable."));
  }
  const selected = await globalThis.fromUuid(plan.actorUuid);
  if (activeCast) throw new Error("summon-cast-in-progress");
  activeCast = true;
  const menu = summons.SummonMenu;
  const start = menu.start;
  const pick = summons.pick;
  let armed = false;
  let selectedByAssistant = false;
  let disposed = false;
  let timer = null;
  let hookId;
  let settle;
  const completed = new Promise((resolve) => { settle = resolve; });
  const restore = () => {
    if (disposed) return;
    disposed = true;
    if (menu.start === plannedMenu) menu.start = start;
    if (summons.pick === plannedPick) summons.pick = pick;
    hooks.off("createChatMessage", hookId);
    clearTimeout(timer);
  };
  const dispose = () => { restore(); activeCast = false; };
  const fail = (error) => { dispose(); settle({ error }); };
  const plannedMenu = async function (options, ...args) {
    const isAssistantPicker = options?.noSummon === true
      && options.dropdowns?.some((control) => control.id === "traitsFilter")
      && options.toggles?.some((control) => control.id === "onlyWithImages");
    if (!armed || selectedByAssistant || !isAssistantPicker) return start.call(this, options, ...args);
    if (!options.filter?.(selected)) {
      fail(new Error("summon-choice-no-longer-eligible"));
      return start.call(this, options, ...args);
    }
    selectedByAssistant = true;
    return plan.actorUuid;
  };
  const plannedPick = async function (options, ...args) {
    if (!armed || !selectedByAssistant || options?.uuid !== plan.actorUuid) return pick.call(this, options, ...args);
    // Restore immediately: subsequent summons and unrelated menus stay native.
    restore();
    const crosshair = globalThis.Sequencer.Crosshair;
    const show = crosshair.show;
    const placementMarker = Symbol("combater-planned-summon");
    const restoreCrosshair = () => {
      if (crosshair.show === plannedPlacement) crosshair.show = show;
    };
    const plannedPlacement = async function (config, ...showArgs) {
      if (!config?.[placementMarker]) return show.call(this, config, ...showArgs);
      restoreCrosshair();
      // Foundry Summons expects MeasuredTemplate data from Sequencer. Supply the
      // saved center directly; its normal GM approval, socket and token creation
      // still run. The private marker scopes this bypass to this single pick.
      return {
        t: config.t ?? globalThis.CONST?.MEASURED_TEMPLATE_TYPES?.CIRCLE ?? "circle",
        x: plan.center.x,
        y: plan.center.y,
        distance: config.distance ?? (globalThis.canvas?.grid?.distance ?? 5) / 2,
        width: config.width ?? globalThis.canvas?.grid?.distance ?? 5,
        direction: config.direction ?? 0,
        angle: config.angle ?? 53.13,
        borderColor: config.borderColor ?? "#000000",
        fillColor: config.fillColor ?? globalThis.game?.user?.color,
        texture: config.texture,
      };
    };
    crosshair.show = plannedPlacement;
    try {
      const token = await pick.call(this, {
        ...options,
        crosshairParameters: {
          ...options.crosshairParameters,
          [placementMarker]: true,
        },
      }, ...args);
      settle(token ? { token } : { error: new Error("summon-placement-cancelled") });
      return token;
    } catch (error) {
      settle({ error });
      throw error;
    } finally {
      restoreCrosshair();
    }
  };
  hookId = hooks.on("createChatMessage", (message, _options, userId) => {
    if (userId !== globalThis.game?.user?.id || message?.isRoll || message?.isDamageRoll) return;
    const sameActor = message?.speaker?.actor === actor.id;
    const sameItem = message?.item?.id === action.item?.id;
    if (!armed && sameActor && sameItem) {
      armed = true;
      timer = setTimeout(() => fail(new Error("summon-automation-did-not-start")), 10000);
    } else if (summonSpellConfig({ slug: message?.item?.slug, castRank: action.castRank ?? action.rank })) {
      // Another local cast before our picker starts makes correlation ambiguous.
      // Leave both native flows intact rather than apply this actor's saved plan.
      fail(new Error("concurrent-summon-cast"));
    }
  });
  menu.start = plannedMenu;
  summons.pick = plannedPick;
  return {
    dispose,
    async finish(result) {
      if (result?.nativeResult?.spellCast !== true || !result.nativeResult.message || !armed) throw new Error("cast-unconfirmed");
      const outcome = await completed;
      if (outcome.error) throw outcome.error;
      return outcome.token;
    },
  };
}
