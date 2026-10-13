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

async function buttonChoice({ title, content, choices, contentIsHtml = false, classes = [], icon = null, width = null, render = null }) {
  const dialog = dialogApi();
  if (typeof dialog?.wait !== "function") return null;
  const options = {
    window: { title, ...(icon ? { icon } : {}) },
    ...(width ? { position: { width, height: "auto" } } : {}),
    ...(typeof render === "function" ? { render } : {}),
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

const DEGREE_ORDER = ["criticalfailure", "failure", "success", "criticalsuccess"];
const DEGREE_SHORT = {
  criticalsuccess: () => t("RecallKnowledge.DegreeShort.CriticalSuccess", "Crit success"),
  success: () => t("RecallKnowledge.DegreeShort.Success", "Success"),
  failure: () => t("RecallKnowledge.DegreeShort.Failure", "Fail"),
  criticalfailure: () => t("RecallKnowledge.DegreeShort.CriticalFailure", "Crit fail"),
};

function dcLabel(result) {
  return result.kind === "standard"
    ? t("RecallKnowledge.DcStandard", "DC {dc}", { dc: result.dc })
    : t("RecallKnowledge.DcLore", "{kind} {dc}", { kind: result.label, dc: result.dc });
}

function suggestionText(row, result) {
  return result.kind === "standard"
    ? t("RecallKnowledge.SuggestStandard", "{skill} {total} vs DC {dc}", { skill: row.label, total: row.total, dc: result.dc })
    : t("RecallKnowledge.SuggestLore", "{skill} {total} vs {kind} Lore DC {dc}", { skill: row.label, total: row.total, kind: result.label.toLowerCase(), dc: result.dc });
}

// The GM's decision, laid out: the three DCs, only the checks that apply (best first, each with a
// button per DC it can be checked against), the rest collapsed, and a suggested outcome from the
// best applicable result. Pure, so it can be tested without Foundry.
export function recallKnowledgeOutcomeView({ actor, target, question, rows, dieResult, matrix } = {}) {
  const allRows = Array.isArray(rows) ? rows : [];
  const checks = allRows.map((row) => {
    const results = recallKnowledgeDcResults(row, matrix, dieResult).filter((result) => DEGREE_LABELS[result.outcome]);
    const best = results.reduce((top, result) => (!top || DEGREE_ORDER.indexOf(result.outcome) > DEGREE_ORDER.indexOf(top.outcome) ? result : top), null);
    return { row, results, best };
  }).filter((entry) => entry.results.length);
  checks.sort((left, right) => DEGREE_ORDER.indexOf(right.best.outcome) - DEGREE_ORDER.indexOf(left.best.outcome)
    || (Number(right.row.total) || 0) - (Number(left.row.total) || 0));
  const top = checks[0] ?? null;
  const applicable = new Set(checks.map((entry) => entry.row.slug));
  const standardSkills = (matrix?.skills ?? []).map((slug) => allRows.find((entry) => entry.slug === slug)?.label ?? slug);
  return {
    actorName: actor?.name ?? "",
    targetName: target?.name ?? "",
    question: recallKnowledgeQuestion(question)?.label ?? question ?? "Recall Knowledge",
    attempt: matrix?.attempt ?? 1,
    dieResult,
    dcs: [
      Number.isFinite(matrix?.standardDc) ? { label: standardSkills.join(", ") || t("RecallKnowledge.Standard", "Standard"), dc: matrix.standardDc, note: t("RecallKnowledge.StandardNote", "standard") } : null,
      Number.isFinite(matrix?.broadLoreDc) ? { label: t("RecallKnowledge.BroadLore", "Broad Lore"), dc: matrix.broadLoreDc } : null,
      Number.isFinite(matrix?.specificLoreDc) ? { label: t("RecallKnowledge.SpecificLore", "Specific Lore"), dc: matrix.specificLoreDc } : null,
    ].filter(Boolean),
    checks: checks.map((entry, index) => ({
      slug: entry.row.slug,
      label: entry.row.label,
      rank: Math.max(0, Math.min(4, Number(entry.row.rank) || 0)),
      rankLabel: entry.row.rankLabel,
      modifierLabel: entry.row.modifierLabel,
      total: entry.row.total,
      best: index === 0,
      dcs: entry.results.map((result) => ({
        kind: result.kind,
        dc: result.dc,
        outcome: result.outcome,
        label: `${dcLabel(result)} · ${DEGREE_SHORT[result.outcome]()}`,
        picked: index === 0 && result === entry.best,
        suggestion: suggestionText(entry.row, result),
      })),
    })),
    other: allRows.filter((row) => !applicable.has(row.slug)).map((row) => row.label),
    suggestion: top ? { outcome: top.best.outcome, label: DEGREE_LABELS[top.best.outcome], text: suggestionText(top.row, top.best) } : null,
  };
}

export function recallKnowledgeOutcomeContent(details) {
  const view = recallKnowledgeOutcomeView(details);
  const dcCards = view.dcs.map((entry) => `<div class="rk-dc-card"><small>${escapeHtml(entry.label)}</small>
      <b>DC ${escapeHtml(entry.dc)}</b>${entry.note ? ` <span>${escapeHtml(entry.note)}</span>` : ""}</div>`).join("");
  const checks = view.checks.map((check) => `<div class="rk-check${check.best ? " is-best" : ""}" data-rk-check="${escapeHtml(check.slug)}">
      <span class="rk-check-name"><strong>${escapeHtml(check.label)}</strong>
        <span class="rk-rank rank-${check.rank}">${escapeHtml(check.rankLabel)}</span>
        ${check.best ? `<span class="rk-best-tag">${escapeHtml(t("RecallKnowledge.Best", "Best"))}</span>` : ""}</span>
      <span class="rk-check-total"><b>${escapeHtml(check.total)}</b><small>${escapeHtml(check.modifierLabel)}</small></span>
      <span class="rk-check-dcs">${check.dcs.map((dc) => `<button type="button" class="rk-dc-pick rk-degree-${escapeHtml(dc.outcome)}${dc.picked ? " is-picked" : ""}"
          data-rk-pick data-outcome="${escapeHtml(dc.outcome)}" data-suggestion="${escapeHtml(dc.suggestion)}"
          aria-pressed="${dc.picked ? "true" : "false"}">${dc.picked ? '<i class="fa-solid fa-check"></i> ' : ""}${escapeHtml(dc.label)}</button>`).join("")}</span>
    </div>`).join("");
  const other = view.other.length
    ? `<details class="rk-other"><summary>${escapeHtml(t("RecallKnowledge.OtherSkills", "{count} skills don't apply: {names}", { count: view.other.length, names: view.other.join(", ") }))}</summary></details>`
    : "";
  const suggestion = view.suggestion
    ? `<p class="rk-suggestion" data-rk-suggestion><i class="fa-solid fa-dice-d20"></i>
        <span>${escapeHtml(t("RecallKnowledge.Suggested", "Suggested:"))} <b class="rk-degree-${escapeHtml(view.suggestion.outcome)}" data-rk-suggested-label>${escapeHtml(view.suggestion.label)}</b>
        — <span data-rk-suggested-text>${escapeHtml(view.suggestion.text)}</span></span></p>`
    : `<p class="rk-suggestion">${escapeHtml(t("RecallKnowledge.NoApplicable", "No applicable check. Choose the outcome."))}</p>`;
  return `<div class="pf2e-combater-rk-verdict">
    <div class="rk-who">
      <div class="rk-who-text">
        <strong>${escapeHtml(view.actorName)} → ${escapeHtml(view.targetName)}</strong>
        <span class="rk-chips"><span class="rk-chip">${escapeHtml(view.question)}</span>
          <span class="rk-chip">${escapeHtml(t("RecallKnowledge.Attempt", "Attempt {number}", { number: view.attempt }))}</span></span>
      </div>
      <div class="rk-die"><b>${escapeHtml(view.dieResult)}</b><small>d20</small></div>
    </div>
    ${view.dcs.length ? `<div class="rk-dc-cards">${dcCards}</div>` : ""}
    ${view.checks.length ? `<div class="rk-section-title"><span>${escapeHtml(t("RecallKnowledge.ApplicableChecks", "Applicable checks"))}</span>
      <em>${escapeHtml(t("RecallKnowledge.PickHint", "Click the DC that applies"))}</em></div>
    <div class="rk-checks">${checks}</div>` : ""}
    ${other}
    ${suggestion}
    <p class="rk-gm-hint">${escapeHtml(t("RecallKnowledge.GmHint", "The GM decides which check applies; the outcome is only suggested."))}</p>
  </div>`;
}

// Clicking a DC makes it the applicable check: the suggestion and the highlighted outcome follow.
export function bindRecallKnowledgeVerdict(_event, dialog) {
  const root = dialog?.element ?? dialog;
  const content = root?.querySelector?.(".pf2e-combater-rk-verdict");
  if (!content) return;
  const highlight = (outcome) => {
    for (const button of root.querySelectorAll("footer button[data-action]")) {
      const suggested = button.dataset.action === outcome;
      button.classList.toggle("is-suggested", suggested);
      const icon = button.querySelector(".fa-dice-d20");
      if (suggested && !icon) button.insertAdjacentHTML("afterbegin", '<i class="fa-solid fa-dice-d20"></i> ');
      if (!suggested) icon?.remove();
    }
  };
  for (const pick of content.querySelectorAll("[data-rk-pick]")) {
    pick.addEventListener("click", () => {
      for (const other of content.querySelectorAll("[data-rk-pick]")) {
        const picked = other === pick;
        other.classList.toggle("is-picked", picked);
        other.setAttribute("aria-pressed", picked ? "true" : "false");
        other.querySelector(".fa-check")?.remove();
      }
      pick.insertAdjacentHTML("afterbegin", '<i class="fa-solid fa-check"></i> ');
      const label = content.querySelector("[data-rk-suggested-label]");
      if (label) {
        label.textContent = DEGREE_LABELS[pick.dataset.outcome] ?? pick.dataset.outcome;
        label.className = `rk-degree-${pick.dataset.outcome}`;
      }
      const text = content.querySelector("[data-rk-suggested-text]");
      if (text) text.textContent = pick.dataset.suggestion ?? "";
      highlight(pick.dataset.outcome);
    });
  }
}

export function promptRecallKnowledgeOutcome(details) {
  const calculatedOutcomes = recallKnowledgeCalculatedOutcomes(details?.rows, details?.matrix, details?.dieResult);
  const calculatedIds = new Set(calculatedOutcomes.map((entry) => entry.outcome));
  const suggested = recallKnowledgeOutcomeView(details).suggestion?.outcome ?? null;
  return buttonChoice({
    title: t("RecallKnowledge.OutcomeTitle", "Recall Knowledge Outcome"),
    icon: "fa-solid fa-book-open",
    width: 620,
    content: recallKnowledgeOutcomeContent(details),
    contentIsHtml: true,
    classes: ["pf2e-combater-rk-outcome-dialog"],
    render: bindRecallKnowledgeVerdict,
    choices: Object.entries(DEGREE_LABELS).map(([id, label]) => ({
      id,
      label,
      class: [
        "rk-outcome",
        `rk-degree-${id}`,
        calculatedIds.has(id) ? "rk-calculated-outcome" : "",
        id === suggested ? "is-suggested" : "",
      ].filter(Boolean).join(" "),
      ...(id === suggested ? { icon: "fa-solid fa-dice-d20" } : {}),
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
