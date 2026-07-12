import { normalizedTraits } from "../action/reader-helpers.js";

export function strikeMeleeReach(strike) {
  const reach = Number(strike?.range?.max);
  return Number.isFinite(reach) && reach >= 0 ? reach : 5;
}

export function rangedStrikeReach(strike) {
  const reach = Number(strike?.range?.max ?? strike?.range?.increment);
  return Number.isFinite(reach) && reach > 5 ? reach : 0;
}

export function isRangedStrike(strike) {
  if (rangedStrikeReach(strike) <= 5) return false;
  const traits = normalizedTraits(strike?.traits ?? strike?.item?.system?.traits?.value)
    .map((trait) => String(trait ?? "").toLowerCase());
  return traits.includes("ranged")
    || traits.some((trait) => trait.startsWith("thrown-"))
    || Number(strike?.range?.max ?? strike?.range?.increment) > 10;
}

export function candidateAverageDamage(candidate) {
  const values = [
    candidate?.damageProfile?.average,
    candidate?.activityProfile?.averageDamage,
    candidate?.averageDamage,
  ];
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) {
      const multiplier = candidate?.activityProfile?.damageScalesWithActions
        ? Math.max(1, Number(candidate?.actionCost) || 1)
        : 1;
      return number * multiplier;
    }
  }
  return 0;
}
