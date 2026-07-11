import { t } from "../../i18n.js";
import { actionSlug, requiresTargetForAction } from "../action/requirements.js";
import { chatActionRevert } from "./chat-revert.js";
import { executionPatch } from "./results.js";
import { resolveTarget, setTarget, targetActor } from "./targets.js";

const BATTLE_MEDICINE_WORKBENCH_MACRO_UUID = "Compendium.xdy-pf2e-workbench.asymonous-benefactor-macros.Macro.puqbJZ211kYfU2Se";

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pf2eActionsCollection() {
  return globalThis.game?.pf2e?.actions ?? null;
}

function slugToCamel(slug) {
  return String(slug ?? "")
    .toLowerCase()
    .replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
}

// PF2e exposes most actions as Action instances retrievable by slug (collection.get), but some
// legacy actions still live as camelCase functions on game.pf2e.actions.
function pf2eActionBySlug(slug) {
  const collection = pf2eActionsCollection();
  if (!collection) return null;
  const fromGet = typeof collection.get === "function" ? collection.get(slug) : null;
  return fromGet ?? collection[slug] ?? collection[slugToCamel(slug)] ?? null;
}

function systemActionVariantList(systemAction) {
  const variants = systemAction?.variants;
  if (!variants) return [];
  if (Array.isArray(variants)) return variants;
  if (Array.isArray(variants.contents)) return variants.contents;
  if (typeof variants[Symbol.iterator] === "function") return Array.from(variants);
  return [];
}

function variantKey(variant) {
  return variant?.slug ?? variant?.id ?? null;
}

function resolveActionVariant(systemAction, action) {
  const variants = systemActionVariantList(systemAction);
  if (variants.length <= 1) return null;

  const requested = String(action?.variant ?? action?.variantSlug ?? "").trim();
  if (requested) {
    const match = variants.find((variant) => variantKey(variant) === requested);
    if (match) return variantKey(match);
  }
  return variantKey(variants[0]);
}

export async function usePf2eAction({ actor, action, event, targetToken = null, step = null }) {
  const systemAction = pf2eActionBySlug(actionSlug(action));
  const mapPenaltyValue = numeric(step?.mapPenalty ?? action?.mapPenalty, 0);
  const options = {
    actors: actor ? [actor] : [],
    actor,
    event,
    target: targetActor(targetToken) ?? targetToken ?? null,
    statistic: action?.skill ?? action?.statistic,
    difficultyClass: action?.difficultyClass ?? action?.dc ?? null,
    traits: action?.traits,
    // Non-strike attack actions do not get MAP tracked automatically by PF2e; pass raw penalty.
    ...(mapPenaltyValue > 0 ? { multipleAttackPenalty: -mapPenaltyValue } : {}),
  };

  if (typeof systemAction?.use === "function") {
    const variant = resolveActionVariant(systemAction, action);
    const result = await systemAction.use({ ...options, ...(variant ? { variant } : {}) });
    return result ?? { executed: true };
  }

  if (typeof systemAction === "function") {
    const result = await systemAction(options);
    return result ?? { executed: true };
  }

  return null;
}

async function workbenchBattleMedicineMacro({ actor, action, event, targetToken, step }) {
  if (typeof globalThis.fromUuid !== "function") return null;
  try {
    const macro = await globalThis.fromUuid(BATTLE_MEDICINE_WORKBENCH_MACRO_UUID);
    if (typeof macro?.execute !== "function") return null;
    const result = await macro.execute({
      actor,
      action,
      event,
      step,
      target: targetActor(targetToken) ?? targetToken ?? null,
      targetToken,
    });
    return result ?? { executed: true, macroUuid: BATTLE_MEDICINE_WORKBENCH_MACRO_UUID };
  } catch (_error) {
    return null;
  }
}

async function useBattleMedicineAction({ actor, action, event, targetToken = null, step = null }) {
  const macroResult = await workbenchBattleMedicineMacro({ actor, action, event, targetToken, step });
  if (macroResult) return macroResult;

  return usePf2eAction({
    actor,
    action: {
      ...action,
      name: "Treat Wounds",
      slug: "treat-wounds",
      statistic: action?.statistic ?? action?.skill ?? "medicine",
      skill: action?.skill ?? "medicine",
    },
    event,
    targetToken,
    step,
  });
}

export async function executeSystemAction({ actor, step, action, event, choices }) {
  const target = requiresTargetForAction(action) ? resolveTarget(step, action, choices) : null;
  if (requiresTargetForAction(action) && !target) {
    return { status: "needs-choice", choices: ["target"], patch: {} };
  }
  if (target) setTarget(target.token);
  const result = actionSlug(action) === "battle-medicine"
    ? await useBattleMedicineAction({ actor, action, event, targetToken: target?.token ?? null, step })
    : await usePf2eAction({ actor, action, event, targetToken: target?.token ?? null, step });
  if (!result) {
    return {
      status: "failed",
      patch: executionPatch(target ? { targetTokenIds: [target.id], targetLabel: target.label } : {}, "failed", {
        error: t("Exec.NoActionApi", "PF2e action API is not available."),
      }),
      error: t("Exec.NoActionApi", "PF2e action API is not available."),
    };
  }
  return {
    status: "done",
    patch: executionPatch(target ? { targetTokenIds: [target.id], targetLabel: target.label } : {}, "done", {
      result: t("Exec.ActionOpened", "PF2e action opened."),
      revert: chatActionRevert(result, action, { target }),
    }),
    nativeResult: result,
  };
}
