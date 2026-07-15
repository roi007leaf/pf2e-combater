import { MODULE_ID } from "../../constants.js";
import { t } from "../../i18n.js";
import { recallKnowledgeQuestion, recallKnowledgeSkillOptions } from "../../rules/recall-knowledge.js";
import { chatActionRevert, chatMessageIdFromResult } from "./chat-revert.js";
import { executionPatch } from "./results.js";
import { pf2eRuntime } from "../../runtime/pf2e-runtime.js";

function targetActor(target) {
  return target?.actor?.document ?? target?.actor ?? target?.document?.actor ?? target ?? null;
}

const OUTCOMES = ["criticalfailure", "failure", "success", "criticalsuccess"];

function normalizedOutcome(value) {
  if (Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 3) {
    return OUTCOMES[Number(value)];
  }
  const outcome = String(value ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  return OUTCOMES.includes(outcome) ? outcome : null;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function naturalD20(roll) {
  const candidates = [
    roll?.dice?.[0]?.results?.[0]?.result,
    roll?.dice?.[0]?.total,
    roll?.terms?.find?.((term) => Number(term?.faces) === 20)?.results?.[0]?.result,
  ];
  for (const candidate of candidates) {
    const value = numeric(candidate);
    if (Number.isInteger(value) && value >= 1 && value <= 20) return value;
  }
  return null;
}

export function recallKnowledgeDieResultFromMessage(message) {
  const roll = message?.rolls?.[0] ?? null;
  return naturalD20(roll) ?? (() => {
    const total = numeric(roll?.total);
    return Number.isInteger(total) && total >= 1 && total <= 20 ? total : null;
  })();
}

export function recallKnowledgeDegreeFromTotal(totalValue, dcValue, dieValue = null) {
  const total = numeric(totalValue);
  const dc = numeric(dcValue);
  if (total === null || dc === null) return null;
  let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  const die = numeric(dieValue);
  if (die === 20) degree = Math.min(3, degree + 1);
  if (die === 1) degree = Math.max(0, degree - 1);
  return OUTCOMES[degree];
}

function textOnly(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedSkillName(value) {
  return textOnly(value)
    .toLowerCase()
    .replace(/\blore\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function hudSkillTotalsFromHtml(flavor) {
  const totals = [];
  const pattern = /<span\b[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>([\s\S]{0,900}?)<u\b[^>]*class=["'][^"']*\bsuccess\b[^"']*["'][^>]*>\s*(-?\d+)\s*<\/u>/gi;
  for (const match of String(flavor ?? "").matchAll(pattern)) {
    const name = textOnly(match[1]);
    const total = numeric(match[3]);
    if (name && total !== null) totals.push({ name, total });
  }
  return totals;
}

function hudSkillTotal(message, { skill, skillLabel } = {}) {
  const flavor = String(message?.flavor ?? "");
  if (!flavor.includes("pf2e-hud-rk")) return null;
  const requested = new Set([skill, skillLabel].map(normalizedSkillName).filter(Boolean));
  if (!requested.size) return null;
  const match = hudSkillTotalsFromHtml(flavor)
    .find((entry) => requested.has(normalizedSkillName(entry.name)));
  return match?.total ?? null;
}

function coreCheckTotal(message) {
  const rollTotal = numeric(message?.rolls?.[0]?.total);
  if (rollTotal !== null && !String(message?.flavor ?? "").includes("pf2e-hud-rk")) return rollTotal;
  const content = textOnly(message?.content);
  return /^-?\d+$/.test(content) ? numeric(content) : null;
}

export function recallKnowledgeHasDubiousKnowledge(message) {
  return /\bDubious Knowledge\b/i.test(textOnly(message?.flavor));
}

export function recallKnowledgeOutcomeFromMessage(message, options = {}) {
  const structured = message?.flags?.pf2e?.context?.outcome
    ?? message?.flags?.pf2e?.outcome
    ?? message?.rolls?.[0]?.options?.degreeOfSuccess;
  const outcome = normalizedOutcome(structured);
  if (outcome) return outcome;

  const roll = message?.rolls?.[0] ?? null;
  const hudTotal = hudSkillTotal(message, options);
  if (hudTotal !== null) {
    const hudDie = naturalD20(roll) ?? numeric(roll?.total);
    return recallKnowledgeDegreeFromTotal(hudTotal, options.dc, hudDie);
  }
  return recallKnowledgeDegreeFromTotal(coreCheckTotal(message), options.dc, naturalD20(roll));
}

function escapeHtml(value) {
  const text = String(value ?? "");
  if (globalThis.foundry?.utils?.escapeHTML) return globalThis.foundry.utils.escapeHTML(text);
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function signed(value) {
  const number = Number(value) || 0;
  return number >= 0 ? `+${number}` : String(number);
}

function rankLabel(rank) {
  const value = Math.max(0, Math.min(4, Number(rank) || 0));
  const key = `PF2E.ProficiencyLevel${value}`;
  const localized = globalThis.game?.i18n?.localize?.(key);
  if (localized && localized !== key) return localized;
  return ["Untrained", "Trained", "Expert", "Master", "Legendary"][value];
}

function targetMarkRollOptions(actor, target) {
  const targetDocument = targetActor(target);
  const token = targetDocument?.token
    ?? target?.document
    ?? targetDocument?.getActiveTokens?.(true, true)?.[0]?.document
    ?? target
    ?? null;
  const uuid = token?.uuid;
  const marks = uuid ? pf2eRuntime.readActor(actor).tokenMarks?.get?.(uuid) : null;
  return Array.from(marks ?? []).map((mark) => `target:mark:${mark}`);
}

function statisticForActor(actor, slug) {
  return actor?.getStatistic?.(slug) ?? actor?.skills?.[slug] ?? null;
}

export function recallKnowledgeRollRows(actor, dieResult, { target = null } = {}) {
  const die = Number(dieResult);
  if (!actor || !Number.isInteger(die) || die < 1 || die > 20) return [];
  const marks = targetMarkRollOptions(actor, target);
  return recallKnowledgeSkillOptions(actor).flatMap((option) => {
    const statistic = statisticForActor(actor, option.slug);
    if (!statistic) return [];
    const rank = Number(statistic.rank ?? statistic.proficient ?? 0) || 0;
    const extraRollOptions = [
      "action:recall-knowledge",
      "skill-check",
      `skill:rank:${rank}`,
      `action:recall-knowledge:${option.slug}`,
      ...marks,
    ];
    let contextual = statistic;
    try {
      contextual = statistic.withRollOptions?.({ extraRollOptions }) ?? statistic;
    } catch (_error) {
      contextual = statistic;
    }
    const check = contextual?.check ?? statistic?.check ?? contextual;
    const modifier = Number(check?.mod ?? contextual?.mod ?? statistic?.mod ?? 0) || 0;
    return [{
      slug: option.slug,
      label: option.label,
      kind: option.kind,
      rank,
      rankLabel: rankLabel(rank),
      modifier,
      modifierLabel: signed(modifier),
      total: die + modifier,
      tooltip: String(check?.breakdown ?? contextual?.breakdown ?? ""),
    }];
  });
}

export function recallKnowledgeRollFlavor({ actor, target, question, rows, dieResult } = {}) {
  const questionLabel = recallKnowledgeQuestion(question)?.label ?? "Recall Knowledge";
  const rowHtml = (Array.isArray(rows) ? rows : []).map((row) => `
    <tr data-skill="${escapeHtml(row.slug)}" data-kind="${escapeHtml(row.kind)}">
      <td>${escapeHtml(row.label)}</td>
      <td class="rank-${Number(row.rank) || 0}">${escapeHtml(row.rankLabel)}</td>
      <td data-tooltip="${escapeHtml(row.tooltip)}">${escapeHtml(row.modifierLabel)}</td>
      <td><strong>${escapeHtml(row.total)}</strong></td>
    </tr>`).join("");
  return `<div class="pf2e-combater-rk-roll">
    <h4><i class="fa-solid fa-brain"></i> ${escapeHtml(t("RecallKnowledge.Title", "Recall Knowledge"))}</h4>
    <div class="rk-meta"><span>${escapeHtml(actor?.name ?? "")}</span><span>${escapeHtml(targetActor(target)?.name ?? target?.name ?? "")}</span></div>
    <div class="rk-question">${escapeHtml(questionLabel)}</div>
    <div class="tags"><span class="tag">${escapeHtml(t("RecallKnowledge.Secret", "Secret"))}</span><span class="tag">${escapeHtml(t("RecallKnowledge.Concentrate", "Concentrate"))}</span></div>
    <table><thead><tr><th>Skill</th><th>Proficiency</th><th>Mod.</th><th>Result</th></tr></thead><tbody>${rowHtml}</tbody></table>
    <div class="rk-die"><span>1d20</span><strong>${escapeHtml(dieResult)}</strong></div>
  </div>`;
}

function gmWhisperRecipients() {
  return (globalThis.ChatMessage?.getWhisperRecipients?.("GM") ?? [])
    .map((user) => user?.id ?? user)
    .filter(Boolean);
}

export function isRecallKnowledgeMatrixMessage(message) {
  return message?.flags?.[MODULE_ID]?.recallKnowledgeRoll === true
    || String(message?.flavor ?? "").includes("pf2e-combater-rk-roll");
}

export async function rollRecallKnowledge({ actor, target, question = "notable" } = {}) {
  const RollClass = globalThis.Roll;
  const ChatMessageClass = globalThis.getDocumentClass?.("ChatMessage") ?? globalThis.ChatMessage;
  if (!actor || !targetActor(target) || typeof RollClass !== "function" || typeof ChatMessageClass?.create !== "function") {
    const error = t("RecallKnowledge.NativeUnavailable", "Foundry Recall Knowledge roll is unavailable.");
    return { status: "failed", patch: executionPatch({}, "failed", { error }), error };
  }

  const roll = await new RollClass("1d20").evaluate({ allowInteractive: false });
  const dieResult = naturalD20(roll) ?? numeric(roll?.total);
  if (!Number.isInteger(dieResult) || dieResult < 1 || dieResult > 20) {
    const error = t("RecallKnowledge.DieUnavailable", "Recall Knowledge d20 result is unavailable.");
    return { status: "failed", patch: executionPatch({}, "failed", { error }), error };
  }
  const rows = recallKnowledgeRollRows(actor, dieResult, { target });
  const message = await ChatMessageClass.create({
    speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? {},
    flavor: recallKnowledgeRollFlavor({ actor, target, question, rows, dieResult }),
    blind: true,
    whisper: gmWhisperRecipients(),
    rolls: [roll],
    flags: {
      [MODULE_ID]: {
        recallKnowledgeRoll: true,
      },
    },
  });
  const messageId = chatMessageIdFromResult({ message }) ?? message?.id ?? message?._id ?? null;
  const revert = chatActionRevert({ message }, { slug: "recall-knowledge", name: "Recall Knowledge" });
  if (revert) {
    revert.manualWarnings = [
      ...(revert.manualWarnings ?? []),
      t(
        "RecallKnowledge.ManualUndo",
        "Recall Knowledge attempt state and revealed Intel must be undone manually by the GM.",
      ),
    ];
  }
  return {
    status: "done",
    dieResult,
    rows,
    messageId,
    patch: executionPatch({}, "done", {
      result: t("RecallKnowledge.Resolved", "Recall Knowledge rolled; GM adjudication completed."),
      revert,
    }),
  };
}
