import { t } from "../../i18n.js";
import { contextAllies, contextEnemies, selfTargetReference } from "../target-pool.js";
import { slugify as slugText } from "../action/text.js";
import { isSummonBuff, summonedRecipients } from "../../rules/summoned-creatures.js";
import {
  hasAnyCondition,
  hasCondition,
  hasEffect,
  hpPercent,
  maxRange,
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

// Haste: quickened, but the extra action can only Strike or Stride.
export function isStrikeOrStrideQuickening(action) {
  return activeBuffKeys(action).some((slug) => QUICKENING_SLUGS.has(slug));
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

// Spells that leave their target immune for a while (Guidance: 1 hour). PF2e marks it with an
// "... Immunity" effect, so the same ally can't be chosen again every turn.
const IMMUNITY_AFTER_CAST = new Map([["guidance", ["guidance-immunity", "effect-guidance-immunity", "spell-effect-guidance"]]]);

export function targetAlreadyHasBuff(entity, action) {
  const slug = slugText(action?.slug ?? action?.id);
  const immunity = [...IMMUNITY_AFTER_CAST.entries()].find(([key]) => slug === key || slug.endsWith(`-${key}`))?.[1] ?? [];
  if (immunity.some((effect) => hasEffect(entity, effect))) return true;
  return activeBuffKeys(action).some((key) => hasCondition(entity, key) || hasEffect(entity, key));
}

function selfReference(context) {
  return selfTargetReference(context, t("ScoreReason.SelfWord", "Self"));
}

function selfEntity(context) {
  const ref = selfReference(context);
  return {
    // The live panel keeps the profile on context.actor; without it "self" has no class.
    ...(context?.profile ?? context?.actor?.profile ?? {}),
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

function buffRecipients(context, action, { ignoreRange = false } = {}) {
  if (isSummonBuff(action)) return summonedRecipients(context, action).map((entity) => ({ entity, type: "ally" }));
  const targeting = action?.targetingProfile ?? {};
  const recipients = [];
  if (targeting.self !== false) recipients.push({ entity: selfEntity(context), type: "self" });
  // No range, no target and no area (Sure Strike, Shield, Mystic Armor): it works on the caster only.
  const spellSystem = action?.item?.type === "spell" ? action.item.system : null;
  const casterOnly = Boolean(spellSystem) && !String(spellSystem.range?.value ?? "").trim()
    && !String(spellSystem.target?.value ?? "").trim() && !spellSystem.area;
  // "Each ogre ally who hears": only allies of that kind (by name or trait) can receive it.
  const description = String(action?.item?.system?.description?.value ?? "").replace(/<[^>]+>/g, " ").toLowerCase();
  const qualifier = description.match(/\beach ([a-z]+) all(?:y|ies)\b/)?.[1];
  const qualifies = (ally) => !qualifier || ["who", "that", "willing"].includes(qualifier)
    || String(ally?.name ?? "").toLowerCase().includes(qualifier)
    || (Array.isArray(ally?.traits) && ally.traits.map((trait) => String(trait).toLowerCase()).includes(qualifier));
  if (targeting.ally && !casterOnly) {
    // Only allies the spell reaches from here (Haste: 30 ft). The planner moves or adds Reach Spell
    // first when the best one is farther; it must not quietly pick someone out of range.
    const range = maxRange(action);
    for (const ally of contextAllies(context)) {
      const distance = Number(ally?.distance);
      if (!ignoreRange && Number.isFinite(range) && Number.isFinite(distance) && distance > range) continue;
      if (!qualifies(ally)) continue;
      recipients.push({ entity: ally, type: "ally" });
    }
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

  if (isStrikeOrStrideQuickening(action)) {
    // Haste's extra action is Strike or Stride only: worth most to a martial, little to a caster
    // whose best use of it is walking.
    value += isMartialRecipient(entity) ? 30 : isPrimarySpellcaster(entity) ? 2 : 14;
  } else if (profile.extraAction) {
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

// Every living creature this buff could go on already has it: casting it again does nothing.
export function buffAlreadyCoversEveryone(context, action) {
  const recipients = buffRecipients(context, action).filter((recipient) => recipient?.entity && hpPercent(recipient.entity) > 0);
  return recipients.length > 0 && recipients.every((recipient) => targetAlreadyHasBuff(recipient.entity, action));
}

// The ally a buff would go to if range didn't matter, when that ally is out of range: the planner
// can Stride toward them or add Reach Spell first.
export function outOfRangeBuffRecipient(context, action) {
  const range = maxRange(action);
  if (!Number.isFinite(range) || action?.targetingProfile?.ally !== true) return null;
  const best = bestBuffRecipient(context, action, { ignoreRange: true });
  const inRange = bestBuffRecipient(context, action);
  if (best?.type !== "ally" || !(Number(best.entity?.distance) > range)) return null;
  return best.value > (Number(inRange?.value) || -Infinity) ? best.entity : null;
}

export function bestBuffRecipient(context, action, options = {}) {
  return buffRecipients(context, action, options)
    .map((recipient) => ({
      ...recipient,
      value: buffRecipientValue(context, action, recipient),
    }))
    .toSorted((left, right) => right.value - left.value)[0] ?? null;
}
