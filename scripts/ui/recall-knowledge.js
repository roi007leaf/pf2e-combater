import { MODULE_ID } from "../constants.js";
import { collectionValues } from "../foundry-data.js";
import { t } from "../i18n.js";
import {
  INTEL_LEDGER_FLAG,
  INTEL_FALSE_INFORMATION_FLAG,
  INTEL_REVEAL_MODE_FLAG,
  intelLedgerView,
  normalizeIntelFalseInformation,
} from "../rules/intel-ledger.js";
import {
  RECALL_KNOWLEDGE_QUESTIONS,
  normalizeRecallKnowledgeOutcome,
  recallKnowledgeDcMatrix,
  recallKnowledgeQuestion,
  recordRecallKnowledgeAttempt,
  resetRecallKnowledgeAttempt,
} from "../rules/recall-knowledge.js";
import {
  isRecallKnowledgeMatrixMessage,
  recallKnowledgeDegreeFromTotal,
  recallKnowledgeDieResultFromMessage,
  recallKnowledgeHasDubiousKnowledge,
  recallKnowledgeOutcomeFromMessage,
  recallKnowledgeRollRows,
} from "../engine/execution/recall-knowledge.js";

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

function dialogApi() {
  return globalThis.foundry?.applications?.api?.DialogV2 ?? null;
}

async function buttonChoice({ title, content, choices, contentIsHtml = false, classes = [] }) {
  const dialog = dialogApi();
  if (typeof dialog?.wait !== "function") return null;
  const options = {
    window: { title },
    content: contentIsHtml ? String(content ?? "") : `<p>${escapeHtml(content)}</p>`,
    buttons: [
      ...choices.map((choice) => ({
        action: choice.id,
        label: escapeHtml(choice.label),
        ...(choice.class ? { class: String(choice.class) } : {}),
        ...(choice.icon ? { icon: String(choice.icon) } : {}),
        ...(choice.default === true ? { default: true } : {}),
      })),
      { action: "cancel", label: t("Dialog.Cancel", "Cancel") },
    ],
    rejectClose: false,
  };
  if (Array.isArray(classes) && classes.length) options.classes = classes;
  const result = await dialog.wait(options).catch(() => "cancel");
  return result && result !== "cancel" ? choices.find((choice) => choice.id === result) ?? null : null;
}

export function promptRecallKnowledgeQuestion() {
  return buttonChoice({
    title: t("RecallKnowledge.QuestionTitle", "Recall Knowledge Question"),
    content: t("RecallKnowledge.Question", "What information are you trying to recall?"),
    choices: RECALL_KNOWLEDGE_QUESTIONS,
  });
}

async function documentFromUuid(uuid) {
  if (!uuid || typeof globalThis.fromUuid !== "function") return null;
  return globalThis.fromUuid(uuid);
}

function requesterCanUseActor(actor, requesterId) {
  const users = globalThis.game?.users;
  const requester = users?.get?.(requesterId)
    ?? (globalThis.game?.user?.id === requesterId ? globalThis.game.user : null);
  if (!requester) return false;
  if (requester.isGM === true) return true;
  const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  if (typeof actor?.testUserPermission === "function") {
    return actor.testUserPermission(requester, owner);
  }
  return Number(actor?.ownership?.[requester.id] ?? actor?.ownership?.default ?? 0) >= Number(owner);
}

async function saveRecallKnowledgeIntel(decision) {
  if (!Array.isArray(decision)) return false;
  try {
    for (const entry of decision) {
      if (typeof entry.actor?.setFlag !== "function") throw new Error("Actor flags unavailable");
      await entry.actor.setFlag(MODULE_ID, INTEL_LEDGER_FLAG, entry.value);
      await entry.actor.setFlag(MODULE_ID, INTEL_REVEAL_MODE_FLAG, entry.revealMode);
      await entry.actor.setFlag(MODULE_ID, INTEL_FALSE_INFORMATION_FLAG, normalizeIntelFalseInformation(entry.falseInformation));
    }
    globalThis.ui?.notifications?.info?.(t("Intel.Saved", "Intel ledger updated."));
    globalThis.ui?.combat?.render?.(true);
    return true;
  } catch (error) {
    globalThis.console?.warn?.(`${MODULE_ID} | Failed to update Recall Knowledge intel`, error);
    globalThis.ui?.notifications?.warn?.(t("Intel.SaveFailed", "Could not update intel ledger."));
    return false;
  }
}

