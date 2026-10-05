import {
  intelDefenseFactId,
  intelTraitFactId,
  normalizeIntelLedger,
  NONE_FACT_ID,
} from '../rules/intel-ledger.js';

export function readBestiaryKnowledge(token) {
  const module = globalThis.game?.modules?.get?.('pf2e-bestiary-tracking');
  if (!module?.active || module.api?.version !== 1 || typeof module.api.getKnowledge !== 'function')
    return null;
  try {
    const knowledge = module.api.getKnowledge(token);
    return knowledge?.version === 1 && knowledge.scope === 'party' ? knowledge : null;
  } catch {
    return null;
  }
}

function knownNumber(fact) {
  return typeof fact?.value === 'number' && Number.isFinite(fact.value) ? fact.value : null;
}

function includesFact(value, id) {
  return value === true || (Array.isArray(value) && value.includes(id));
}

export function withBestiaryKnowledge(target, knowledge) {
  if (!knowledge || target?.actor?.type !== 'npc') return target;
  const local = normalizeIntelLedger(target.intelLedger);
  const ledger = { ...local };
  const addFact = (category, id) => {
    if (ledger[category] !== true)
      ledger[category] = [...new Set([...(ledger[category] || []), id])];
  };
  const result = {
    ...target,
    saves: { ...target.saves },
    intelSaveBands: { ...target.intelSaveBands },
  };
  for (const save of ['fortitude', 'reflex', 'will']) {
    const modifier = knownNumber(knowledge.saves?.[save]);
    if (modifier === null || includesFact(local.saves, save)) continue;
    result.saves[save] = modifier + 10;
    delete result.intelSaveBands[save];
    addFact('saves', save);
  }
  const perception = knownNumber(knowledge.perception);
  if (perception !== null && !includesFact(local.perception, 'perception')) {
    result.perception = { dc: perception + 10, mod: perception };
    result.perceptionDC = perception + 10;
    result.intelPerceptionBand = null;
    addFact('perception', 'perception');
  }
  const ac = knownNumber(knowledge.ac);
  if (ac !== null) {
    result.ac = ac;
    result.bestiaryAcKnown = true;
  }
  const traits = (Array.isArray(knowledge.traits) ? knowledge.traits : []).filter(
    (trait) => typeof trait === 'string',
  );
  result.traits = [...new Set([...(target.traits ?? []), ...traits])];
  for (const trait of traits) addFact('traits', intelTraitFactId(trait));
  const identity = knowledge.name?.display ?? knowledge.name?.value;
  if (typeof identity === 'string' && identity && !includesFact(local.identity, 'identity')) {
    result.identityName = identity;
    addFact('identity', 'identity');
  }
  if (
    [knowledge.actions, knowledge.passives]
      .flatMap((entries) => (Array.isArray(entries) ? entries : []))
      .some((entry) => /^(reactive strike|attack of opportunity)$/i.test(String(entry.name ?? '')))
  ) {
    result.reactiveStrike = true;
    result.reactiveStrikeKnown = true;
  }
  for (const category of ['weaknesses', 'resistances', 'immunities']) {
    const revealed = Array.isArray(knowledge[category]) ? knowledge[category] : [];
    const showValue = category !== 'immunities';
    const facts = revealed
      .filter((entry) => !entry.empty && typeof entry.type === 'string')
      .map((entry) => ({
        type: entry.type,
        ...(knownNumber(entry) !== null && showValue ? { value: entry.value } : {}),
        exceptions: Array.isArray(entry.exceptions) ? [...entry.exceptions] : [],
        ...(category === 'resistances'
          ? { doubleVs: Array.isArray(entry.doubleVs) ? [...entry.doubleVs] : [] }
          : {}),
      }));
    if (!facts.length && !revealed.some((entry) => entry.empty)) continue;
    const existing = Array.isArray(target[category]) ? target[category] : [];
    const merged = existing.filter(
      (entry) =>
        !facts.some((fact) => fact.type === entry.type) ||
        includesFact(local[category], intelDefenseFactId(entry, { showValue })),
    );
    for (const entry of facts) {
      if (
        merged.some(
          (value) =>
            value.type === entry.type &&
            includesFact(local[category], intelDefenseFactId(value, { showValue })),
        )
      )
        continue;
      merged.push(entry);
      addFact(category, intelDefenseFactId(entry, { showValue }));
    }
    if (revealed.some((entry) => entry.empty)) addFact(category, NONE_FACT_ID);
    result[category] = merged;
  }
  result.intelLedger = normalizeIntelLedger(ledger);
  result.actor = { ...target.actor, intelLedger: result.intelLedger };
  return result;
}
