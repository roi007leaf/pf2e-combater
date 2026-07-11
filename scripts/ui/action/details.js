import { pf2eAreaType, pf2eAttackEffect, pf2eSave, pf2eTrait, t } from "../../i18n.js";
import { requiresTargetForAction } from "../../engine/action/requirements.js";

const NOTABLE_TRAITS = [
  "incapacitation",
  "attack",
  "manipulate",
  "concentrate",
  "mental",
  "auditory",
  "linguistic",
  "death",
];

function escapeHtml(value) {
  if (globalThis.foundry?.utils?.escapeHTML) return globalThis.foundry.utils.escapeHTML(String(value ?? ""));
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isSpellAction(action) {
  return String(action?.source ?? "").startsWith("spell")
    || action?.activityProfile?.spell === true
    || action?.item?.type === "spell";
}

function pushChip(chips, label, tooltip = "", kind = "") {
  const text = String(label ?? "").trim();
  if (!text) return;
  chips.push({
    label: text,
    tooltip: String(tooltip || text),
    class: kind ? `is-${kind}` : "",
  });
}

function resolutionChip(action) {
  const dc = numeric(action?.spellDc);
  const save = String(action?.saveProfile?.stat ?? "").trim().toLowerCase();
  const saveLabel = save ? pf2eSave(save) : "";
  const basic = action?.saveProfile?.basic === true ? t("Chip.BasicSuffix", " basic") : "";
  if (dc && saveLabel) return t("Chip.DCSave", "DC {dc} {save}{basic}", { dc, save: saveLabel, basic });
  if (dc) return t("Chip.DC", "DC {dc}", { dc });
  if (saveLabel) return t("Chip.SaveOnly", "{save} save", { save: saveLabel });
  if (action?.activityProfile?.spellAttack === true) return t("Chip.SpellAttack", "Spell attack");
  return "";
}

function targetingChip(action) {
  const targeting = action?.targetingProfile ?? {};
  const distance = numeric(targeting.distance ?? targeting.radius);
  const range = numeric(targeting.maxRange);
  const type = String(targeting.type ?? "").trim();
  if (targeting.area || type) {
    const typeName = type ? pf2eAreaType(type) : t("Chip.Area", "Area");
    return {
      label: distance ? t("Chip.AreaSized", "{distance}-ft {type}", { distance, type: typeName }) : typeName,
      tooltip: range ? t("Chip.RangeTooltip", "Range {range} ft", { range }) : "",
    };
  }
  if (range) return { label: t("Chip.RangeFt", "{range} ft", { range }), tooltip: t("Chip.Range", "Range") };
  if (targeting.self === true) return { label: t("Chip.Self", "Self"), tooltip: t("Chip.TargetsSelf", "Targets self") };
  return null;
}

function durationChip(action) {
  const profile = action?.activityProfile ?? {};
  if (profile.sustained === true) return t("Chip.Sustain", "Sustain");
  const duration = String(profile.duration ?? "").trim();
  if (!duration || duration.toLowerCase() === "instantaneous") return "";
  return duration;
}

function bestTargetChip(action) {
  if (!requiresTargetForAction(action)) return null;
  const target = action?.suggestedTarget ?? action?.preferredTarget ?? action?.target ?? null;
  if (target?.type === "self") return null;
  const name = String(target?.name ?? target?.actor?.name ?? "").trim();
  if (!name) return null;
  const baseTooltip = t("Chip.BestTargetTooltip", "{name} is this action's highest-ranked target.", { name });
  const reasons = [...new Set(
    (Array.isArray(action?.bestTargetReasons) ? action.bestTargetReasons : [])
      .map((reason) => String(reason ?? "").trim())
      .filter(Boolean),
  )];
  const whyLabel = t("Chip.BestTargetWhy", "Why:");
  return {
    label: t("Chip.BestTarget", "Best target: {name}", { name }),
    tooltip: reasons.length
      ? t("Chip.BestTargetTooltipWithReasons", "{base} Why: {reasons}", {
        base: baseTooltip,
        reasons: reasons.join(" "),
      })
      : baseTooltip,
    tooltipHtml: reasons.length
      ? `<p>${escapeHtml(baseTooltip)}</p><strong>${escapeHtml(whyLabel)}</strong><ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`
      : "",
  };
}

function notableTraitChips(action) {
  const traits = new Set([
    ...(Array.isArray(action?.traits) ? action.traits : []),
    ...(Array.isArray(action?.item?.system?.traits?.value) ? action.item.system.traits.value : []),
  ].map((trait) => String(trait?.slug ?? trait?.name ?? trait).toLowerCase()));
  if (action?.activityProfile?.incapacitation === true) traits.add("incapacitation");
  return NOTABLE_TRAITS.filter((trait) => traits.has(trait)).slice(0, 2).map((trait) => pf2eTrait(trait));
}

export function traitChips(action) {
  const traits = [...new Set([
    ...(Array.isArray(action?.traits) ? action.traits : []),
    ...(Array.isArray(action?.item?.system?.traits?.value) ? action.item.system.traits.value : []),
  ].map((trait) => String(trait?.slug ?? trait?.name ?? trait).toLowerCase()).filter(Boolean))];
  // A strike's "Additional Attack Effects" (e.g. Grab, Knockdown) aren't PF2e traits -- they're a
  // separate NPC melee-item field -- but read the same way as far as the player is concerned, so
  // they're shown as chips alongside the real traits rather than needing their own UI section.
  const attackEffects = [...new Set(
    (Array.isArray(action?.attackEffects) ? action.attackEffects : [])
      .map((effect) => String(effect?.slug ?? effect?.name ?? effect).toLowerCase())
      .filter(Boolean),
  )];
  const chips = [];
  for (const trait of traits) pushChip(chips, pf2eTrait(trait), "", "trait");
  for (const effect of attackEffects) pushChip(chips, pf2eAttackEffect(effect), "", "trait");
  return chips;
}

export function actionDetailChips(action) {
  const chips = [];
  const bestTarget = bestTargetChip(action);
  if (bestTarget) chips.push({ ...bestTarget, class: "is-best-target" });
  const preflight = action?.nativePreflight;
  if (preflight?.available && preflight?.label) {
    const tooltipLines = (Array.isArray(preflight.tooltipLines) ? preflight.tooltipLines : [])
      .map((line) => String(line ?? "").trim())
      .filter(Boolean);
    chips.push({
      label: String(preflight.label),
      tooltip: String(preflight.tooltip || preflight.label),
      tooltipHtml: tooltipLines.length
        ? `<strong>${escapeHtml(t("Preflight.TooltipTitle", "PF2e check preview"))}</strong><ul>${tooltipLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
        : "",
      class: "is-preflight",
    });
  }
  const preference = action?.preference;
  if (preference?.scoreDelta) {
    const delta = Number(preference.scoreDelta);
    pushChip(chips, `Pref ${delta > 0 ? "+" : ""}${delta}`, preference.tooltip, "preference");
  }
  if (!isSpellAction(action)) return chips;

  const rank = numeric(action?.castRank ?? action?.rank);
  pushChip(chips, action?.isCantrip ? t("Chip.Cantrip", "Cantrip") : rank !== null ? t("Chip.Rank", "Rank {rank}", { rank }) : "", "", "rank");
  pushChip(chips, action?.spellResource?.label, action?.spellResource?.tooltip, "resource");
  pushChip(chips, action?.spellcastingEntryLabel, "", "entry");
  pushChip(chips, resolutionChip(action), "", "resolution");
  const targeting = targetingChip(action);
  if (targeting) pushChip(chips, targeting.label, targeting.tooltip || targeting.label, "targeting");
  pushChip(chips, durationChip(action), "", "duration");
  for (const trait of notableTraitChips(action)) pushChip(chips, trait, "", "trait");
  return chips;
}
