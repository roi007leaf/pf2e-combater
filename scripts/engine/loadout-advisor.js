import { contextActorDocument } from "./actor-context.js";
import {
  drawableSwapItems,
  heldSwapItems,
  isShieldItem,
  isWeaponItem,
  itemHandsRequired,
} from "./equipment-items.js";
import { damageAdjustment } from "./scoring/facts.js";
import { canAttackTarget, contextEnemies, contextTargets } from "./target-pool.js";
import { systemValue, traitSlugs } from "../foundry-data.js";
import { actorStrikeOptions } from "../readers/action/reader.js";
import { entityThreatReach } from "../rules/battlefield-analysis.js";
import { t } from "../i18n.js";

const MIN_IMPROVEMENT = 12;
const MAX_RECOMMENDATIONS = 5;

function itemId(item) {
  return String(item?.id ?? item?._id ?? item?.uuid ?? "");
}

function identityValues(item) {
  return [item?.id, item?._id, item?.uuid].filter(Boolean).map(String);
}

function sameItem(left, right) {
  const rightIds = new Set(identityValues(right));
  return identityValues(left).some((id) => rightIds.has(id));
}

function numeric(value, fallback = null) {
  const result = Number(systemValue(value));
  return Number.isFinite(result) ? result : fallback;
}

function diceAverage(formula) {
  const text = String(formula ?? "");
  let total = 0;
  let matched = false;
  for (const [, count, faces] of text.matchAll(/(\d+)d(\d+)/g)) {
    total += Number(count) * ((Number(faces) + 1) / 2);
    matched = true;
  }
  for (const flat of text.match(/[+-]\s*\d+(?!d)/g) ?? []) {
    total += Number(flat.replace(/\s/g, ""));
    matched = true;
  }
  return matched ? total : null;
}

function rawWeaponDamageProfile(item) {
  const rolls = Object.values(item?.system?.damageRolls ?? {});
  if (rolls.length) {
    const entries = rolls.map((roll) => ({
      average: diceAverage(roll?.damage ?? roll?.formula),
      type: String(roll?.damageType ?? roll?.type ?? "").toLowerCase(),
    }));
    const average = entries.reduce((total, entry) => total + (Number(entry.average) || 0), 0);
    const types = [...new Set(entries.map((entry) => entry.type).filter(Boolean))];
    return { average: average || null, type: types[0] ?? null, types };
  }

  const damage = item?.system?.damage ?? {};
  const faces = Number(String(damage?.die ?? "").replace(/\D/g, ""));
  const dice = numeric(damage?.dice, 1);
  const modifier = numeric(damage?.modifier, 0);
  const type = String(damage?.damageType ?? damage?.type ?? "").toLowerCase();
  const average = faces > 0 && dice > 0 ? dice * ((faces + 1) / 2) + modifier : null;
  return { average, type: type || null, types: type ? [type] : [] };
}

function rawWeaponRange(item) {
  const range = item?.system?.range;
  const increment = numeric(range?.increment ?? range, null);
  const max = numeric(range?.max, null);
  if (max !== null && max > 0) return { max, increment: increment ?? undefined };
  if (increment !== null && increment > 0) return { max: increment, increment };
  const traits = traitSlugs(item);
  const thrown = traits
    .map((trait) => String(trait).match(/^thrown-(\d+)$/)?.[1])
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (thrown.length) return { max: Math.max(...thrown) };
  const reach = traits
    .map((trait) => String(trait).match(/^reach-(\d+)$/)?.[1])
    .map(Number)
    .filter((value) => Number.isFinite(value));
  return { max: reach.length ? Math.max(...reach) : traits.includes("reach") ? 10 : 5 };
}