function recallKnowledgeAttemptActors(additionalActors = null) {
  const combatantActors = collectionValues(globalThis.game?.combat?.combatants).flatMap((combatant) => [
    combatant?.actor,
    combatant?.token?.actor,
    combatant?.token?.document?.actor,
  ]);
  const canvasActors = collectionValues(globalThis.canvas?.tokens).flatMap((token) => [
    token?.actor,
    token?.document?.actor,
  ]);
  return [...new Set([
    ...collectionValues(additionalActors),
    ...collectionValues(globalThis.game?.actors),
    globalThis.game?.user?.character,
    ...combatantActors,
    ...canvasActors,
  ].filter(Boolean))];
}

export async function resetRecallKnowledgeAttemptsForTarget(target, { actors = null, confirm = true } = {}) {
  if (globalThis.game?.user?.isGM !== true || !target) return 0;
  if (confirm) {
    const choice = await buttonChoice({
      title: t("Intel.ResetAttemptsTitle", "Reset Recall Knowledge Attempts"),
      content: t(
        "Intel.ResetAttemptsConfirm",
        "Reset all Recall Knowledge attempts against {target}? This restores first-attempt DCs and removes failure blocks.",
        { target: target?.name ?? "NPC" },
      ),
      choices: [{ id: "reset", label: t("Intel.ResetAttempts", "Reset RK attempts") }],
    });
    if (!choice) return 0;
  }
  try {
    let resetCount = 0;
    for (const actor of recallKnowledgeAttemptActors(actors)) {
      if (await resetRecallKnowledgeAttempt(actor, target)) resetCount += 1;
    }
    if (resetCount > 0) {
      globalThis.ui?.notifications?.info?.(t(
        "Intel.AttemptsReset",
        "Reset Recall Knowledge attempts against {target} for {count} actor(s).",
        { target: target?.name ?? "NPC", count: resetCount },
      ));
    } else {
      globalThis.ui?.notifications?.info?.(t(
        "Intel.NoAttemptsToReset",
        "No tracked Recall Knowledge attempts against {target}.",
        { target: target?.name ?? "NPC" },
      ));
    }
    globalThis.ui?.combat?.render?.(true);
    return resetCount;
  } catch (error) {
    globalThis.console?.warn?.(`${MODULE_ID} | Failed to reset Recall Knowledge attempts`, error);
    globalThis.ui?.notifications?.warn?.(t("Intel.ResetAttemptsFailed", "Could not reset Recall Knowledge attempts."));
    return 0;
  }
}

export async function openRecallKnowledgeIntelWindow(target, {
  openWindow = null,
  preselectIdentity = true,
  falseInformationContext = null,
} = {}) {
  if (globalThis.game?.user?.isGM !== true || !target) return false;
  const baseView = intelLedgerView({
    isGM: true,
    intelTargets: [{ actor: target, name: target?.name, id: target?.id, uuid: target?.uuid }],
  });
  const view = {
    ...baseView,
    entries: (baseView.entries ?? []).map((entry) => {
      const existingFalseInformation = entry.falseInformation ?? [];
      const revealCategory = falseInformationContext?.category ?? null;
      const hasPreparedMatchingFact = Boolean(revealCategory && existingFalseInformation.some(
        (record) => record.category === revealCategory && record.revealed === false,
      ));
      const falseInformation = falseInformationContext && !hasPreparedMatchingFact ? [
        ...existingFalseInformation,
        {
          id: globalThis.foundry?.utils?.randomID?.() ?? `false-${Date.now()}`,
          text: "",
          sourceActorUuid: falseInformationContext.actorUuid ?? "",
          sourceActorName: falseInformationContext.actorName ?? "",
          category: falseInformationContext.category ?? "traits",
          question: falseInformationContext.question ?? "",
          attempt: falseInformationContext.attempt ?? 1,
          createdAt: new Date().toISOString(),
          revealed: true,
        },
      ] : existingFalseInformation;
      const identityId = entry.availableFacts?.identity?.[0]?.id;
      const falseInformationRevealCategory = falseInformationContext?.category ?? null;
      if (!identityId || !preselectIdentity) return { ...entry, falseInformation, falseInformationRevealCategory };
      const current = entry.values?.identity;
      const identity = current === true || (Array.isArray(current) && current.length)
        ? current
        : [identityId];
      return { ...entry, falseInformation, falseInformationRevealCategory, values: { ...entry.values, identity } };
    }),
  };
  if (!view.visible || !view.entries?.length) return false;
  try {
    const resolvedOpenWindow = typeof openWindow === "function"
      ? openWindow
      : (await import("./intel-window.js")).openIntelWindow;
    await resolvedOpenWindow(view, {
      mode: "edit",
      onSave: saveRecallKnowledgeIntel,
      onResetAttempts: resetRecallKnowledgeAttemptsForTarget,
    });
    return true;
  } catch (error) {
    globalThis.console?.warn?.(`${MODULE_ID} | Failed to open Recall Knowledge intel`, error);
    globalThis.ui?.notifications?.warn?.(t("Intel.OpenFailed", "Could not open Recall Knowledge intel."));
    return false;
  }
}

