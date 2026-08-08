import { t } from "../../i18n.js";
import { eventKeysForText } from "../../rules/event-context.js";

function textValue(value) {
  if (value && typeof value === "object" && "value" in value) return value.value;
  return value;
}

function arrayValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return [];
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function rawDescription(action) {
  return [
    textValue(action?.description),
    textValue(action?.system?.description),
    textValue(action?.item?.system?.description),
    textValue(action?.item?.description),
  ].filter(Boolean).join(" ");
}

function actionText(action) {
  return normalizeText([
    action?.name,
    action?.label,
    action?.slug,
    rawDescription(action),
  ].filter(Boolean).join(" "));
}

function actionName(action) {
  return String(action?.name ?? action?.label ?? action?.item?.name ?? action?.slug ?? "");
}

function actionSlug(action) {
  return String(action?.slug ?? action?.system?.slug ?? action?.item?.slug ?? action?.item?.system?.slug ?? "")
    .toLowerCase();
}

function actionTraits(action) {
  const traitValues = [
    ...arrayValue(action?.traits).map((trait) => trait?.slug ?? trait?.name ?? trait),
    ...arrayValue(action?.system?.traits?.value ?? action?.system?.traits),
    ...arrayValue(action?.item?.traits).map((trait) => trait?.slug ?? trait?.name ?? trait),
    ...arrayValue(action?.item?.system?.traits?.value ?? action?.item?.system?.traits),
  ];
  return [...new Set(traitValues.filter(Boolean).map((trait) => String(trait).toLowerCase()))];
}

function actionCategory(action) {
  return String(textValue(action?.category ?? action?.system?.category ?? action?.item?.system?.category) ?? "")
    .toLowerCase();
}

function isConsumable(action, traits) {
  return action?.type === "consumable"
    || action?.item?.type === "consumable"
    || traits.includes("consumable");
}

function isEquipmentActivation(action) {
  return ["ammo", "armor", "backpack", "book", "equipment", "weapon"]
    .includes(String(action?.type ?? action?.item?.type ?? "").toLowerCase());
}

function localizeKeys(action) {
  return [...rawDescription(action).matchAll(/@Localize\[([^\]]+)\]/gi)]
    .map((match) => match[1].toLowerCase());
}

function hasLocalize(action, key) {
  const needle = key.toLowerCase();
  return localizeKeys(action).some((value) => value.includes(needle));
}

function hasName(action, pattern) {
  return pattern.test(actionName(action).toLowerCase()) || pattern.test(actionSlug(action));
}

function readSaveProfile(action) {
  const raw = rawDescription(action);
  for (const match of raw.matchAll(/@Check\[([^\]]+)\]/gi)) {
    const checkOptions = String(match[1] ?? "");
    const stat = checkOptions.match(/^(fortitude|reflex|will)(?:\||$)/i)?.[1]
      ?? checkOptions.match(/(?:^|\|)type:(fortitude|reflex|will)(?:\||$)/i)?.[1];
    if (stat) {
      const dc = Number(checkOptions.match(/(?:^|\|)dc:(\d+)/i)?.[1]);
      return {
        stat: stat.toLowerCase(),
        dc: Number.isFinite(dc) ? dc : null,
        basic: /(?:^|\|)basic(?:\||$)/i.test(checkOptions) || /\bbasic\b/i.test(raw),
      };
    }
  }

  const textMatch = normalizeText(raw).match(/\b(fortitude|reflex|will)\s+save\b/);
  if (!textMatch) return null;
  return {
    stat: textMatch[1].toLowerCase(),
    dc: null,
    basic: /\bbasic\b/i.test(raw),
  };
}

