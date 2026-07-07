import { collectionValues, systemValue } from "../foundry-data.js";
import { contextActorDocument } from "../engine/actor-context.js";
import { slugify } from "../engine/action/text.js";
import { pf2eActionName, t } from "../i18n.js";
import { contextProfile } from "./action/reader-helpers.js";

function availability(available, reason) {
  return { available, reason };
}

// "Already cast" (Drain Bonded Item, Recharge, ...) genuinely means cast on some earlier occasion
// -- unlike the planner (which has no record of casts from before the current turn's plan), the
// actor's real spellcasting data already tracks this: a prepared slot's `expended` flag, or a
// spontaneous slot's value having dropped below its max, both only happen once something has
// actually been cast. A fully-rested caster (e.g. round 1 of combat) has neither, so there is
// nothing yet to recover.
function hasExpendedSpellResource(actor) {
  const entries = collectionValues(actor?.itemTypes?.spellcastingEntry);
  return entries.some((entry) => {
    const slots = entry?.system?.slots ?? {};
    return Object.values(slots).some((slot) => {
      const prepared = Array.isArray(slot?.prepared) ? slot.prepared : [];
      if (prepared.length) return prepared.some((preparedSpell) => preparedSpell?.expended === true);
      const remaining = Number(systemValue(slot?.value ?? slot?.remaining));
      const max = Number(systemValue(slot?.max ?? slot?.maximum));
      return Number.isFinite(remaining) && Number.isFinite(max) && remaining < max;
    });
  });
}

export function readResourceRecoveryAvailability(tactic, context) {
  if (!tactic?.activityProfile?.recoversSpellResource) return availability(true, "");
  if (hasExpendedSpellResource(contextActorDocument(context))) return availability(true, "");
  return availability(false, t("Avail.NoExpendedSpell", "No spell has been cast yet today to recover."));
}

export function readShieldBlockAvailability(slug, item, context) {
  if (!isShieldBlockAction(slug, item)) return availability(true, "");
  if (shieldBlockDefenseActive(context)) return availability(true, "");
  return availability(false, t("Avail.ShieldBlockNeedsShield", "Shield Block requires Raise a Shield or an active Shield spell."));
}

function isShieldBlockAction(slug, item) {
  return slug === "shield-block" || slugify(item?.name) === "shield-block";
}

function actorHasShieldBlockAction(actor) {
  const items = [
    ...collectionValues(actor?.itemTypes?.action),
    ...collectionValues(actor?.itemTypes?.feat),
    ...collectionValues(actor?.itemTypes?.feature),
    ...collectionValues(actor?.items),
  ];
  return items.some((item) => isShieldBlockAction(slugify(item?.slug ?? item?.system?.slug ?? item?.name), item));
}

function shieldEffectEntries(context) {
  const profile = contextProfile(context);
  const actor = contextActorDocument(context);
  return [
    ...collectionValues(profile?.effects),
    ...collectionValues(context?.actor?.profile?.effects),
    ...collectionValues(context?.profile?.effects),
    ...collectionValues(actor?.itemTypes?.effect),
    ...collectionValues(actor?.items).filter((item) => item?.type === "effect"),
  ];
}

function effectSlugKeys(effect) {
  return [
    effect?.slug,
    effect?.name,
    effect?.sourceId,
  ].map(slugify).filter(Boolean);
}

// Matches the Shield spell's effect ("Spell Effect: Shield", slug spell-effect-shield) while
// tolerating rank/variant suffixes (e.g. spell-effect-shield-rank-1). Deliberately does NOT
// match "effect-shield-immunity" (the post-Shield-Block cooldown, which BLOCKS using it).
function isShieldSpellEffectKey(key) {
  if (typeof key !== "string") return false;
  if (key === "effect-shield") return true;
  if (key.startsWith("effect-shield-immunity")) return false;
  return key.startsWith("spell-effect-shield");
}

function isRaisedShieldEffectKey(key) {
  return key === "effect-raise-a-shield"
    || key === "raise-a-shield"
    || key === "raised-shield";
}

function shieldSpellDefenseActive(context) {
  const profile = contextProfile(context);
  if (profile?.combatState?.shieldSpellActive === true) return true;

  return shieldEffectEntries(context).some((effect) =>
    effectSlugKeys(effect).some(isShieldSpellEffectKey),
  );
}

function shieldBlockDefenseActive(context) {
  const profile = contextProfile(context);
  if (profile?.combatState?.raisedShieldActive === true || profile?.combatState?.shieldSpellActive === true) {
    return true;
  }

  return shieldEffectEntries(context).some((effect) =>
    effectSlugKeys(effect).some((key) => isRaisedShieldEffectKey(key) || isShieldSpellEffectKey(key)),
  );
}

export function readShieldSpellBlockActions(actor, context) {
  if (!shieldSpellDefenseActive(context)) return [];
  if (actorHasShieldBlockAction(actor)) return [];

  const trigger = t("Reason.ShieldBlockTrigger", "You would take damage from an attack while your Shield spell is active.");
  // This is a standing reaction the Shield spell makes available: it should appear whenever the
  // shield is active, not only when an incoming-attack event is already in context (which never
  // happens on the caster's own turn). The trigger is shown for reference, not as a gate.
  const shieldBlockAvailability = readShieldBlockAvailability("shield-block", { name: "Shield Block" }, context);
  return [{
    id: "spell-shield-block",
    name: pf2eActionName("shield-block", "Shield Block"),
    slug: "shield-block",
    actionCost: "reaction",
    actionType: "reaction",
    activationActionCost: "reaction",
    source: "spell-inferred",
    confidence: "high",
    executable: "chat-guidance",
    detected: true,
    available: shieldBlockAvailability.available,
    unavailableReason: shieldBlockAvailability.reason,
    item: null,
    trigger,
    role: "defense",
    activityProfile: { reaction: true, spell: true, shieldBlock: true },
    targetingProfile: { self: true },
    saveProfile: null,
    damageProfile: null,
    gatingProfile: null,
    setupFor: [],
    reasons: [t("Reason.ShieldBlockActive", "Shield spell grants Shield Block while active.")],
    traits: [],
    attackTrait: false,
  }];
}