const DEGREE_LABELS = {
  criticalsuccess: "Critical Success",
  success: "Success",
  failure: "Failure",
  criticalfailure: "Critical Failure",
};
const CHAT_DEGREE_CLASSES = [
  "is-applicable",
  "is-lore-result",
  ...Object.keys(DEGREE_LABELS).flatMap((outcome) => [
    `rk-degree-${outcome}`,
    `rk-broad-${outcome}`,
    `rk-specific-${outcome}`,
  ]),
];
const recallKnowledgeChatDecorations = new Map();
let recallKnowledgeChatHooksRegistered = false;

function recallKnowledgeDcResults(row, matrix, dieResult) {
  const entry = (kind, label, dc) => Number.isFinite(dc) ? {
    kind,
    label,
    dc,
    outcome: recallKnowledgeDegreeFromTotal(row?.total, dc, dieResult),
  } : null;
  if (row?.kind === "lore") {
    return [
      entry("broad", "Broad", matrix?.broadLoreDc),
      entry("specific", "Specific", matrix?.specificLoreDc),
    ].filter(Boolean);
  }
  return matrix?.skills?.includes?.(row?.slug)
    ? [entry("standard", "", matrix?.standardDc)].filter(Boolean)
    : [];
}

function recallKnowledgeDegreeClasses(results) {
  if (!results.length) return "";
  if (results.length === 1) return `is-applicable rk-degree-${results[0].outcome}`;
  return `is-applicable is-lore-result ${results
    .map((result) => `rk-${result.kind}-${result.outcome}`)
    .join(" ")}`;
}

export function recallKnowledgeCalculatedOutcomes(rows, matrix, dieResult) {
  const sourcesByOutcome = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const result of recallKnowledgeDcResults(row, matrix, dieResult)) {
      if (!DEGREE_LABELS[result.outcome]) continue;
      const source = result.kind === "standard"
        ? `${row.label} vs standard DC ${result.dc}`
        : `${row.label} vs ${result.label.toLowerCase()} Lore DC ${result.dc}`;
      const sources = sourcesByOutcome.get(result.outcome) ?? [];
      sources.push(source);
      sourcesByOutcome.set(result.outcome, sources);
    }
  }
  return Object.keys(DEGREE_LABELS)
    .filter((outcome) => sourcesByOutcome.has(outcome))
    .map((outcome) => ({
      outcome,
      label: DEGREE_LABELS[outcome],
      sources: sourcesByOutcome.get(outcome),
    }));
}

export function recallKnowledgeChatRowDecorations(rows, matrix, dieResult) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const results = recallKnowledgeDcResults(row, matrix, dieResult);
    return {
      slug: row.slug,
      classes: recallKnowledgeDegreeClasses(results).split(/\s+/).filter(Boolean),
      tooltip: results
        .map((result) => `${result.label || row.label}: ${DEGREE_LABELS[result.outcome] ?? result.outcome}`)
        .join("; "),
    };
  });
}

function decorateRecallKnowledgeChatElement(element, decorations) {
  const card = element?.matches?.(".pf2e-combater-rk-roll")
    ? element
    : element?.querySelector?.(".pf2e-combater-rk-roll");
  if (!card) return false;
  const bySlug = new Map(decorations.map((entry) => [String(entry.slug), entry]));
  for (const row of card.querySelectorAll?.("tr[data-skill]") ?? []) {
    row.classList.remove(...CHAT_DEGREE_CLASSES);
    const decoration = bySlug.get(String(row.dataset?.skill ?? ""));
    if (!decoration) continue;
    if (decoration.classes.length) row.classList.add(...decoration.classes);
    if (decoration.tooltip) row.dataset.tooltip = decoration.tooltip;
    else delete row.dataset.tooltip;
  }
  return true;
}