function readDamageProfile(action) {
  const raw = rawDescription(action);
  const match = raw.match(/@Damage\[([^\][]+)(?:\[([^\]]+)\])?/i);
  if (match) {
    return {
      formula: String(match[1] ?? "").trim(),
      type: String(match[2] ?? "").trim() || null,
    };
  }

  const text = normalizeText(raw);
  const plain = text.match(/\b(?:additional\s+)?(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*(?:[a-z-]+\s+)?damage\b/);
  if (!plain) return null;

  const damageType = plain[0].match(/\b(acid|bleed|bludgeoning|cold|electricity|fire|force|mental|piercing|poison|precision|slashing|sonic|spirit|void|vitality)\b/);
  return {
    formula: String(plain[1] ?? "").replace(/\s+/g, ""),
    type: damageType?.[1] ?? null,
  };
}

function parseTemplateToken(inner) {
  const areaTypes = new Set(["burst", "cone", "cube", "cylinder", "emanation", "line", "ring", "square"]);
  const parts = Object.fromEntries(
    String(inner ?? "").split("|")
      .map((part) => {
        const [rawKey, ...rawValue] = part.split(":");
        const key = String(rawKey ?? "").trim().toLowerCase();
        const value = rawValue.join(":").trim().toLowerCase();
        if (key && value) return [key, value];
        if (areaTypes.has(key)) return ["type", key];
        return null;
      })
      .filter(Boolean),
  );
  const distance = Number(parts.distance ?? parts.radius ?? parts.length);
  const width = Number(parts.width);
  return {
    type: parts.type ?? "area",
    distance: Number.isFinite(distance) ? distance : null,
    ...(Number.isFinite(width) ? { width } : {}),
  };
}

function templateLabel(template) {
  const type = template?.type ? template.type.charAt(0).toUpperCase() + template.type.slice(1) : "Area";
  return template?.distance ? `${type} ${template.distance} ft` : type;
}

// All @Template[...] embeds in the description, so a multi-template action/spell can offer the
// player a choice of which to place. Falls back to a single text-parsed shape (e.g. "30-foot
// cone") when there are no @Template embeds.
function readTemplateProfile(action) {
  const raw = rawDescription(action);
  const matches = [...raw.matchAll(/@Template\[([^\]]+)\]/gi)];
  if (matches.length) {
    const seen = new Set();
    const templates = matches
      .map((match) => parseTemplateToken(match[1]))
      .filter((template) => {
        if (!template.type) return false;
        // rawDescription concatenates overlapping sources, so the same @Template can match
        // more than once — collapse identical shapes so the picker shows each once.
        const key = `${template.type}|${template.distance}|${template.width ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((template) => ({ ...template, label: templateLabel(template) }));
    const first = templates[0];
    return {
      area: true,
      type: first.type,
      distance: first.distance,
      ...(first.width ? { width: first.width } : {}),
      ...(first.type === "emanation" ? { selfCentered: true } : {}),
      ...(templates.length > 1 ? { templates } : {}),
    };
  }

  const text = normalizeText(raw);
  const textMatch = text.match(/\b(\d+)[ -]foot (cone|line|burst|emanation)\b/)
    ?? text.match(/\b(cone|line|burst|emanation)\b.{0,24}\b(\d+)\s+feet\b/);
  if (!textMatch) return null;

  const firstIsNumber = Number.isFinite(Number(textMatch[1]));
  const type = firstIsNumber ? textMatch[2] : textMatch[1];
  return {
    area: true,
    type,
    distance: Number(firstIsNumber ? textMatch[1] : textMatch[2]),
    ...(type === "emanation" ? { selfCentered: true } : {}),
  };
}

function readRangeProfile(action) {
  const text = actionText(action);
  const matches = [
    ...text.matchAll(/\bwithin\s+(\d+)\s+feet\b/g),
    ...text.matchAll(/\b(\d+)\s+feet\b/g),
  ];
  const values = matches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return {};
  return { maxRange: Math.max(...values) };
}

function readTargetRequirementProfile(text) {
  const profile = {};
  if (/\badjacent\b/.test(text)) profile.maxRange = 5;
  if (/\bliving creature\b|\bliving target\b|\bliving being\b/.test(text)) profile.requiresLiving = true;
  if (/\bwraith creature\b|\banother wraith\b|\btarget wraith\b/.test(text)) {
    profile.requiresAnyTrait = ["wraith"];
  }
  return profile;
}

function mergeTargetingProfile(...profiles) {
  const result = {};
  for (const profile of profiles) {
    if (!profile || typeof profile !== "object") continue;
    const { maxRange, range, requiresAnyTrait, requiresAllTraits, ...rest } = profile;
    Object.assign(result, rest);

    const currentMax = Number(result.maxRange ?? result.range);
    const nextMax = Number(maxRange ?? range);
    if (Number.isFinite(nextMax) && nextMax > 0) {
      result.maxRange = Number.isFinite(currentMax) && currentMax > 0
        ? Math.min(currentMax, nextMax)
        : nextMax;
    }

    const anyTraits = Array.isArray(requiresAnyTrait) ? requiresAnyTrait : [];
    if (anyTraits.length) result.requiresAnyTrait = [...new Set([...(result.requiresAnyTrait ?? []), ...anyTraits])];
    const allTraits = Array.isArray(requiresAllTraits) ? requiresAllTraits : [];
    if (allTraits.length) result.requiresAllTraits = [...new Set([...(result.requiresAllTraits ?? []), ...allTraits])];
  }
  return result;
}

function readMovementDistance(text) {
  const match = text.match(/\b(?:stride|move|fly|burrow|leap|jump)s? up to (\d+) feet\b/);
  const distance = Number(match?.[1]);
  return Number.isFinite(distance) && distance > 0 ? distance : null;
}

function hasFrequency(action) {
  const text = normalizeText(rawDescription(action));
  return Boolean(action?.system?.frequency ?? action?.item?.system?.frequency)
    || /\b(?:frequency|recharge)\b|\bcan(?:not|['’]?t) use [^.]{0,160}\b(?:again|more than once)\b|\bmore than once per\b|\bonce per (?:turn|round|minute|10 minutes|hour|day)\b/i.test(text);
}

function readEventProfile(text, actionCost) {
  const triggers = eventKeysForText(text);
  const previousActionRequirements = [];
  const requiresPreviousAction = /\b(?:previous|last|most recent) action\b/.test(text);
  if (requiresPreviousAction) {
    if (/\bnon-cantrip spell\b/.test(text)) previousActionRequirements.push("non-cantrip-spell");
    else if (/\bcast(?:s|ing)?\b.{0,60}\bspell\b|\bspell\b.{0,30}\bcast\b/.test(text)) previousActionRequirements.push("spell-cast");
    if (/\bstrike\b/.test(text)) previousActionRequirements.push("after-strike");
  }

  return {
    eventTriggers: triggers,
    eventTriggerOnly: actionCost === "reaction" || (actionCost === 0 && triggers.length > 0) || /\btrigger\b/.test(text),
    previousActionRequirements,
  };
}

function textHasAny(text, values) {
  return values.some((value) => text.includes(value));
}

function baseProfile(includes = []) {
  return {
    includes,
    includesStrike: includes.includes("strike"),
  };
}

function baseAttackProfile() {
  return {
    includes: ["strike"],
    includesStrike: true,
  };
}

const MAP_WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

// How many attacks this activity counts as toward the multiple attack penalty.
// Returns a number, "variable" (counts as an unknown/scaling number — e.g. "equal
// to the number of heads"), or null when the text says nothing about MAP.
function readMapAttacks(text) {
  if (/(?:doesn.t|does not|don.t|do not|won.t|will not) count (?:toward|towards|against)[^.]*multiple attack penalty/.test(text)) {
    return 0;
  }
  if (/counts? as a number of attacks equal to/.test(text)) return "variable";
  const match = text.match(/counts? as (\d+|one|two|three|four|five|six) attacks?/);
  if (match) return MAP_WORD_NUMBERS[match[1]] ?? Number(match[1]);
  return null;
}

function readDistinctStrikeCount(text) {
  let match = text.match(/\b(\d+|one|two|three|four|five|six)\s+different\s+(?:creatures?|targets?|enem(?:y|ies)|foes?)\b/i);
  if (!match) match = text.match(/\bup to\s+(\d+|one|two|three|four|five|six)\s+times\b/i);
  if (!match) match = text.match(/\b(\d+|one|two|three|four|five|six)\b(?:\s+\S+){0,3}\s+strikes?\b/i);
  if (!match) return 2;
  const raw = match[1].toLowerCase();
  const count = MAP_WORD_NUMBERS[raw] ?? Number(raw);
  return Math.min(6, Math.max(2, count));
}

function readAcSetupProfile(text) {
  const appliesOffGuard = /\boff[- ]guard\b|\bflat-footed\b/.test(text);
  const appliesAcPenalty = /\b(?:ac|armor class|defenses?)\b.{0,50}\bpenalty\b|\bpenalty\b.{0,50}\b(?:ac|armor class|defenses?)\b/.test(text);
  if (!appliesOffGuard && !appliesAcPenalty) return null;

  return {
    ...baseProfile(["setup"]),
    appliesCondition: appliesOffGuard ? "off-guard" : null,
    acPenalty: appliesAcPenalty,
  };
}

function readRequirementsText(action) {
  const text = normalizeText(rawDescription(action));
  const match = text.match(/\brequirements?\b(.+?)(?:\beffect\b|\btrigger\b|\bfrequency\b|$)/);
  return match?.[1]?.trim() ?? "";
}

function readTargetConditionRequirement(action) {
  const requirements = readRequirementsText(action);
  if (!requirements) return null;

  const mentionsTarget = /\b(?:creature|target|enemy|foe|opponent|victim)\b/.test(requirements);
  const grabbed = /\bgrabbed\b/.test(requirements);
  const restrained = /\brestrained\b/.test(requirements);
  if (!mentionsTarget || (!grabbed && !restrained)) return null;

  const conditions = [
    grabbed ? "grabbed" : null,
    restrained ? "restrained" : null,
  ].filter(Boolean);
  return conditions.length > 1
    ? { requiresAnyTargetCondition: conditions }
    : { requiresTargetCondition: conditions[0] };
}

// Mirrors readTargetConditionRequirement's technique: Paizo's own templated Requirements
// clause for "borrow N specific weapons to make several Strikes" feats is consistent enough
// to detect generically (Twin Takedown, Twin Feint, and the uncurated fighter feat Double
// Slice all use the identical "wielding two melee weapons, each in a different hand" phrase).
function readWeaponRequirement(action) {
  const requirements = readRequirementsText(action);
  if (!requirements) return null;
  if (/wielding two melee weapons/.test(requirements) && /different hand/.test(requirements)) {
    return { requiresDualBackingStrike: true };
  }
  if (/wielding a ranged weapon/.test(requirements) && /reload 0\b/.test(requirements)) {
    return { backingStrikeFilter: "ranged-reload-zero" };
  }
  return null;
}

function withTargetConditionRequirement(activityProfile, requirement) {
  if (!requirement) return activityProfile;
  return {
    ...(activityProfile ?? {}),
    ...requirement,
  };
}

// Detect a beneficial (buff/support) effect. Requires a positive signal so plain
// utility actions are not mislabeled as buffs.
function readBuffProfile(text) {
  const attackBuff = /\bbonus to attack\b|\battack rolls?\b.*\bbonus\b|\bstatus bonus\b.*\battack/.test(text);
  const grantsBonus = /\b(?:\+\d+|status|circumstance|item) bonus\b|\bgrants? a .*bonus\b/.test(text);
  const tempHp = /\btemporary hit points\b/.test(text);
  const resistance = /\bresistance\b|\breduce[sd]? .* damage\b/.test(text);
  const removesCondition = /\b(?:remove|reduce|suppress)[sd]? .* (?:condition|penalt)/.test(text);
  const protective = /\bprotect|\bward\b|\bbolster|\bbless|\bheroism|\bhaste\b|\benhance|\brally\b|\bsanctuary\b/.test(text);
  const extraAction = /\bhaste\b|\b(?:an? )?(?:extra|additional) action\b|\bact twice\b|\bquickened\b/.test(text);

  if (!(attackBuff || grantsBonus || tempHp || resistance || removesCondition || protective || extraAction)) {
    return null;
  }

  const ally = /\bally\b|\ballies\b|\bwilling creature\b/.test(text);
  return { ally, attackBuff, tempHp, removesCondition, extraAction };
}

function readActiveDefenseProfile(text, traits, category) {
  if (traits.includes("aura")) return null;
  const parry = /\bparr(?:y|ies)\b/.test(text);
  const acBuff = /\bbonus to ac\b|\bac\b.{0,60}\bbonus\b|\bbonus\b.{0,60}\bac\b|\braises? .*shield\b|\bdeflect\b|\bguard\b|\bprotect\b/.test(text);
  const saveBuff = /\bbonus to saves?\b|\bsaves?\b.{0,60}\bbonus\b/.test(text);
  const resistance = /\bresistance\b|\breduce[sd]? .*damage\b/.test(text);
  if (category !== "defensive" && !parry && !acBuff && !saveBuff && !resistance && !traits.includes("parry")) {
    return null;
  }

  return {
    ...baseProfile(["defense"]),
    acBuff,
    saveBuff,
    resistance,
    parry: parry || traits.includes("parry"),
  };
}

function readStealthDefenseProfile(text) {
  const invisible = /\binvisible\b|\bunseen\b/.test(text);
  const hidden = /\bhidden\b/.test(text);
  const concealed = /\bconcealed\b|\bconcealment\b|\bmist\b/.test(text);
  const lightSuppression = /\bgo dark\b|\bextinguishes? (?:its|their|the) glow\b|\bsuppress(?:es)? .*aura\b/.test(text);
  if (!invisible && !hidden && !concealed && !lightSuppression) return null;

  return {
    ...baseProfile(["defense", "stealth"]),
    stealth: true,
    invisible,
    hidden,
    concealed,
  };
}

function readCommandSupportProfile(text) {
  const command = /\b(?:barks? orders?|bellowing command|commands?|orders?|directs?|inspir(?:e|es|ation)|word of caution|tactical direction|formation command)\b/.test(text);
  const ally = /\bally\b|\ballies\b|\bcompanions?\b|\btroops?\b/.test(text);
  if (!command || !ally) return null;

  const extraAction = /\b(?:ally|allies|creature|target)[^.]{0,120}\b(?:step|stride|strike|attack|move)\b/.test(text);
  const attackBuff = /\b(?:strike|attack)\b/.test(text);
  return {
    ...baseProfile(["buff"]),
    ally: true,
    commandSupport: true,
    extraAction,
    attackBuff,
  };
}

function readCaptureRestraintProfile(text) {
  const target = /\b(?:creature|target|enemy|opponent|victim)\b/.test(text);
  const capture = /\b(?:manacles?|bind|hog-?tie|capture|restrain|restrained|immobili[sz]ed|cage|encage)\b/.test(text);
  if (!target || !capture) return null;

  const appliesCondition = /\b(?:restrained|manacles?|bind|hog-?tie|capture|cage|encage)\b/.test(text)
    ? "restrained"
    : /\bimmobili[sz]ed\b/.test(text) ? "immobilized" : null;
  return {
    ...baseProfile(["control"]),
    npcFamily: "capture-restraint",
    appliesCondition,
  };
}

function inferred(role, {
  activityProfile = null,
  targetingProfile = null,
  saveProfile = null,
  damageProfile = null,
  gatingProfile = null,
  setupFor = [],
  confidence = "medium",
  executable = "open-item",
  reasons = [],
} = {}) {
  return {
    role,
    activityProfile,
    targetingProfile,
    saveProfile,
    damageProfile,
    gatingProfile,
    setupFor,
    confidence,
    executable,
    reasons,
    inferred: true,
  };
}

function resultSupportsDamageProfile(result) {
  return ["area-damage", "control", "damage", "drain", "mobility-attack", "multiattack", "save-damage", "self-healing"]
    .includes(result?.role);
}

function decorateClassificationResult(action, result) {
  if (!result) return result;

  const targetConditionRequirement = readTargetConditionRequirement(action);
  const profile = result.activityProfile ?? {};
  if (
    targetConditionRequirement
    && profile.npcFamily !== "grab-rider"
    && !profile.requiresTargetCondition
    && !profile.requiresAnyTargetCondition
  ) {
    result.activityProfile = withTargetConditionRequirement(profile, targetConditionRequirement);
  }

  const damageProfile = readDamageProfile(action);
  if (damageProfile && !result.damageProfile && resultSupportsDamageProfile(result)) {
    result.damageProfile = damageProfile;
  }

  return result;
}

// Preserve template targeting regardless of which classifier branch produced the result. Multiple
// templates retain their picker choices; a single template still needs its shape and placement.
export function classifySystemAction(action, parsedCost) {
  const result = decorateClassificationResult(action, classifySystemActionBase(action, parsedCost));
  if (!result) return result;
  const templateProfile = readTemplateProfile(action);
  if (templateProfile) {
    result.targetingProfile = {
      ...(result.targetingProfile ?? {}),
      ...templateProfile,
    };
  }
  return result;
}

function classifySystemActionBase(action, parsedCost) {
  const actionCost = parsedCost?.actionCost;
  if (parsedCost?.passive || actionCost === null || actionCost === undefined) return null;

  const text = actionText(action);
  const traits = actionTraits(action);
  const category = actionCategory(action);
  const saveProfile = readSaveProfile(action);
  const damageProfile = readDamageProfile(action);
  const templateProfile = readTemplateProfile(action);
  const rangeProfile = readRangeProfile(action);
  const targetRequirementProfile = readTargetRequirementProfile(text);
  const eventProfile = readEventProfile(text, actionCost);
  const targetConditionRequirement = readTargetConditionRequirement(action);
  const gatingProfile = {
    frequency: hasFrequency(action),
    triggerOnly: actionCost === "reaction",
    ...eventProfile,
  };

  const isReaction = actionCost === "reaction";
  const isFree = actionCost === 0;
  const mentionsStrike = /\bstrikes?\b/.test(text);
  const offensive = category === "offensive" || traits.includes("attack") || mentionsStrike || Boolean(saveProfile || damageProfile);

  if (isReaction || isFree) {
    if (
      hasName(action, /\b(?:reactive strike|attack of opportunity)\b/)
      || (isReaction && mentionsStrike && /\btrigger\b|\bmanipulate\b|\bleaves? a square\b|\bmove action\b/.test(text))
    ) {
      return inferred("reaction-attack", {
        activityProfile: {
          ...baseAttackProfile(),
          reaction: true,
        },
        targetingProfile: { enemy: true, reach: true },
        gatingProfile,
        confidence: hasName(action, /\b(?:reactive strike|attack of opportunity)\b/) ? "high" : "medium",
        reasons: [t("ActReason.ReactionCanPunishA", "Reaction can punish a provoking enemy.")],
      });
    }

    if (
      hasName(action, /\bfast swallow\b/)
      || /\buses? swallow whole\b/.test(text)
    ) {
      return inferred("control", {
        activityProfile: {
          ...baseProfile(["control"]),
          reaction: true,
          npcFamily: "swallow-whole",
          requiresAnyTargetCondition: ["grabbed", "restrained"],
          containsTarget: true,
        },
        targetingProfile: { enemy: true, reach: true },
        gatingProfile,
        confidence: "high",
        reasons: [t("ActReason.ReactionCanImmediatelySwallow", "Reaction can immediately Swallow Whole a grabbed target.")],
      });
    }

    if (
      hasName(action, /\b(?:shield block|ferocity|nimble dodge|deny advantage)\b/)
      || category === "defensive"
      || /\btrigger\b.*\b(?:damage|attack|hit|critical)\b/.test(text)
    ) {
      return inferred("defense", {
        activityProfile: baseProfile(["defense"]),
        targetingProfile: { self: true },
        gatingProfile,
        confidence: hasName(action, /\b(?:shield block|ferocity|nimble dodge)\b/) ? "high" : "medium",
        reasons: [t("ActReason.DefensiveReactionIsRecognized", "Defensive reaction is recognized.")],
      });
    }
  }

  const mentionsStride = /\bstrides?\b|\bsteps?\b|\bmoves?\b|\bleaps?\b|\bjumps?\b|\bbounds?\b|\bsprings?\b/.test(text);
  const mentionsDifferentTargets = /\bdifferent targets?\b|\bseparate targets?\b|\beach against\b|\bdifferent creatures?\b|\bseparate creatures?\b|\bdifferent enem(?:y|ies)\b|\bseparate enem(?:y|ies)\b|\bdifferent foes?\b|\bseparate foes?\b/.test(text);
  const mentionsMultipleStrikes = /\b(?:two|three|\d+)\b.{0,30}\bstrikes?\b|\bup to\b.{0,30}\bstrikes?\b|\bnumber of strikes?\b/.test(text);
  const mentionsDelayedMap = /multiple attack penalty.*(?:doesn.t|does not|doesn’t) increase|map.*(?:doesn.t|does not|doesn’t) increase/.test(text);
  const mapAttacks = readMapAttacks(text);
  const mentionsFocusedTarget = /\bsingle .* strike\b|\bone .* strike\b|\bsingle target\b|\bsame target\b|\bfocus/.test(text);
  const acSetupProfile = readAcSetupProfile(text);
  const mentionsFutureAttack = /\bnext (?:strike|attack)\b|\buntil .* next (?:strike|attack)\b/.test(text);

  if (
    hasName(action, /\bbespell strikes?\b/)
    || (/\bmost recent action\b.{0,80}\bcast\b.{0,80}\bnon-cantrip spell\b/.test(text) && /\bstrike\b/.test(text))
  ) {
    return inferred("setup", {
      activityProfile: {
        ...baseProfile(["setup"]),
        damageBuff: true,
        spellBuff: true,
        previousActionRequirements: ["non-cantrip-spell"],
      },
      targetingProfile: { self: true },
      setupFor: ["strike", "damage"],
      gatingProfile: {
        ...gatingProfile,
        eventTriggerOnly: true,
        previousActionRequirements: ["non-cantrip-spell"],
      },
      confidence: "high",
      reasons: [t("ActReason.FreeActionRequiresA", "Free action requires a prior non-cantrip spell before it can enhance a Strike.")],
    });
  }

  if (acSetupProfile && !saveProfile && !damageProfile && (!mentionsStrike || mentionsFutureAttack)) {
    return inferred("setup", {
      activityProfile: acSetupProfile,
      targetingProfile: mergeTargetingProfile({ enemy: true }, rangeProfile, targetRequirementProfile),
      setupFor: ["strike", "damage"],
      gatingProfile,
      confidence: acSetupProfile.appliesCondition === "off-guard" ? "high" : "medium",
      reasons: [t("ActReason.ActionCanWeakenTarget", "Action can weaken target defenses before a Strike.")],
    });
  }

  if (hasLocalize(action, "glossary.changeshape") || hasName(action, /\bchange shape\b/)) {
    return inferred("transformation", {
      activityProfile: {
        ...baseProfile(["transformation"]),
        polymorph: traits.includes("polymorph"),
      },
      targetingProfile: { self: true },
      gatingProfile,
      confidence: hasLocalize(action, "glossary.changeshape") ? "high" : "medium",
      reasons: [t("ActReason.ChangeShapeCanAlter", "Change Shape can alter movement, attacks, or disguise state.")],
    });
  }

  if (hasLocalize(action, "glossary.throwrock") || hasName(action, /\bthrow rock\b/)) {
    return inferred("damage", {
      activityProfile: {
        ...baseAttackProfile(),
        focusedStrike: true,
        ranged: true,
      },
      targetingProfile: { enemy: true, maxRange: rangeProfile.maxRange ?? 120 },
      gatingProfile,
      confidence: hasLocalize(action, "glossary.throwrock") ? "high" : "medium",
      reasons: [t("ActReason.ThrowRockIsA", "Throw Rock is a ranged attack option.")],
    });
  }

  if (hasLocalize(action, "glossary.aquaticambush") || hasName(action, /\baquatic ambush\b/)) {
    return inferred("mobility-attack", {
      activityProfile: {
        ...baseProfile(["stride", "strike"]),
        strideCount: 1,
        includesStrike: true,
        requiresTerrain: "water",
      },
      targetingProfile: { enemy: true, reachAfterMove: true, maxRange: rangeProfile.maxRange ?? null },
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.AquaticAmbushMovesFrom", "Aquatic Ambush moves from water into an attack.")],
    });
  }

  if (hasLocalize(action, "glossary.push") || hasName(action, /\bpush\b/)) {
    return inferred("control", {
      activityProfile: {
        ...baseProfile(["control"]),
        forcedMovement: true,
        requiresPreviousStrike: /\blast action\b.*\bstrike\b|\bsuccessful strike\b/.test(text),
      },
      targetingProfile: { enemy: true, reach: true },
      gatingProfile,
      confidence: hasLocalize(action, "glossary.push") ? "high" : "medium",
      reasons: [t("ActReason.PushCanMoveA", "Push can move a target after a hit.")],
    });
  }

  if (hasLocalize(action, "glossary.formup") || hasName(action, /\bform up\b/)) {
    return inferred("mobility", {
      activityProfile: {
        ...baseProfile(["stride"]),
        formation: true,
        npcFamily: "troop-action",
      },
      targetingProfile: { self: true },
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.TroopCanReformIts", "Troop can reform its space.")],
    });
  }

  if (hasName(action, /\bhunt prey\b/) || /\bdesignates? (?:a single )?creature .* prey\b|\bhunted prey\b/.test(text)) {
    return inferred("setup", {
      activityProfile: {
        ...baseProfile(["setup"]),
        targetMark: "hunted-prey",
        precisionDamageSetup: /\bprecision damage\b/.test(text),
      },
      targetingProfile: { enemy: true, ...rangeProfile },
      setupFor: ["strike", "damage"],
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.HuntPreySetsUp", "Hunt Prey sets up stronger follow-up attacks.")],
    });
  }

  if (
    hasName(action, /\bexploit vulnerability\b/)
    || /\b(?:mortal weakness|personal antithesis|exploit vulnerability)\b/.test(text)
  ) {
    return inferred("setup", {
      activityProfile: {
        ...baseProfile(["setup"]),
        targetMark: "exploited-vulnerability",
        damageBuff: true,
        weaknessSetup: true,
      },
      targetingProfile: { enemy: true, ...rangeProfile },
      setupFor: ["strike", "damage"],
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.ExploitVulnerabilityIdentifiesA", "Exploit Vulnerability identifies a weakness and sets up stronger attacks.")],
    });
  }

  if (hasName(action, /\brage\b/) || /\bgains? .*bonus damage\b.*\bstrikes?\b|\brage\b.*\bstrikes?\b/.test(text)) {
    return inferred("setup", {
      activityProfile: {
        ...baseProfile(["setup"]),
        damageBuff: true,
      },
      targetingProfile: { self: true },
      setupFor: ["strike", "damage"],
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.RageSetsUpStronger", "Rage sets up stronger attacks.")],
    });
  }

  if (traits.includes("stance") || /\benter (?:the |a )?stance\b/.test(text)) {
    return inferred("setup", {
      activityProfile: {
        ...baseProfile(["setup"]),
        stance: true,
      },
      targetingProfile: { self: true },
      setupFor: ["strike", "damage"],
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.StanceSetsUpThis", "Stance sets up this turn's attacks.")],
    });
  }

  if (hasName(action, /\bpoison weapon\b/) || /\bappl(?:y|ies) poison\b.*\bweapon\b/.test(text)) {
    return inferred("setup", {
      activityProfile: {
        ...baseProfile(["setup"]),
        weaponBuff: true,
        poison: true,
      },
      targetingProfile: { self: true },
      setupFor: ["strike", "damage"],
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.PoisonedWeaponCanImprove", "Poisoned weapon can improve the next damaging Strike.")],
    });
  }

  if (
    hasName(action, /\b(?:weapon infusion|two-element infusion)\b/)
    || /\bnext action\b.{0,40}\belemental blast\b|\bnext elemental blast\b/.test(text)
  ) {
    return inferred("setup", {
      activityProfile: {
        ...baseProfile(["setup"]),
        infusion: true,
        nextAction: "elemental-blast",
      },
      targetingProfile: { self: true },
      setupFor: ["elemental-blast", "damage"],
      gatingProfile,
      confidence: hasName(action, /\b(?:weapon infusion|two-element infusion)\b/) ? "high" : "medium",
      reasons: [t("ActReason.InfusionModifiesTheNext", "Infusion modifies the next Elemental Blast.")],
    });
  }

  if (hasName(action, /\breach spell\b/) || /\bnext spell\b.*\brange\b|\brange increased\b/.test(text)) {
    return inferred("setup", {
      activityProfile: {
        ...baseProfile(["setup"]),
        spellBuff: true,
        spellshape: true,
        rangeBuff: true,
      },
      targetingProfile: { self: true },
      setupFor: ["spell", "damage", "control"],
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.ReachSpellSetsUp", "Reach Spell sets up a longer-range spell.")],
    });
  }

  if (hasName(action, /\bquickened casting\b/) || /\bnext spell\b.*\b(?:1 fewer action|fewer actions)\b/.test(text)) {
    return inferred("setup", {
      activityProfile: {
        ...baseProfile(["setup"]),
        spellBuff: true,
        actionDiscount: true,
      },
      targetingProfile: { self: true },
      setupFor: ["spell", "damage", "control", "healing"],
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.QuickenedCastingSetsUp", "Quickened Casting sets up an efficient spell this turn.")],
    });
  }

  if (traits.includes("spellshape") || traits.includes("metamagic")) {
    return inferred("setup", {
      activityProfile: {
        ...baseProfile(["setup"]),
        spellBuff: true,
        spellshape: true,
      },
      targetingProfile: { self: true },
      setupFor: ["spell", "damage", "control", "healing"],
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.SpellshapeActionImprovesThe", "Spellshape action improves the spell cast right after it.")],
    });
  }

  if (
    hasName(action, /\b(?:recharge|drain bonded item)\b/)
    || /\bregains? an expended spell\b|\bregains? an expended spell slot\b|\bquickened casting again\b|\bprepared and already cast\b/.test(text)
  ) {
    return inferred("resource-recovery", {
      activityProfile: {
        ...baseProfile(["resource"]),
        recoversSpellResource: true,
        ...(hasName(action, /\brecharge\b/) || /\brecharge\b/.test(text) ? { npcFamily: "recharge" } : {}),
      },
      targetingProfile: { self: true },
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.ActionRecoversAnExpended", "Action recovers an expended spell resource.")],
    });
  }

  if (hasName(action, /\bbattle medicine\b/) || /\bmedicine\b.*\brestore hit points\b|\bpatch wounds\b|\brestore hit points\b.*\bcombat\b/.test(text)) {
    return inferred("healing", {
      activityProfile: {
        ...baseProfile(["healing"]),
        medicine: true,
        requiresFreeHand: true,
      },
      targetingProfile: { ally: true, self: true, reach: true },
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.BattleMedicineCanRestore", "Battle Medicine can restore Hit Points in combat.")],
    });
  }

  if (hasName(action, /\bremove a condition\b/) || /\bremove\b.*\bcondition\b/.test(text)) {
    return inferred("healing", {
      activityProfile: {
        ...baseProfile(["healing"]),
        removesCondition: true,
      },
      targetingProfile: { ally: true, self: true },
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.ActionCanRemoveA", "Action can remove a harmful condition.")],
    });
  }

  if (
    hasName(action, /\braise a shield\b/)
    || (/\bshield\b.*\bprotect\b|\braises? (?:a|its|their) shield\b/.test(text) && !/\bcan use this (?:extra )?action to\b|\ban extra action to\b/.test(text))
  ) {
    return inferred("defense", {
      activityProfile: baseProfile(["defense"]),
      targetingProfile: { self: true },
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.RaiseAShieldImproves", "Raise a Shield improves defense until next turn.")],
    });
  }

  const stealthDefenseProfile = readStealthDefenseProfile(text);
  if (stealthDefenseProfile && !isEquipmentActivation(action) && !saveProfile && !damageProfile && !mentionsStrike) {
    return inferred("stealth-defense", {
      activityProfile: stealthDefenseProfile,
      targetingProfile: { self: true },
      gatingProfile,
      confidence: stealthDefenseProfile.invisible ? "high" : "medium",
      reasons: [t("ActReason.StealthActionMakesActor", "Stealth action makes the actor harder to target.")],
    });
  }

  const activeDefenseProfile = readActiveDefenseProfile(text, traits, category);
  if (activeDefenseProfile && !isEquipmentActivation(action) && !saveProfile && !damageProfile && !mentionsStrike) {
    return inferred("defense", {
      activityProfile: activeDefenseProfile,
      targetingProfile: { self: true },
      gatingProfile,
      confidence: activeDefenseProfile.acBuff || activeDefenseProfile.saveBuff ? "high" : "medium",
      reasons: [t("ActReason.DefensiveActionImprovesSurvival", "Defensive action improves survival until the next turn.")],
    });
  }

  if (hasName(action, /\brunning reload\b/) || /\b(?:strides?|steps?|sneaks?).*\breload\b/.test(text)) {
    return inferred("mobility", {
      activityProfile: {
        ...baseProfile(["stride", "setup"]),
        strideCount: 1,
        reload: true,
      },
      targetingProfile: { self: true },
      setupFor: ["strike", "damage"],
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.RunningReloadRepositionsAnd", "Running Reload repositions and reloads for ranged offense.")],
    });
  }

  if (
    isConsumable(action, traits)
    && (damageProfile?.type === "healing" || /\bregains? .*hit points\b|\brestore .*hit points\b/.test(text))
  ) {
    return inferred("healing", {
      activityProfile: {
        ...baseProfile(["healing"]),
        consumable: true,
        interactDraw: Number(parsedCost?.interactDrawCost) > 0,
      },
      targetingProfile: { ally: true, self: true },
      damageProfile,
      gatingProfile,
      confidence: damageProfile ? "high" : "medium",
      reasons: [t("ActReason.ConsumableCanRestoreHit", "Consumable can restore Hit Points.")],
    });
  }

  if (
    hasName(action, /\bconsume flesh\b/)
    || (damageProfile?.type === "healing" && /\bcorpse\b|\bdevours?\b|\bregains? .*hit points\b/.test(text))
  ) {
    return inferred("self-healing", {
      activityProfile: {
        ...baseProfile(["healing"]),
        requiresCorpse: /\bcorpse\b/.test(text),
      },
      targetingProfile: { self: true },
      damageProfile,
      gatingProfile,
      confidence: damageProfile ? "high" : "medium",
      reasons: [t("ActReason.ActionCanRestoreHit", "Action can restore Hit Points if its requirement is met.")],
    });
  }

  if (
    hasName(action, /\b(?:drink blood|blood drain)\b/)
    || (/\b(?:drained|drains? blood)\b/.test(text) && /\bregains? .*hit points\b|\bvampire\b/.test(text))
  ) {
    return inferred("drain", {
      activityProfile: {
        ...baseProfile(["damage", "healing", "control"]),
        requiresAnyTargetCondition: ["grabbed", "restrained", "paralyzed", "unconscious"],
        appliesCondition: "drained",
        selfHealing: true,
      },
      targetingProfile: { enemy: true, reach: true },
      saveProfile,
      damageProfile,
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.DrinkBloodPunishesA", "Drink Blood punishes a grabbed or helpless target and heals the actor.")],
    });
  }

  if (hasLocalize(action, "glossary.grab") || hasName(action, /\b(?:grab|improved grab)\b/)) {
    const requiresPreviousStrike = hasLocalize(action, "glossary.grab")
      || hasName(action, /\bimproved grab\b/)
      || /\blast action\b.*\bstrike\b/.test(text);
    return inferred("grab", {
      activityProfile: {
        ...baseProfile(["grab"]),
        includesGrab: true,
        appliesCondition: "grabbed",
        npcFamily: "grab-rider",
        requiresPreviousStrike,
        previousActionRequirements: requiresPreviousStrike ? ["after-strike"] : [],
      },
      targetingProfile: { enemy: true, reach: true },
      gatingProfile,
      confidence: hasLocalize(action, "glossary.grab") ? "high" : "medium",
      reasons: [t("ActReason.CreatureCanGrabA", "Creature can grab a target.")],
    });
  }

  if (hasLocalize(action, "glossary.constrict") || hasName(action, /\bconstrict\b/)) {
    return inferred("save-damage", {
      activityProfile: {
        ...baseProfile(["damage", "control"]),
        npcFamily: "grab-followup",
        requiresTargetCondition: "grabbed",
      },
      targetingProfile: { enemy: true, reach: true },
      saveProfile,
      damageProfile,
      gatingProfile,
      confidence: saveProfile && damageProfile ? "high" : "medium",
      reasons: [t("ActReason.ConstrictDamagesAGrabbed", "Constrict damages a grabbed target.")],
    });
  }

  if (hasLocalize(action, "glossary.swallowwhole") || hasName(action, /\bswallow whole\b/)) {
    return inferred("control", {
      activityProfile: {
        ...baseProfile(["damage", "control"]),
        npcFamily: "swallow-whole",
        requiresTargetCondition: "grabbed",
        containsTarget: true,
      },
      targetingProfile: { enemy: true, reach: true },
      saveProfile,
      damageProfile,
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.SwallowWholeIsUseful", "Swallow Whole is useful against a grabbed target.")],
    });
  }

  if (hasLocalize(action, "glossary.trample") || hasName(action, /\btrample\b/)) {
    return inferred("mobility-attack", {
      activityProfile: {
        ...baseProfile(["stride", "damage"]),
        npcFamily: traits.includes("troop") ? "troop-action" : "trample",
        strideCount: /\bdouble\b/.test(text) ? 2 : 1,
      },
      targetingProfile: {
        area: true,
        type: "path",
        enemy: true,
      },
      saveProfile,
      damageProfile,
      gatingProfile,
      confidence: saveProfile && damageProfile ? "high" : "medium",
      reasons: [t("ActReason.TrampleMovesThroughEnemies", "Trample moves through enemies and deals damage.")],
    });
  }

  if (hasLocalize(action, "glossary.knockdown") || hasName(action, /\bknockdown\b/)) {
    return inferred("control", {
      activityProfile: {
        ...baseProfile(mentionsStrike ? ["strike", "control"] : ["control"]),
        appliesCondition: "prone",
      },
      targetingProfile: { enemy: true, reach: true },
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.KnockdownCanLeaveTarget", "Knockdown can leave target prone.")],
    });
  }

  if (hasLocalize(action, "glossary.rend") || hasName(action, /\brend\b/)) {
    return inferred("damage", {
      activityProfile: {
        ...baseProfile(["damage"]),
        requiresMultipleHits: true,
      },
      targetingProfile: { enemy: true, reach: true },
      damageProfile,
      gatingProfile,
      confidence: damageProfile ? "high" : "medium",
      reasons: [t("ActReason.RendRewardsRepeatedHits", "Rend rewards repeated hits on one target.")],
    });
  }

  if (hasName(action, /\bgaze\b/) || /\bgaze\b/.test(text)) {
    return inferred(damageProfile ? "save-damage" : "control", {
      activityProfile: {
        ...baseProfile(["control"]),
        npcFamily: "gaze",
      },
      targetingProfile: { enemy: true, maxRange: rangeProfile.maxRange ?? 30 },
      saveProfile,
      damageProfile,
      gatingProfile,
      confidence: saveProfile || damageProfile ? "high" : "medium",
      reasons: [t("ActReason.GazeAbilityCanPressure", "Gaze ability can pressure enemies without a weapon Strike.")],
    });
  }

  if (templateProfile && saveProfile && damageProfile) {
    const breathWeapon = hasName(action, /\bbreath(?: weapon)?\b/) || /\bbreathes?\b/.test(text);
    const deathTrigger = hasName(action, /\bdeath (?:throes|burst|explosion)\b/)
      || /\bwhen .* dies\b|\bupon death\b|\bwhen reduced to 0 hit points\b/.test(text);
    return inferred("area-damage", {
      activityProfile: withTargetConditionRequirement({
        ...baseProfile(["damage", "area"]),
        ...(breathWeapon ? { npcFamily: "breath-weapon" } : {}),
        ...(deathTrigger ? { npcFamily: "death-trigger" } : {}),
      }, targetConditionRequirement),
      targetingProfile: { ...templateProfile, ...rangeProfile },
      saveProfile,
      damageProfile,
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.AreaDamageWithSaving", "Area damage with saving throw is recognized.")],
    });
  }

  if (isConsumable(action, traits) && actionCategory(action) === "poison") {
    return inferred("setup", {
      activityProfile: withTargetConditionRequirement(baseProfile(["setup"]), targetConditionRequirement),
      targetingProfile: { self: true },
      setupFor: ["strike", "damage"],
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.PoisonSetsUpA", "Applying this poison sets up a stronger follow-up Strike.")],
    });
  }

  if (saveProfile && damageProfile && offensive) {
    return inferred("save-damage", {
      activityProfile: withTargetConditionRequirement(baseProfile(["damage"]), targetConditionRequirement),
      targetingProfile: mergeTargetingProfile({ enemy: true }, rangeProfile, targetRequirementProfile),
      saveProfile,
      damageProfile,
      gatingProfile,
      confidence: "high",
      reasons: [t("ActReason.SavingThrowDamageIs", "Saving throw damage is recognized.")],
    });
  }

  if (saveProfile && offensive) {
    return inferred("control", {
      activityProfile: withTargetConditionRequirement(baseProfile(["control"]), targetConditionRequirement),
      targetingProfile: mergeTargetingProfile({ enemy: true }, rangeProfile, targetRequirementProfile),
      saveProfile,
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.SavingThrowControlAction", "Saving throw control action is recognized.")],
    });
  }

  const buffProfile = readBuffProfile(text);
  if (buffProfile && !saveProfile && !damageProfile && !mentionsStrike && !offensive) {
    return inferred("buff", {
      activityProfile: {
        ...baseProfile(["buff"]),
        ...buffProfile,
        ...(traits.includes("aura") ? { aura: true, npcFamily: "aura" } : {}),
      },
      targetingProfile: buffProfile.ally ? { ally: true, self: true } : { self: true },
      setupFor: (buffProfile.attackBuff || buffProfile.extraAction) ? ["strike", "damage"] : [],
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.ActionGrantsABeneficial", "Action grants a beneficial effect to the actor or an ally.")],
    });
  }

  const commandSupportProfile = readCommandSupportProfile(text);
  if (commandSupportProfile && !isEquipmentActivation(action) && !saveProfile && !damageProfile) {
    return inferred("buff", {
      activityProfile: commandSupportProfile,
      targetingProfile: { ally: true },
      setupFor: commandSupportProfile.extraAction || commandSupportProfile.attackBuff ? ["strike", "damage"] : [],
      gatingProfile,
      confidence: commandSupportProfile.extraAction ? "high" : "medium",
      reasons: [t("ActReason.CommandSupportsAllies", "Command action lets an ally contribute this turn.")],
    });
  }

  // Some impulses/summons describe a SEPARATE creature moving ("you can have the crawling fire Stride
  // up to 40 feet"), not the actor. That Stride is the minion's (done via Sustain), so it must not be
  // read as the actor's own movement — otherwise the whole action gets move-gated (e.g. shown as
  // unavailable while the actor is prone). Only exclude prose-detected movement; the "move" trait
  // stays authoritative for real move actions.
  const directsOtherToMove =
    /\b(?:have|lets?|allow|command|order|direct|cause|make)\s+(?:the|your|its?|their|them|him|her|a|an)\s+[^.]{0,40}?\b(?:strides?|steps?|flies?|fly|burrows?|swims?|climbs?|moves?|leaps?)\b/.test(text);
  const actorMovesInProse =
    /\bstrides? twice\b|\bstrides? up to\b|\bmoves? up to\b|\bleaps? up to\b|\bjumps? up to\b|\bflies? up to\b|\bflies? twice\b|\bburrows? twice\b/.test(text);
  if (!mentionsStrike && (
    traits.includes("move")
    || (actorMovesInProse && !directsOtherToMove)
  )) {
    const strideCount = /\bhalf (?:its|his|her|their|the) speed\b/.test(text)
      ? 0.5
      : (/\btwice\b|\bdouble\b/.test(text) ? 2 : 1);
    const fixedDistance = readMovementDistance(text);
    return inferred("mobility", {
      activityProfile: {
        ...baseProfile(["stride"]),
        strideCount,
        fixedDistance,
        safeMovement: /doesn.t trigger reactions|does not trigger reactions|bonus to ac against reactions/.test(text),
        retreat: /\bnot adjacent to any enemy\b|\bretreat\b/.test(text),
      },
      targetingProfile: { self: true },
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.MovementActivityIsRecognized", "Movement activity is recognized.")],
    });
  }

  if (traits.includes("teleportation") || /\bteleport|\bteleportation\b/.test(text)) {
    return inferred("mobility", {
      activityProfile: { ...baseProfile(["teleport"]), teleport: true },
      targetingProfile: { self: true },
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.TeleportationRepositionsTheActor", "Teleportation repositions the actor.")],
    });
  }

  if ((traits.includes("polymorph") || traits.includes("morph")) && !mentionsStrike) {
    return inferred("transformation", {
      activityProfile: {
        ...baseProfile(["transformation"]),
        polymorph: traits.includes("polymorph"),
      },
      targetingProfile: { self: true },
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.FormChangeAltersThe", "Form change alters the actor's options.")],
    });
  }

  if (traits.includes("summon") || /\bsummon (?:a|an|the|forth)\b|\bconjures?\b/.test(text)) {
    return inferred("summon", {
      activityProfile: baseProfile(["summon"]),
      targetingProfile: { self: true },
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.SummonsAnAllyOr", "Summons an ally or construct to the battlefield.")],
    });
  }

  if (traits.includes("aura")) {
    return inferred("buff", {
      activityProfile: { ...baseProfile(["buff"]), aura: true, ally: true, npcFamily: "aura" },
      targetingProfile: { ally: true, self: true },
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.AuraAffectsTheActor", "Aura affects the actor and nearby allies.")],
    });
  }

  const captureRestraintProfile = readCaptureRestraintProfile(text);
  if (captureRestraintProfile && !isEquipmentActivation(action)) {
    return inferred("control", {
      activityProfile: withTargetConditionRequirement(captureRestraintProfile, targetConditionRequirement),
      targetingProfile: mergeTargetingProfile({ enemy: true, reach: true }, rangeProfile, targetRequirementProfile),
      gatingProfile,
      confidence: captureRestraintProfile.appliesCondition ? "high" : "medium",
      reasons: [t("ActReason.CaptureActionCanRestrain", "Capture action can restrain or immobilize a target.")],
    });
  }

  // Attack-trait actions whose effect lives in prose / rules rather than a
  // structured save or @Damage (e.g. Elemental Blast, athletics-free maneuvers).
  if (!mentionsStrike && (offensive || traits.includes("attack"))) {
    const proseDamage = /\b(?:deals?|takes?)\b[^.]*\bdamage\b|\b\d+d\d+\b[^.]*\bdamage\b/.test(text);
    return proseDamage
      ? inferred("damage", {
        activityProfile: baseAttackProfile(),
        targetingProfile: mergeTargetingProfile({ enemy: true, reach: true }, rangeProfile, targetRequirementProfile),
        gatingProfile,
        confidence: "low",
        reasons: [t("ActReason.OffensiveActionDealsDamage", "Offensive action deals damage.")],
      })
      : inferred("control", {
        activityProfile: baseProfile(["control"]),
        targetingProfile: mergeTargetingProfile({ enemy: true, reach: true }, rangeProfile, targetRequirementProfile),
        gatingProfile,
        confidence: "low",
        reasons: [t("ActReason.OffensiveManeuverPressuresA", "Offensive maneuver pressures a target.")],
      });
  }

  if (!mentionsStrike) {
    // Recognized active action with no tactical pattern — surface as a low-priority
    // option instead of dropping it. Reactions/free actions without a pattern stay
    // null so they are not treated as turn-economy filler.
    if (isReaction || isFree) return null;
    return inferred("utility", {
      activityProfile: baseProfile(["utility"]),
      targetingProfile: { self: true },
      gatingProfile,
      confidence: "low",
      reasons: [t("ActReason.ActionIsAvailableBut", "Action is available but has no recognized tactical pattern.")],
    });
  }

  // mentionsMultipleStrikes is deliberately excluded here: its "up to...strikes"
  // clause false-positives on movement-distance phrasing ("Strides up to its
  // Speed... Strike"), which would misclassify genuine single-strike
  // mobility-attacks (e.g. Rending Pounce) as multiattack.
  if (mentionsStride && !mentionsDifferentTargets) {
    const strideCount = /\b(?:strides?|steps?|moves?|leaps?|jumps?|bounds?|springs?)\s+twice\b/.test(text)
      ? 2
      : 1;
    return inferred("mobility-attack", {
      activityProfile: {
        includes: [...Array(strideCount).fill("stride"), "strike"],
        strideCount,
        includesStrike: true,
        requiresBackingStrike: true,
      },
      targetingProfile: { enemy: true, reachAfterMove: true },
      gatingProfile,
      confidence: "medium",
      reasons: [t("ActReason.MoveAndStrikeActivity", "Move-and-Strike activity is recognized.")],
    });
  }

  if (mentionsDifferentTargets || mentionsMultipleStrikes) {
    const distinctStrikeCount = mentionsDifferentTargets ? readDistinctStrikeCount(text) : null;
    // A same-target multi-strike ability (never a distinct-target one -- that shape already
    // has its own borrowed-weapon handling above) may require either two specific held melee
    // weapons (Twin Takedown/Twin Feint/Double Slice) or a single weapon of a restricted class
    // (Hunted Shot's ranged/reload-0, Flurry of Blows' unarmed). mapAppliesPerStrike mirrors
    // whichever MAP phrasing the ability's own text used: readMapAttacks already found an
    // explicit "counts as N attacks" (Double Slice) means shared-tier, like Double Attack;
    // finding none means "apply ... normally" per-strike escalation, like the other three.
    const weaponRequirement = !mentionsDifferentTargets ? readWeaponRequirement(action) : null;
    const mentionsUnarmedStrikes = !mentionsDifferentTargets && !weaponRequirement && /\bunarmed strikes?\b/.test(text);
    const backingStrikeProfile = (weaponRequirement || mentionsUnarmedStrikes)
      ? {
        // baseAttackProfile()'s default includes:["strike"] is a single atom -- without this
        // override, builderAtomicActionsForStep never splits the ability into real per-weapon
        // Strike atoms at all, silently defeating the whole borrowed-weapon mechanism.
        includes: Array(readDistinctStrikeCount(text)).fill("strike"),
        requiresBackingStrike: true,
        ...(weaponRequirement?.requiresDualBackingStrike ? { requiresDualBackingStrike: true } : {}),
        ...(weaponRequirement?.backingStrikeFilter ? { backingStrikeFilter: weaponRequirement.backingStrikeFilter } : {}),
        ...(mentionsUnarmedStrikes ? { backingStrikeFilter: "unarmed" } : {}),
        ...(mapAttacks === null ? { mapAppliesPerStrike: true } : {}),
      }
      : {};
    return inferred("multiattack", {
      activityProfile: {
        ...baseAttackProfile(),
        multiStrike: true,
        delayedMap: mentionsDelayedMap,
        ...(mapAttacks !== null ? { mapAttacks } : {}),
        ...(distinctStrikeCount ? { includes: Array(distinctStrikeCount).fill("strike"), requiresDistinctTargets: true, distinctStrikeCount } : {}),
        ...backingStrikeProfile,
      },
      targetingProfile: {
        enemy: true,
        separateTargets: mentionsDifferentTargets,
      },
      gatingProfile,
      confidence: mentionsDifferentTargets ? "high" : "medium",
      reasons: [t("ActReason.MultiStrikeActivityIs", "Multi-Strike activity is recognized.")],
    });
  }

  return inferred("damage", {
    activityProfile: {
      ...baseAttackProfile(),
      focusedStrike: mentionsFocusedTarget || actionCost > 1,
      ...(mapAttacks !== null ? { mapAttacks } : {}),
    },
    targetingProfile: { enemy: true, reach: true },
    gatingProfile,
    confidence: mentionsFocusedTarget ? "high" : "medium",
    reasons: [t("ActReason.StrikeBasedDamageActivity", "Strike-based damage activity is recognized.")],
  });
}
