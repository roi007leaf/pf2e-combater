import { pf2eAreaType, pf2eAttackEffect, pf2eSave, pf2eTrait, t } from "../../i18n.js";

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
  if (!isSpellAction(action)) return [];

  const chips = [];
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