function messageId(message) {
  return String(message?.id ?? message?._id ?? "");
}

function decorateVisibleRecallKnowledgeMessage(id, decorations) {
  const elements = globalThis.document?.querySelectorAll?.("[data-message-id]") ?? [];
  for (const element of elements) {
    if (String(element?.dataset?.messageId ?? "") === id) {
      decorateRecallKnowledgeChatElement(element, decorations);
    }
  }
}

export function setRecallKnowledgeChatDegreeColors(message, { rows, matrix, dieResult } = {}) {
  if (globalThis.game?.user?.isGM !== true) return false;
  const id = messageId(message);
  if (!id) return false;
  const decorations = recallKnowledgeChatRowDecorations(rows, matrix, dieResult);
  recallKnowledgeChatDecorations.set(id, decorations);
  decorateVisibleRecallKnowledgeMessage(id, decorations);
  return true;
}

export function registerRecallKnowledgeChatHooks() {
  if (recallKnowledgeChatHooksRegistered || typeof globalThis.Hooks?.on !== "function") return false;
  globalThis.Hooks.on("renderChatMessageHTML", (message, html) => {
    if (globalThis.game?.user?.isGM !== true) return;
    const decorations = recallKnowledgeChatDecorations.get(messageId(message));
    if (decorations) decorateRecallKnowledgeChatElement(html, decorations);
  });
  globalThis.Hooks.on("deleteChatMessage", (message) => {
    recallKnowledgeChatDecorations.delete(messageId(message));
  });
  recallKnowledgeChatHooksRegistered = true;
  return true;
}

function recallKnowledgeDcHtml(results) {
  if (!results.length) return "-";
  return results.map((result) => {
    const outcomeLabel = DEGREE_LABELS[result.outcome] ?? "";
    const label = [result.label, result.dc].filter((part) => part !== "").join(" ");
    const tooltip = [result.label ? `${result.label} Lore DC ${result.dc}` : `DC ${result.dc}`, outcomeLabel]
      .filter(Boolean)
      .join(": ");
    return `<span class="rk-dc-chip rk-degree-${escapeHtml(result.outcome)}" data-tooltip="${escapeHtml(tooltip)}">${escapeHtml(label)}</span>`;
  }).join(" ");
}

function recallKnowledgeCalculatedOutcomeHtml(calculatedOutcomes) {
  if (!calculatedOutcomes.length) return "";
  const singular = calculatedOutcomes.length === 1;
  const rows = calculatedOutcomes.map((entry) => `<li>
    <span class="rk-calculated-degree rk-degree-${escapeHtml(entry.outcome)}">${escapeHtml(entry.label)}</span>
    <span>${escapeHtml(entry.sources.join("; "))}</span>
  </li>`).join("");
  return `<aside class="rk-calculated-outcomes" aria-label="Calculated Recall Knowledge outcome">
    <p><strong>${singular ? "Calculated roll outcome" : "Calculated roll outcomes"}:</strong>
      ${singular ? escapeHtml(calculatedOutcomes[0].label) : "Depends on skill and Lore applicability."}</p>
    <ul>${rows}</ul>
  </aside>`;
}

