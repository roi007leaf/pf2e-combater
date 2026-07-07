import { actionSlug } from "../action/requirements.js";
import { slugify } from "../action/text.js";
import { targetActor, targetTokenUuid } from "./targets.js";

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function actionContextSlug(action) {
  return slugify(actionSlug(action))
    || slugify(action?.item?.slug)
    || slugify(action?.item?.name)
    || slugify(action?.name);
}

function pf2eDamageRollClass() {
  return globalThis.game?.pf2e?.DamageRoll
    ?? globalThis.CONFIG?.Dice?.rolls?.find?.((cls) => cls?.name === "DamageRoll")
    ?? null;
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function actionDisplayName(action) {
  return action?.item?.name ?? action?.name ?? "Damage";
}

function damageContextOptions(action) {
  const slug = actionContextSlug(action);
  const options = [];
  if (slug) {
    options.push(`item:slug:${slug}`, `self:action:slug:${slug}`);
  }
  const cost = numeric(action?.actionCost ?? action?.cost);
  if (cost) options.push(`self:action:cost:${cost}`);
  return options;
}

function damageTargetFlag(target) {
  const token = target?.token ?? target;
  const actor = targetActor(token);
  const tokenUuid = targetTokenUuid(token);
  return actor?.uuid && tokenUuid ? { actor: actor.uuid, token: tokenUuid } : null;
}

function damageOriginFlag(action) {
  if (typeof action?.item?.getOriginData === "function") return action.item.getOriginData();
  const uuid = action?.item?.uuid ?? action?.uuid ?? action?.sourceId ?? null;
  if (!uuid) return null;
  return { uuid };
}

function damageMessageFlags({ actor, action, target }) {
  const slug = actionContextSlug(action);
  const targetFlag = damageTargetFlag(target);
  const origin = damageOriginFlag(action);
  const traits = Array.isArray(action?.traits)
    ? action.traits
    : Array.isArray(action?.item?.system?.traits?.value)
      ? action.item.system.traits.value
      : [];
  return {
    pf2e: {
      context: {
        type: "damage-roll",
        sourceType: action?.attackTrait ? "attack" : "save",
        actor: actor?.id ?? null,
        token: actor?.token?.id ?? null,
        target: targetFlag,
        domains: slug ? [`${slug}-damage`, "damage-roll"] : ["damage-roll"],
        options: damageContextOptions(action),
        contextualOptions: {},
        traits,
        notes: [],
        secret: false,
        outcome: null,
        unadjustedOutcome: null,
      },
      target: targetFlag,
      ...(origin ? { origin } : {}),
      modifiers: [],
      dice: [],
    },
  };
}

function damageFlavor(action) {
  return `<h4 class="action">${htmlEscape(actionDisplayName(action))}</h4>`;
}

// Prefer parsed profile, but fall back to @Damage[...] in action/item description when reader shape
// carries only an average.
function actionDamageFormula(action) {
  const profileFormula = action?.damageProfile?.formula;
  if (profileFormula) {
    return { formula: String(profileFormula).trim(), type: action.damageProfile.type ?? null };
  }
  const raw = [
    action?.description?.value ?? action?.description,
    action?.system?.description?.value ?? action?.system?.description,
    action?.item?.system?.description?.value ?? action?.item?.system?.description,
    action?.item?.description?.value ?? action?.item?.description,
  ].filter((value) => typeof value === "string").join(" ");
  const match = raw.match(/@Damage\[([^\][]+)(?:\[([^\]]+)\])?/i);
  if (!match) return null;
  return { formula: String(match[1]).trim(), type: match[2] ? String(match[2]).trim() : null };
}

async function rollActionDamage({ actor, action, target = null, timestamp = null }) {
  const parsed = actionDamageFormula(action);
  if (!parsed?.formula) return null;
  const DamageRoll = pf2eDamageRollClass();
  if (typeof DamageRoll !== "function") return null;

  const { formula } = parsed;
  const type = parsed.type ? String(parsed.type).toLowerCase() : null;
  const typed = !type || /\[[^\]]+\]/.test(formula) ? formula : `(${formula})[${type}]`;
  try {
    const rollData = typeof actor?.getRollData === "function" ? actor.getRollData() : {};
    const showBreakdown = globalThis.game?.pf2e?.settings?.metagame?.breakdowns || Boolean(actor?.hasPlayerOwner);
    const roll = new DamageRoll(typed, rollData, { showBreakdown });
    if (typeof roll.evaluate === "function") await roll.evaluate();
    if (typeof roll.toMessage !== "function") return null;
    const message = await roll.toMessage({
      speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? {},
      flavor: damageFlavor(action),
      flags: damageMessageFlags({ actor, action, target }),
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
    });
    return message?.id ?? message?._id ?? null;
  } catch (error) {
    globalThis.console?.warn?.("pf2e-combater | Auto damage roll failed", error);
    return null;
  }
}

function damageRollCount(action) {
  if (action?.activityProfile?.damageScalesWithActions !== true) return 1;
  const cost = numeric(action?.actionCost ?? action?.cost, 1);
  return Math.max(1, Math.min(3, cost || 1));
}

export async function flushPendingChat() {
  const schedule = globalThis.setTimeout;
  if (typeof schedule !== "function") return;
  await new Promise((resolve) => { schedule(resolve, 0); });
}

export async function rollActionDamageMessages({ actor, action, target = null, after = null }) {
  const count = damageRollCount(action);
  const base = Number.isFinite(after) ? after : null;
  const messageIds = [];
  for (let index = 0; index < count; index += 1) {
    const timestamp = base != null ? base + 1 + index : null;
    const messageId = await rollActionDamage({ actor, action, target, timestamp });
    if (messageId) messageIds.push(messageId);
  }
  return messageIds;
}
