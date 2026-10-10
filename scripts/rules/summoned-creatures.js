import { contextActorDocument } from "../engine/actor-context.js";
import { contextAllies, canAttackTarget } from "../engine/target-pool.js";

export function summonIdentity(actor) {
  // Foundry getFlag rejects inactive module scopes. Stored summon ownership
  // remains useful even when the optional Assistant is disabled or uninstalled.
  const owner = actor?.flags?.["pf2e-summons-assistant"]?.summoner;
  const traits = actor?.system?.traits?.value ?? [];
  return {
    summoned: Array.from(traits).includes("summoned"),
    summonerId: owner?.id ?? null,
    summonerUuid: owner?.uuid ?? null,
  };
}

export function isSummonBuff(action) {
  return action?.slug === "fortify-summoning";
}

export function summonedRecipients(context, action) {
  const caster = contextActorDocument(context) ?? context?.actor;
  const range = Number(action?.targetingProfile?.maxRange ?? action?.range?.max ?? 30);
  const seen = new Set();
  return [...(context?.summons ?? []), ...contextAllies(context)].filter((entity) => {
    const identity = entity?.summoned !== undefined ? entity : summonIdentity(entity?.actor?.document ?? entity?.actor);
    if (!identity.summoned || !canAttackTarget(entity)) return false;
    if (identity.summonerUuid && identity.summonerUuid !== caster?.uuid) return false;
    if (!identity.summonerUuid && identity.summonerId && identity.summonerId !== caster?.id) return false;
    if (!Number.isFinite(Number(entity.distance)) || Number(entity.distance) > range) return false;
    const key = entity.id ?? entity.uuid;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