function recallKnowledgeOutcomeContent({ actor, target, question, rows, dieResult, matrix }) {
  const questionLabel = recallKnowledgeQuestion(question)?.label ?? question ?? "Recall Knowledge";
  const standardSkills = (matrix?.skills ?? []).map((slug) => {
    const row = rows.find((entry) => entry.slug === slug);
    return row?.label ?? slug;
  }).join(", ");
  const body = rows.map((row) => {
    const dcResults = recallKnowledgeDcResults(row, matrix, dieResult);
    const degreeSummary = dcResults
      .map((result) => `${result.label || row.label}: ${DEGREE_LABELS[result.outcome] ?? result.outcome}`)
      .join("; ");
    return `<tr class="${recallKnowledgeDegreeClasses(dcResults)}"${degreeSummary ? ` data-tooltip="${escapeHtml(degreeSummary)}"` : ""}>
      <td>${escapeHtml(row.label)}</td>
      <td class="rank-${Math.max(0, Math.min(4, Number(row.rank) || 0))}">${escapeHtml(row.rankLabel)}</td>
      <td>${escapeHtml(row.modifierLabel)}</td>
      <td><strong>${escapeHtml(row.total)}</strong></td>
      <td>${recallKnowledgeDcHtml(dcResults)}</td>
    </tr>`;
  }).join("");
  const calculatedOutcomes = recallKnowledgeCalculatedOutcomes(rows, matrix, dieResult);
  return `<div class="pf2e-combater-rk-adjudication">
    <p><strong>${escapeHtml(actor?.name)}</strong> recalls knowledge about <strong>${escapeHtml(target?.name)}</strong>.</p>
    <p>Question: ${escapeHtml(questionLabel)}. Attempt ${escapeHtml(matrix?.attempt)}. d20: <strong>${escapeHtml(dieResult)}</strong>.</p>
    <p>Applicable standard skills: ${escapeHtml(standardSkills || "None")}. Standard DC: <strong>${escapeHtml(matrix?.standardDc ?? "-")}</strong>.</p>
    <p>Lore DCs: broad <strong>${escapeHtml(matrix?.broadLoreDc ?? "-")}</strong>; specific <strong>${escapeHtml(matrix?.specificLoreDc ?? "-")}</strong>.</p>
    <table><thead><tr><th>Skill</th><th>Proficiency</th><th>Mod.</th><th>Result</th><th>DC</th></tr></thead><tbody>${body}</tbody></table>
    ${recallKnowledgeCalculatedOutcomeHtml(calculatedOutcomes)}
    <p>Select final degree of success. Highlighted buttons match the calculated roll; the GM can override for applicability.</p>
  </div>`;
}

export function promptRecallKnowledgeOutcome(details) {
  const calculatedOutcomes = recallKnowledgeCalculatedOutcomes(details?.rows, details?.matrix, details?.dieResult);
  const calculatedIds = new Set(calculatedOutcomes.map((entry) => entry.outcome));
  return buttonChoice({
    title: t("RecallKnowledge.OutcomeTitle", "Recall Knowledge Outcome"),
    content: recallKnowledgeOutcomeContent(details),
    contentIsHtml: true,
    classes: ["pf2e-combater-rk-outcome-dialog"],
    choices: Object.entries(DEGREE_LABELS).map(([id, label]) => ({
      id,
      label,
      ...(calculatedIds.has(id) ? {
        class: `rk-calculated-outcome rk-degree-${id}`,
        icon: "fa-solid fa-dice-d20",
      } : {}),
    })),
  });
}

async function resolveOutcome(payload) {
  const message = payload.messageId ? globalThis.game?.messages?.get?.(payload.messageId) : null;
  let outcome = normalizeRecallKnowledgeOutcome(recallKnowledgeOutcomeFromMessage(message, {
    skill: payload.skill,
    skillLabel: payload.skillLabel,
    dc: payload.dc,
    attempt: payload.attempt,
  }));
  if (outcome) return outcome;
  const choice = await buttonChoice({
    title: t("RecallKnowledge.OutcomeTitle", "Recall Knowledge Outcome"),
    content: t("RecallKnowledge.OutcomeMissing", "Roll outcome could not be read automatically. Choose the result shown in chat."),
    choices: [
      { id: "criticalsuccess", label: "Critical Success" },
      { id: "success", label: "Success" },
      { id: "failure", label: "Failure" },
      { id: "criticalfailure", label: "Critical Failure" },
    ],
  });
  outcome = normalizeRecallKnowledgeOutcome(choice?.id);
  return outcome;
}

function actorHasDubiousKnowledge(actor) {
  const feats = [
    ...collectionValues(actor?.itemTypes?.feat),
    ...collectionValues(actor?.items),
  ];
  return feats.some((item) => String(item?.slug ?? item?.system?.slug ?? "").toLowerCase() === "dubious-knowledge");
}

