import { t } from "../../i18n.js";
import { collectionValues } from "../../foundry-data.js";
import { executionPatch, revertEnvelope } from "./results.js";
import { canRestoreSnapshot } from "../revert/transaction.js";

const SUCCESS_DEGREES = new Set(["success", "criticalSuccess", "critical-success", "critical success", 2, 3]);

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function conditionSlug(condition) {
  return String(
    condition?.slug
      ?? condition?.system?.slug?.value
      ?? condition?.system?.slug
      ?? condition?.name
      ?? "",
  ).trim().toLowerCase();
}

function actorConditionValue(actor, slug) {
  const collection = actor?.itemTypes?.condition;
  if (collection === undefined || collection === null) return null;
  const condition = collectionValues(collection).find((entry) => conditionSlug(entry) === slug);
  if (!condition) return 0;
  return numeric(
    condition?.system?.value?.value
      ?? condition?.system?.value
      ?? condition?.system?.badge?.value
      ?? condition?.value,
    1,
  );
}

function conditionRevertOp(actor, slug, options = {}) {
  const conditionValue = actorConditionValue(actor, slug);
  return {
    kind: "condition",
    slug,
    ...options,
    ...(conditionValue === null ? {} : { expectedAfter: { conditionValue } }),
  };
}

export async function decreaseCondition(actor, slug, options = {}) {
  if (typeof actor?.decreaseCondition === "function") {
    await actor.decreaseCondition(slug, options);
    return true;
  }
  if (typeof actor?.toggleCondition === "function" && slug === "prone") {
    await actor.toggleCondition(slug, { active: false });
    return true;
  }
  return false;
}

export async function increaseCondition(actor, slug, options = {}) {
  if (typeof actor?.increaseCondition === "function") {
    await actor.increaseCondition(slug, options);
    return true;
  }
  if (typeof actor?.toggleCondition === "function" && slug === "prone") {
    await actor.toggleCondition(slug, { active: true });
    return true;
  }
  return false;
}

export async function revertCondition(op, { actor, warnings }) {
  const currentValue = actorConditionValue(actor, op?.slug);
  if (currentValue !== null && !canRestoreSnapshot({
    current: { conditionValue: currentValue },
    expectedAfter: op?.expectedAfter,
    warnings,
    label: op?.slug ?? "condition",
  })) return;
  if (op?.remove === true) {
    const cleared = await decreaseCondition(actor, op?.slug, { forceRemove: true });
    if (!cleared) throw new Error(t("Revert.CouldNotClear", "could not clear {slug}", { slug: op?.slug ?? "condition" }));
    return;
  }
  const restored = await increaseCondition(actor, op?.slug, op?.options ?? {});
  if (!restored) throw new Error(t("Revert.CouldNotRestoreCond", "could not restore {slug}", { slug: op?.slug ?? "condition" }));
}

export async function executeStand(actor) {
  const removed = await decreaseCondition(actor, "prone", { forceRemove: true });
  return removed
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.RemovedProne", "Removed prone."), revert: revertEnvelope([conditionRevertOp(actor, "prone")]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotRemoveProne", "Could not remove prone.") }), error: t("Exec.CouldNotRemoveProne", "Could not remove prone.") };
}

function resultDegree(result) {
  const values = [
    result?.degreeOfSuccess,
    result?.outcome,
    result?.result?.degreeOfSuccess,
    result?.roll?.degreeOfSuccess,
  ];
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function degreeSucceeded(degree) {
  if (degree === null || degree === undefined) return null;
  if (SUCCESS_DEGREES.has(degree)) return true;
  return String(degree).toLowerCase().includes("success");
}

function isCriticalSuccessDegree(degree) {
  if (degree === 3) return true;
  return String(degree ?? "").toLowerCase().replace(/[\s_-]/g, "") === "criticalsuccess";
}

// Roll the actor's Fortitude save to chat. PF2e exposes saves as statistics with a roll(); pass a DC
// when one is known so the card shows the degree, otherwise roll flat (the GM judges it).
async function rollFortitudeSave(actor, { event, dc } = {}) {
  const save = actor?.saves?.fortitude ?? actor?.getStatistic?.("fortitude");
  if (typeof save?.roll !== "function") return null;
  try {
    return await save.roll({ event, ...(Number.isFinite(dc) ? { dc: { value: dc } } : {}) });
  } catch (_error) {
    return null;
  }
}

// Apply a settled Retch result: a success removes 1 sickened, a critical success removes 2, each
// reduction getting its own revert op. A non-success leaves sickened unchanged.
async function applyRetchResult(actor, succeeded, critical) {
  if (succeeded !== true) {
    return { status: "done", patch: executionPatch({}, "done", { result: t("Exec.RetchFailed", "Retch failed; sickened unchanged.") }) };
  }
  const reduceBy = critical ? 2 : 1;
  let removed = 0;
  for (let index = 0; index < reduceBy; index += 1) {
    if (await decreaseCondition(actor, "sickened")) removed += 1;
  }
  if (removed <= 0) {
    return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotReduceSickened", "Could not reduce sickened.") }), error: t("Exec.CouldNotReduceSickened", "Could not reduce sickened.") };
  }
  const currentValue = actorConditionValue(actor, "sickened");
  return {
    status: "done",
    patch: executionPatch({}, "done", {
      result: removed >= 2 ? t("Exec.ReducedSickened2", "Reduced sickened by 2.") : t("Exec.ReducedSickened", "Reduced sickened."),
      revert: revertEnvelope(Array.from({ length: removed }, (_value, index) => ({
        kind: "condition",
        slug: "sickened",
        ...(currentValue === null ? {} : { expectedAfter: { conditionValue: currentValue + index } }),
      }))),
    }),
  };
}

// Retch is a Fortitude save against the DC of the effect that sickened you (not a PF2e action), and
// only the GM knows that DC. The flow runs in three phases driven by the panel:
//   1. No DC yet            -> needs-choice "retch-dc"     (GM supplies the DC)
//   2. DC supplied (no rule)-> roll the save vs the DC, then needs-choice "retch-result" carrying the
//                              rolled degree (the player rolls; the GM then judges)
//   3. GM ruled             -> apply choices.retchSucceeded / retchCritical
export async function executeRetch({ actor, action, event, choices }) {
  if (choices.retchSucceeded !== undefined) {
    return applyRetchResult(actor, choices.retchSucceeded === true, choices.retchCritical === true);
  }
  const dc = numeric(action?.dc ?? action?.difficultyClass ?? choices?.dc);
  if (!Number.isFinite(dc)) {
    return { status: "needs-choice", choices: ["retch-dc"], patch: {} };
  }
  // DC known -- the player rolls the save against it (posted to chat); the GM rules on the outcome.
  const roll = await rollFortitudeSave(actor, { event, dc });
  const degree = resultDegree(roll);
  return {
    status: "needs-choice",
    choices: ["retch-result"],
    patch: {},
    rolled: {
      degree: degree ?? null,
      succeeded: degreeSucceeded(degree),
      critical: isCriticalSuccessDegree(degree),
    },
  };
}

export async function executeDropProne(actor) {
  const added = await increaseCondition(actor, "prone");
  return added
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.DroppedProne", "Dropped prone."), revert: revertEnvelope([conditionRevertOp(actor, "prone", { remove: true })]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotDropProne", "Could not drop prone.") }), error: t("Exec.CouldNotDropProne", "Could not drop prone.") };
}
