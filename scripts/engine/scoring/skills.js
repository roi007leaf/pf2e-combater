import { SETTINGS, settingOrDefault } from "../../settings.js";
import { t } from "../../i18n.js";
import {
  degreeDistribution,
  hasSpellcastingCapability,
  targetDc,
  targetDcLabel,
  titleCase,
} from "./facts.js";
import {
  isMartialRecipient,
  isPrimarySpellcaster,
} from "./buffs.js";

function signed(number) {
  return number >= 0 ? `+${number}` : String(number);
}

function skillEntry(profile, slug) {
  const skill = profile?.skills?.[slug];
  if (skill === undefined || skill === null) return null;
  if (Number.isFinite(Number(skill))) {
    return { mod: Number(skill), rank: null };
  }

  const mod = Number(skill.mod ?? skill.totalModifier ?? skill.value);
  if (!Number.isFinite(mod)) return null;

  const rank = Number(skill.rank ?? skill.proficiency?.rank);
  return {
    mod,
    rank: Number.isFinite(rank) ? rank : null,
  };
}

function isPlayerCharacterProfile(profile) {
  return String(profile?.actorType ?? profile?.type ?? "").toLowerCase() === "character";
}

function isNpcProfile(profile) {
  return String(profile?.actorType ?? profile?.type ?? "").toLowerCase() === "npc";
}

export function trainedSkillRequirement(profile, action) {
  if (!settingOrDefault(SETTINGS.hideUntrainedSkillActions, true)) return null;

  const skillSlug = String(action?.skill ?? "").toLowerCase();
  if (!skillSlug) return null;
  const skill = skillEntry(profile, skillSlug);
  const npc = isNpcProfile(profile);

  if (Number(skill?.rank) > 0) {
    return null;
  }

  if (npc && (!skill || skill.rank === null)) {
    return null;
  }

  if (!isPlayerCharacterProfile(profile) && !npc) {
    return null;
  }

  return {
    skill: skillSlug,
    reason: t("ScoreReason.RequiresTrained", "Requires trained {skill}.", { skill: titleCase(skillSlug) }),
  };
}

export function actionSkillDcSlug(action) {
  if (action.targetDefense) return action.targetDefense;
  if (action.targetSave) return action.targetSave;

  switch (action.slug) {
    case "demoralize":
      return "will";
    case "trip":
    case "disarm":
    case "tumble-through":
      return "reflex";
    case "grapple":
    case "reposition":
    case "shove":
      return "fortitude";
    case "feint":
    case "create-a-diversion":
      return "perception";
    default:
      return null;
  }
}

export function skillCheckScore(profile, target, action) {
  if (!action.skill) return null;

  const skill = skillEntry(profile, action.skill);
  const dcSlug = actionSkillDcSlug(action);
  const dc = targetDc(target, dcSlug);
  if (!skill || !Number.isFinite(dc)) return null;

  const odds = degreeDistribution(skill.mod, dc);
  if (!odds) return null;
  const chance = odds.success + odds.criticalSuccess;
  // Weight by degree: critical successes matter, and critical failures carry their own cost.
  const effectiveness = odds.criticalSuccess * 1.5 + odds.success - odds.criticalFailure * 0.5;
  let scoreDelta = Math.round((effectiveness - 0.5) * 40);
  const dcReasonLabel = targetDcLabel(target, dcSlug, dc);
  const reasons = [`${titleCase(action.skill)} ${signed(skill.mod)} vs ${dcReasonLabel}.`];

  if (skill.rank === 0) {
    scoreDelta -= 6;
    reasons.push(t("ScoreReason.UntrainedSkill", "Untrained in {skill}; reliability reduced.", { skill: titleCase(action.skill) }));
  }

  if (chance < 0.35) {
    scoreDelta -= 4;
    reasons.push(t("ScoreReason.SkillOddsPoor", "{skill} success odds are poor.", { skill: titleCase(action.skill) }));
  }

  return {
    skill: action.skill,
    skillLabel: titleCase(action.skill),
    mod: skill.mod,
    rank: skill.rank,
    dcSlug,
    dcLabel: titleCase(dcSlug),
    dc,
    chance,
    scoreDelta,
    label: `${titleCase(action.skill)} ${signed(skill.mod)} vs ${dcReasonLabel}`,
    reasons,
  };
}

const ATHLETICS_MANEUVER_SLUGS = new Set(["grapple", "trip", "disarm", "shove", "reposition"]);

export function ownSkillReliabilityScore(profile, action, context) {
  if (!ATHLETICS_MANEUVER_SLUGS.has(action?.slug) || action?.skill !== "athletics") return null;

  const skill = skillEntry(profile, "athletics");
  const spellcasterFallback = hasSpellcastingCapability(context) && (!isMartialRecipient(profile) || isPrimarySpellcaster(profile));
  const reasons = [];
  let scoreDelta = 0;

  if (!skill) {
    scoreDelta -= spellcasterFallback ? 70 : 20;
    reasons.push(t("ScoreReason.NoAthleticsDataMelee", "No Athletics data; melee maneuvers are unreliable."));
  } else if (skill.rank === 0) {
    scoreDelta -= spellcasterFallback ? 110 : (profile?.actorType === "character" ? 80 : 42);
    reasons.push(t("ScoreReason.UntrainedAthleticsMakesMelee", "Untrained Athletics makes melee maneuvers poor combat filler."));
  } else if (Number.isFinite(skill.mod) && skill.mod < 5) {
    scoreDelta -= spellcasterFallback ? 36 : 12;
    reasons.push(t("ScoreReason.LowAthleticsMakesMelee", "Low Athletics makes melee maneuvers unreliable."));
  }

  if (spellcasterFallback) {
    scoreDelta -= 12;
    reasons.push(t("ScoreReason.WizardLikeSpellcasterShould", "Wizard-like spellcaster should prefer spells over Athletics maneuvers."));
  }

  return scoreDelta ? { scoreDelta, reasons } : null;
}
