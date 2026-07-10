import { MODULE_ID } from "../constants.js";
import { collectionValues } from "../foundry-data.js";

export const RECALL_KNOWLEDGE_ATTEMPTS_FLAG = "recallKnowledgeAttempts";

export const RECALL_KNOWLEDGE_QUESTIONS = [
  { id: "notable", label: "Notable traits", categories: ["traits"] },
  { id: "defenses", label: "Defenses and saves", categories: ["saves", "perception"] },
  { id: "weaknesses", label: "Weaknesses", categories: ["weaknesses"] },
  { id: "protections", label: "Resistances and immunities", categories: ["resistances", "immunities"] },
];

const STANDARD_SKILLS = ["arcana", "computers", "crafting", "medicine", "nature", "occultism", "religion", "society"];

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numeric(value) {
  const number = Number(value?.value ?? value?.dc ?? value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizedOutcome(value) {
  const outcome = String(value ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (["criticalsuccess", "success", "failure", "criticalfailure"].includes(outcome)) return outcome;
  return null;
}

function actorDocument(value) {
  return value?.actor?.document ?? value?.actor ?? value?.document ?? value ?? null;
}

function recallKnowledgeLegacyTargetKey(target) {
  const actor = actorDocument(target);
  return String(actor?.uuid ?? actor?.id ?? target?.uuid ?? target?.id ?? "").trim();
}

export function recallKnowledgeTargetKey(target) {
  const raw = recallKnowledgeLegacyTargetKey(target);
  return raw ? `target:${encodeURIComponent(raw).replaceAll(".", "%2E").replaceAll("$", "%24")}` : "";
}

function normalizeAttemptEntry(value) {
  const data = plainObject(value);
  if (!["attempts", "blocked", "lastOutcome", "lastSkill", "lastQuestion"]
    .some((key) => Object.hasOwn(data, key))) return null;
  return {
    attempts: Math.max(0, Math.floor(Number(data.attempts) || 0)),
    blocked: data.blocked === true,
    lastOutcome: normalizedOutcome(data.lastOutcome),
    lastSkill: String(data.lastSkill ?? "").trim(),
    lastQuestion: String(data.lastQuestion ?? "").trim(),
  };
}

export function normalizeRecallKnowledgeAttempts(value) {
  const source = plainObject(value);
  return Object.fromEntries(Object.entries(source).flatMap(([key, entry]) => {
    const id = String(key ?? "").trim();
    const normalized = normalizeAttemptEntry(entry);
    return id && normalized ? [[id, normalized]] : [];
  }));
}

function rawRecallKnowledgeAttempts(actor) {
  return actor?.getFlag?.(MODULE_ID, RECALL_KNOWLEDGE_ATTEMPTS_FLAG)
    ?? actor?.flags?.[MODULE_ID]?.[RECALL_KNOWLEDGE_ATTEMPTS_FLAG];
}

function legacyAttemptEntry(value, target) {
  const source = plainObject(value);
  const rawKey = recallKnowledgeLegacyTargetKey(target);
  if (!rawKey) return null;
  if (Object.hasOwn(source, rawKey)) return normalizeAttemptEntry(source[rawKey]);
  const nested = rawKey.split(".").reduce(
    (current, part) => plainObject(current)[part],
    source,
  );
  return normalizeAttemptEntry(nested);
}

export function readRecallKnowledgeAttempts(actor) {
  return normalizeRecallKnowledgeAttempts(rawRecallKnowledgeAttempts(actor));
}

export function recallKnowledgeAttemptState(actor, target) {
  const raw = rawRecallKnowledgeAttempts(actor);
  const attempts = normalizeRecallKnowledgeAttempts(raw);
  return attempts[recallKnowledgeTargetKey(target)]
    ?? attempts[recallKnowledgeLegacyTargetKey(target)]
    ?? legacyAttemptEntry(raw, target)
    ?? {
    attempts: 0,
    blocked: false,
    lastOutcome: null,
    lastSkill: "",
    lastQuestion: "",
  };
}

export function nextRecallKnowledgeAttempts(value, target, { outcome, skill = "", question = "" } = {}) {
  const attempts = normalizeRecallKnowledgeAttempts(value);
  const key = recallKnowledgeTargetKey(target);
  const legacyKey = recallKnowledgeLegacyTargetKey(target);
  const result = normalizedOutcome(outcome);
  if (!key || !result) return attempts;
  const previous = attempts[key]
    ?? attempts[legacyKey]
    ?? legacyAttemptEntry(value, target)
    ?? { attempts: 0, blocked: false };
  if (legacyKey !== key) delete attempts[legacyKey];
  return {
    ...attempts,
    [key]: {
      attempts: previous.attempts + 1,
      blocked: previous.blocked === true || result === "failure" || result === "criticalfailure",
      lastOutcome: result,
      lastSkill: String(skill ?? "").trim(),
      lastQuestion: String(question ?? "").trim(),
    },
  };
}

async function replaceRecallKnowledgeAttempts(actor, current, next) {
  if (typeof actor?.setFlag !== "function") return false;
  if (current !== undefined && current !== null && typeof actor?.unsetFlag === "function") {
    await actor.unsetFlag(MODULE_ID, RECALL_KNOWLEDGE_ATTEMPTS_FLAG);
  }
  if (Object.keys(next).length > 0) {
    await actor.setFlag(MODULE_ID, RECALL_KNOWLEDGE_ATTEMPTS_FLAG, next);
  } else if (typeof actor?.unsetFlag !== "function") {
    await actor.setFlag(MODULE_ID, RECALL_KNOWLEDGE_ATTEMPTS_FLAG, next);
  }
  return true;
}

export async function recordRecallKnowledgeAttempt(actor, target, details = {}) {
  const current = rawRecallKnowledgeAttempts(actor);
  const next = nextRecallKnowledgeAttempts(current, target, details);
  await replaceRecallKnowledgeAttempts(actor, current, next);
  return next;
}

export function resetRecallKnowledgeAttempts(value, target) {
  const attempts = normalizeRecallKnowledgeAttempts(value);
  const key = recallKnowledgeTargetKey(target);
  const legacyKey = recallKnowledgeLegacyTargetKey(target);
  if (key) delete attempts[key];
  if (legacyKey) delete attempts[legacyKey];
  return attempts;
}

export async function resetRecallKnowledgeAttempt(actor, target) {
  const raw = rawRecallKnowledgeAttempts(actor);
  const attempts = normalizeRecallKnowledgeAttempts(raw);
  const key = recallKnowledgeTargetKey(target);
  const legacyKey = recallKnowledgeLegacyTargetKey(target);
  const tracked = Boolean(
    (key && Object.hasOwn(attempts, key))
    || (legacyKey && Object.hasOwn(attempts, legacyKey))
    || legacyAttemptEntry(raw, target),
  );
  if (!tracked || typeof actor?.setFlag !== "function") return false;
  await replaceRecallKnowledgeAttempts(actor, raw, resetRecallKnowledgeAttempts(raw, target));
  return true;
}

function statisticLabel(actor, slug, fallback) {
  const statistic = typeof actor?.getStatistic === "function" ? actor.getStatistic(slug) : null;
  return String(statistic?.label ?? fallback ?? slug).trim();
}

function loreSlug(item) {
  return String(item?.slug ?? item?.system?.slug ?? item?.system?.proficient?.slug ?? item?.name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function recallKnowledgeSkillOptions(actor) {
  const options = [];
  for (const slug of STANDARD_SKILLS) {
    const statistic = typeof actor?.getStatistic === "function" ? actor.getStatistic(slug) : actor?.skills?.[slug];
    if (!statistic) continue;
    options.push({ slug, label: statisticLabel(actor, slug, slug), kind: "standard" });
  }
  for (const lore of collectionValues(actor?.itemTypes?.lore)) {
    const slug = loreSlug(lore);
    if (!slug || options.some((entry) => entry.slug === slug)) continue;
    options.push({ slug, label: String(lore?.name ?? statisticLabel(actor, slug, slug)), kind: "lore" });
  }
  return options;
}

function progressionValue(progression, attemptIndex) {
  const values = Array.isArray(progression) ? progression : [];
  return numeric(values[attemptIndex]);
}

export function recallKnowledgeDcMatrix(actor, target) {
  const targetActor = actorDocument(target);
  const identification = targetActor?.identificationDCs ?? null;
  const state = recallKnowledgeAttemptState(actor, targetActor);
  if (!identification || state.blocked) {
    return {
      allowed: false,
      blocked: state.blocked,
      reason: state.blocked ? "A failed Recall Knowledge check prevents further attempts." : "No creature identification DC is available.",
      attempt: state.attempts + 1,
      skills: [],
      standardDc: null,
      broadLoreDc: null,
      specificLoreDc: null,
    };
  }

  const index = state.attempts;
  const standardDc = progressionValue(identification.standard?.progression, index)
    ?? (index === 0 ? numeric(identification.standard?.dc) : null);
  const broadLoreDc = progressionValue(identification.lore?.[0]?.progression, index)
    ?? (index === 0 ? numeric(identification.lore?.[0]?.dc) : null);
  const specificLoreDc = progressionValue(identification.lore?.[1]?.progression, index)
    ?? (index === 0 ? numeric(identification.lore?.[1]?.dc) : null);
  return {
    allowed: [standardDc, broadLoreDc, specificLoreDc].some((dc) => dc !== null),
    blocked: false,
    reason: [standardDc, broadLoreDc, specificLoreDc].some((dc) => dc !== null)
      ? ""
      : "No further Recall Knowledge DC is listed.",
    attempt: index + 1,
    skills: Array.isArray(identification.skills) ? [...identification.skills] : [],
    standardDc,
    broadLoreDc,
    specificLoreDc,
  };
}

export function recallKnowledgeDcOptions(actor, target, skill) {
  const targetActor = actorDocument(target);
  const identification = targetActor?.identificationDCs ?? null;
  const state = recallKnowledgeAttemptState(actor, targetActor);
  const slug = String(skill?.slug ?? skill ?? "").trim().toLowerCase();
  const kind = String(skill?.kind ?? (STANDARD_SKILLS.includes(slug) ? "standard" : "lore"));
  if (!identification || state.blocked) {
    return {
      allowed: false,
      blocked: state.blocked,
      reason: state.blocked ? "A failed Recall Knowledge check prevents further attempts." : "No creature identification DC is available.",
      attempt: state.attempts + 1,
      choices: [],
    };
  }

  const index = state.attempts;
  const applicable = Array.isArray(identification.skills) && identification.skills.includes(slug);
  const standard = progressionValue(identification.standard?.progression, index)
    ?? (index === 0 ? numeric(identification.standard?.dc) : null);
  const broadLore = progressionValue(identification.lore?.[0]?.progression, index)
    ?? (index === 0 ? numeric(identification.lore?.[0]?.dc) : null);
  const specificLore = progressionValue(identification.lore?.[1]?.progression, index)
    ?? (index === 0 ? numeric(identification.lore?.[1]?.dc) : null);
  const choices = kind === "lore"
    ? [
      broadLore ? { id: "broad-lore", label: "Broadly applicable Lore", dc: broadLore } : null,
      specificLore ? { id: "specific-lore", label: "Specific Lore", dc: specificLore } : null,
    ].filter(Boolean)
    : standard ? [{ id: applicable ? "standard" : "gm-discretion", label: applicable ? "Applicable skill" : "Allow by GM discretion", dc: standard }] : [];
  return {
    allowed: choices.length > 0,
    blocked: false,
    reason: choices.length ? "" : "No further Recall Knowledge DC is listed.",
    attempt: index + 1,
    applicable,
    skill: slug,
    kind,
    choices,
  };
}

export function recallKnowledgeQuestion(id) {
  const normalized = id === "identity" ? "notable" : id;
  return RECALL_KNOWLEDGE_QUESTIONS.find((entry) => entry.id === normalized) ?? null;
}

export function normalizeRecallKnowledgeOutcome(value) {
  return normalizedOutcome(value);
}
