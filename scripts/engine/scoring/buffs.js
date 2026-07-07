import { t } from "../../i18n.js";
import { contextAllies, contextEnemies, selfTargetReference } from "../target-pool.js";
import { slugify as slugText } from "../action/text.js";
import {
  hasAnyCondition,
  hasCondition,
  hasEffect,
  hpPercent,
  valueSlugs,
} from "./facts.js";

const QUICKENING_SLUGS = new Set(["haste"]);
const MARTIAL_CLASS_SLUGS = new Set([
  "barbarian",
  "champion",
  "commander",
  "exemplar",
  "fighter",
  "guardian",
  "gunslinger",
  "inventor",
  "investigator",
  "kineticist",
  "magus",
  "monk",
  "ranger",
  "rogue",
  "swashbuckler",
  "thaumaturge",
]);
const SPELLCASTER_CLASS_SLUGS = new Set([
  "animist",
  "bard",
  "cleric",
  "druid",
  "oracle",
  "psychic",
  "sorcerer",
  "summoner",
  "witch",
  "wizard",
]);

function activeBuffKeys(action) {
  const profile = action?.activityProfile ?? {};
  return [
    action?.slug,
    action?.name,
    profile.appliesCondition,
    ...(Array.isArray(profile.appliesConditions) ? profile.appliesConditions : []),
    ...(profile.invisible ? ["invisible"] : []),
    ...(profile.hidden ? ["hidden", "undetected"] : []),
    ...(profile.concealed ? ["concealed"] : []),
  ].map(slugText).filter(Boolean);
}

export function actionGrantsQuickened(action) {
  const profile = action?.activityProfile ?? {};
  if (profile.extraAction === true) return true;
  const slugs = activeBuffKeys(action);
  if (slugs.some((slug) => QUICKENING_SLUGS.has(slug) || slug === "quickened")) return true;
  return [
    profile.appliesCondition,
    ...(Array.isArray(profile.appliesConditions) ? profile.appliesConditions : []),
    ...(Array.isArray(action?.appliesConditions) ? action.appliesConditions : []),
  ].map(slugText).includes("quickened");
}

export function targetAlreadyHasBuff(entity, action) {
  return activeBuffKeys(action).some((slug) => hasCondition(entity, slug) || hasEffect(entity, slug));
}

function selfReference(context) {
  return selfTargetReference(context, t("ScoreReason.SelfWord", "Self"));
}

function selfEntity(context) {
  const ref = selfReference(context);
  return {
    ...(context?.profile ?? {}),
    id: ref.id,
    uuid: ref.uuid,
    name: ref.name,
  };
}

function entityClassSlugs(entity) {
  return new Set([
    ...valueSlugs(entity?.classSlugs),
    ...valueSlugs(entity?.classes),
    ...valueSlugs(entity?.classSlug),
    ...valueSlugs(entity?.class),
    ...valueSlugs(entity?.traits),
  ]);
}

export function isMartialRecipient(entity) {
  const slugs = entityClassSlugs(entity);
  return [...slugs].some((slug) => MARTIAL_CLASS_SLUGS.has(slug))
    || entity?.hasStrike === true
    || Number(entity?.attackModifier) > 0;
}

function isSpellcasterRecipient(entity) {
  const slugs = entityClassSlugs(entity);
  return [...slugs].some((slug) => SPELLCASTER_CLASS_SLUGS.has(slug))
    || entity?.hasSpellcasting === true
    || Number(entity?.spellDc ?? entity?.spellDC) > 0;
}

export function isPrimarySpellcaster(entity) {
  const slugs = entityClassSlugs(entity);
  const hasCasterClass = [...slugs].some((slug) => SPELLCASTER_CLASS_SLUGS.has(slug));
  const hasMartialClass = [...slugs].some((slug) => MARTIAL_CLASS_SLUGS.has(slug));
  return hasCasterClass && !hasMartialClass;
}

function buffRecipients(context, action) {
  const targeting = action?.targetingProfile ?? {};
  const recipients = [];
  if (targeting.self !== false) recipients.push({ entity: selfEntity(context), type: "self" });
  if (targeting.ally) {
    for (const ally of contextAllies(context)) recipients.push({ entity: ally, type: "ally" });
  }
  return recipients.length ? recipients : [{ entity: selfEntity(context), type: "self" }];
}

function buffRecipientValue(context, action, recipient) {
  const entity = recipient?.entity;
  if (!entity || hpPercent(entity) <= 0) return -Infinity;

  const profile = action?.activityProfile ?? {};
  let value = recipient.type === "self" ? 8 : 12;

  if (targetAlreadyHasBuff(entity, action)) value -= 60;
  if (hpPercent(entity) < 0.5) value += 14;

  if (profile.attackBuff || profile.damageBuff) {
    if (isMartialRecipient(entity)) value += 24;
    else if (isSpellcasterRecipient(entity)) value += 8;
    else value += 12;
  }

  if (profile.extraAction) {
    value += isMartialRecipient(entity) || isSpellcasterRecipient(entity) ? 22 : 14;
  }

  if (profile.acBuff || profile.saveBuff || profile.resistance || profile.tempHp || profile.stealthDefense) {
    value += contextEnemies(context).length ? 14 : 4;
    if (hpPercent(entity) < 0.75) value += 8;
  }

  if (profile.removesCondition) {
    const constrained = hasAnyCondition(entity, ["grabbed", "restrained", "immobilized", "slowed", "stunned", "paralyzed"]);
    value += constrained ? 42 : -16;
  }

  return value;
}

export function bestBuffRecipient(context, action) {
  return buffRecipients(context, action)
    .map((recipient) => ({
      ...recipient,
      value: buffRecipientValue(context, action, recipient),
    }))
    .toSorted((left, right) => right.value - left.value)[0] ?? null;
}