export async function adjudicateRecallKnowledgeRequest(payload = {}, {
  openIntel = openRecallKnowledgeIntelWindow,
} = {}) {
  if (globalThis.game?.user?.isGM !== true) return null;
  const actor = await documentFromUuid(payload.actorUuid);
  const target = await documentFromUuid(payload.targetActorUuid);
  if (!actor || !target) return { completed: false, reason: "Recall Knowledge actor or target is unavailable." };
  const outcome = normalizeRecallKnowledgeOutcome(payload.outcome) ?? await resolveOutcome(payload);
  if (!outcome) return { completed: false, reason: "Recall Knowledge outcome was not adjudicated." };
  const message = payload.messageId ? globalThis.game?.messages?.get?.(payload.messageId) : null;
  const dubiousKnowledge = outcome === "failure"
    && (actorHasDubiousKnowledge(actor) || recallKnowledgeHasDubiousKnowledge(message));

  await recordRecallKnowledgeAttempt(actor, target, {
    outcome,
    skill: payload.skill,
    question: payload.question,
  });

  if (outcome === "failure") {
    if (dubiousKnowledge) {
      globalThis.ui?.notifications?.warn?.(t(
        "RecallKnowledge.DubiousKnowledgeGM",
        "Dubious Knowledge: give one correct and one erroneous answer manually. Planner Intel stays unchanged so it cannot reveal which answer is true.",
      ));
    }
    return { completed: true, revealed: 0, dubiousKnowledge };
  }
  if (outcome === "criticalfailure") {
    await openIntel(target, {
      preselectIdentity: false,
      falseInformationContext: {
        actorUuid: actor.uuid,
        actorName: actor.name ?? payload.actorName,
        category: recallKnowledgeQuestion(payload.question)?.categories?.[0] ?? "traits",
        question: payload.question,
        attempt: payload.attempt,
      },
    });
    return { completed: true, revealed: 0 };
  }

  await openIntel(target);
  return { completed: true, revealed: 0 };
}

function requesterCanUseRollMessage(message, actor, requesterId) {
  if (!message || !actor || !isRecallKnowledgeMatrixMessage(message)) return false;
  const requester = globalThis.game?.users?.get?.(requesterId)
    ?? (globalThis.game?.user?.id === requesterId ? globalThis.game.user : null);
  const authorId = message?.author?.id ?? message?.user?.id ?? message?.user ?? null;
  const speakerActorId = message?.speaker?.actor ?? null;
  if (speakerActorId && String(speakerActorId) !== String(actor.id)) return false;
  return requester?.isGM === true || String(authorId ?? "") === String(requesterId ?? "");
}

export async function resolveRecallKnowledgeRequest(payload = {}) {
  if (globalThis.game?.user?.isGM !== true) return null;
  const requesterId = this?.socketdata?.userId ?? globalThis.game.user?.id;
  const requestedActor = await documentFromUuid(payload.actorUuid);
  if (!requesterCanUseActor(requestedActor, requesterId)) {
    return { completed: false, reason: "Recall Knowledge requester does not own this actor." };
  }

  const actor = requestedActor;
  const target = await documentFromUuid(payload.targetActorUuid);
  if (!target) return { completed: false, reason: "Recall Knowledge target is unavailable." };
  const matrix = recallKnowledgeDcMatrix(actor, target);
  if (!matrix.allowed) return { completed: false, reason: matrix.reason };

  const message = payload.messageId ? globalThis.game?.messages?.get?.(payload.messageId) : null;
  if (!requesterCanUseRollMessage(message, actor, requesterId)) {
    return { completed: false, reason: "Recall Knowledge roll message is unavailable or unauthorized." };
  }
  const dieResult = recallKnowledgeDieResultFromMessage(message);
  if (!Number.isInteger(dieResult)) return { completed: false, reason: "Recall Knowledge d20 result is unavailable." };
  const rows = recallKnowledgeRollRows(actor, dieResult, { target });
  setRecallKnowledgeChatDegreeColors(message, { rows, matrix, dieResult });
  const choice = await promptRecallKnowledgeOutcome({
    actor,
    target,
    question: payload.question,
    rows,
    dieResult,
    matrix,
  });
  const outcome = normalizeRecallKnowledgeOutcome(choice?.id);
  if (!outcome) return { completed: false, reason: "GM did not select a Recall Knowledge outcome." };

  const adjudication = await adjudicateRecallKnowledgeRequest({
    ...payload,
    outcome,
    attempt: matrix.attempt,
    requesterId,
  });
  if (!adjudication?.completed) {
    return { completed: false, reason: adjudication?.reason ?? "GM did not finish Recall Knowledge adjudication." };
  }
  return {
    status: "done",
    completed: true,
    revealed: adjudication.revealed ?? 0,
    dubiousKnowledge: adjudication.dubiousKnowledge === true,
  };
}