function rawWeaponAction(item) {
  const damageProfile = rawWeaponDamageProfile(item);
  return {
    id: `loadout-${itemId(item)}`,
    name: item?.name ?? "Weapon",
    source: "strike",
    role: "damage",
    attackTrait: true,
    item,
    traits: traitSlugs(item),
    range: rawWeaponRange(item),
    reload: numeric(item?.system?.reload?.value ?? item?.system?.reload, 0),
    damageProfile,
    averageDamage: damageProfile.average,
    targetingProfile: { enemy: true },
  };
}

function strikeForItem(item, strikes) {
  return strikes.find((strike) => sameItem(strike?.item, item)) ?? rawWeaponAction(item);
}

function targetPool(context) {
  const seen = new Set();
  return [...contextTargets(context), ...contextEnemies(context)]
    .filter(canAttackTarget)
    .filter((target) => {
      const key = String(target?.id ?? target?.uuid ?? target?.name ?? "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function primaryTarget(context) {
  return targetPool(context)[0] ?? null;
}

function strikeModifier(strike) {
  const variants = Array.isArray(strike?.variants)
    ? strike.variants
    : Array.from(strike?.variants?.contents ?? []);
  return numeric(strike?.totalModifier ?? strike?.attackModifier ?? variants[0]?.modifier, 0);
}

function weaponEvaluation(context, item, strike, target) {
  const range = numeric(strike?.range?.max, 5);
  const distance = numeric(target?.distance, null);
  const reachable = distance === null || distance <= range;
  const average = numeric(strike?.damageProfile?.average ?? strike?.averageDamage, 0);
  const reload = numeric(strike?.reload, 0);
  const defense = target ? damageAdjustment(context, strike, target) : null;
  const value = target
    ? 12
      + average * 2
      + Math.max(-10, Math.min(20, strikeModifier(strike)))
      + (reachable ? 34 : -45)
      + (Number(defense?.scoreDelta) || 0)
      - Math.max(0, reload) * 6
    : 0;
  return { kind: "weapon", item, strike, value, range, distance, reachable, average, reload, defense };
}

function actorHpPercent(context) {
  const hp = context?.profile?.hp ?? context?.actor?.profile?.hp;
  if (Number.isFinite(Number(hp?.percent))) return Number(hp.percent);
  const value = numeric(hp?.value, null);
  const max = numeric(hp?.max, null);
  return value !== null && max > 0 ? value / max : 1;
}

function shieldEvaluation(context, item, target) {
  const threatened = target
    ? numeric(target?.distance, Infinity) <= entityThreatReach(target)
    : false;
  const lowHp = actorHpPercent(context) <= 0.5;
  return {
    kind: "shield",
    item,
    value: threatened || lowHp ? 12 + (threatened ? 30 : 0) + (lowHp ? 12 : 0) : 0,
    threatened,
    lowHp,
  };
}

function itemEvaluation(context, item, strikes, target) {
  if (isShieldItem(item)) return shieldEvaluation(context, item, target);
  if (isWeaponItem(item)) return weaponEvaluation(context, item, strikeForItem(item, strikes), target);
  return { kind: "other", item, value: 0 };
}

function improvementReasons(held, draw, target) {
  const reasons = [];
  if (target && held.kind === "weapon" && !held.reachable && draw.kind === "shield") {
    reasons.push(t(
      "Loadout.Reason.UnreachableToShield",
      "{held} cannot reach {target}; {draw} trades unusable offense for a defensive option.",
      { held: held.item.name, target: target.name, draw: draw.item.name },
    ));
  }
  if (draw.kind === "weapon") {
    if (target && draw.reachable && held.kind === "weapon" && !held.reachable) {
      reasons.push(t("Loadout.Reason.Reach", "{draw} can reach {target}; {held} cannot.", {
        draw: draw.item.name,
        target: target.name,
        held: held.item.name,
      }));
    } else if (target && draw.reachable && held.kind !== "weapon") {
      reasons.push(t("Loadout.Reason.ReadyAttack", "{draw} readies an attack against {target}.", { draw: draw.item.name, target: target.name }));
    }
    for (const reason of draw.defense?.positiveReasons ?? []) reasons.push(reason);
    if (held.kind === "weapon" && held.defense?.immune && !draw.defense?.immune) {
      reasons.push(t("Loadout.Reason.AvoidImmunity", "Switch damage type to avoid {target}'s known immunity.", { target: target?.name ?? "target" }));
    } else if (held.kind === "weapon" && held.defense?.resistance > draw.defense?.resistance) {
      reasons.push(t("Loadout.Reason.AvoidResistance", "{draw} loses less damage to {target}'s known resistance.", { draw: draw.item.name, target: target?.name ?? "target" }));
    }
    if (draw.average >= held.average + 2 && draw.reachable) {
      reasons.push(t("Loadout.Reason.Damage", "Higher expected weapon damage ({draw} vs {held}).", {
        draw: Math.round(draw.average * 10) / 10,
        held: Math.round((held.average ?? 0) * 10) / 10,
      }));
    }
    if (draw.reload < (held.reload ?? 0)) {
      reasons.push(t("Loadout.Reason.Reload", "Lower reload cost preserves later actions."));
    }
  }
  if (draw.kind === "shield") {
    if (draw.threatened) reasons.push(t("Loadout.Reason.ShieldThreat", "A nearby enemy makes a readied shield valuable."));
    if (draw.lowHp) reasons.push(t("Loadout.Reason.ShieldLowHp", "Low HP increases defensive loadout value."));
  }
  if (!reasons.length) reasons.push(t("Loadout.Reason.General", "Better fit for current battlefield conditions."));
  return reasons.slice(0, 3);
}

function handLegalSwap(heldItems, heldItem, drawItem) {
  const occupied = heldItems.reduce((total, item) => total + itemHandsRequired(item), 0);
  return occupied - itemHandsRequired(heldItem) + itemHandsRequired(drawItem) <= 2;
}

export function buildLoadoutAdvice(context) {
  const actor = contextActorDocument(context);
  if (!actor) return [];
  const heldItems = heldSwapItems(actor);
  const drawableItems = drawableSwapItems(actor).filter((item) => isWeaponItem(item) || isShieldItem(item));
  if (!heldItems.length || !drawableItems.length) return [];

  const target = primaryTarget(context);
  const strikes = actorStrikeOptions(actor, context, { includeUnready: true });
  const heldEvaluations = new Map(heldItems.map((item) => [itemId(item), itemEvaluation(context, item, strikes, target)]));
  const drawEvaluations = new Map(drawableItems.map((item) => [itemId(item), itemEvaluation(context, item, strikes, target)]));
  const recommendations = [];

  for (const heldItem of heldItems) {
    const held = heldEvaluations.get(itemId(heldItem));
    for (const drawItem of drawableItems) {
      if (!handLegalSwap(heldItems, heldItem, drawItem)) continue;
      const draw = drawEvaluations.get(itemId(drawItem));
      const improvement = draw.value - held.value;
      if (improvement < MIN_IMPROVEMENT) continue;
      const reasons = improvementReasons(held, draw, target);
      recommendations.push({
        id: `${itemId(heldItem)}=>${itemId(drawItem)}`,
        actionKey: "swap-items",
        heldItemId: itemId(heldItem),
        heldItemName: String(heldItem?.name ?? "Held item"),
        heldItemImg: heldItem?.img ?? null,
        drawItemId: itemId(drawItem),
        drawItemName: String(drawItem?.name ?? "Worn item"),
        drawItemImg: drawItem?.img ?? null,
        kind: draw.kind,
        targetId: target?.id ?? null,
        targetName: target?.name ?? "",
        score: Math.round(improvement),
        reasons,
        summary: t("Loadout.Summary", "Put away {held} -> draw {draw}", { held: heldItem.name, draw: drawItem.name }),
      });
    }
  }

  return recommendations
    .toSorted((left, right) => right.score - left.score || left.summary.localeCompare(right.summary))
    .slice(0, MAX_RECOMMENDATIONS);
}
