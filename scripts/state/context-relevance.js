import { collectionValues } from "../foundry-data.js";

function stringValues(values) {
  return values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value));
}

function uuidIds(uuid, kind) {
  const parts = String(uuid ?? "").split(".");
  const ids = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === kind) ids.push(parts[index + 1]);
  }
  return ids;
}

function actorIdentityValues(actor) {
  return stringValues([
    actor?.id,
    actor?.uuid,
    actor?.document?.id,
    actor?.document?.uuid,
    ...uuidIds(actor?.uuid, "Actor"),
    ...uuidIds(actor?.document?.uuid, "Actor"),
  ]);
}

function tokenIdentityValues(token) {
  return stringValues([
    token?.id,
    token?.uuid,
    token?.document?.id,
    token?.document?.uuid,
    token?.token?.id,
    token?.token?.uuid,
    ...uuidIds(token?.uuid, "Token"),
    ...uuidIds(token?.document?.uuid, "Token"),
    ...uuidIds(token?.token?.uuid, "Token"),
  ]);
}

function isActorDocument(value) {
  return value?.documentName === "Actor"
    || String(value?.constructor?.name ?? "").includes("Actor")
    || Boolean(value?.itemTypes || value?.prototypeToken);
}

function documentActorValues(document) {
  return [
    isActorDocument(document) ? document : null,
    document?.actor,
    document?.parent,
    document?.parent?.actor,
    document?.parent?.parent,
    document?.document?.actor,
    document?.document?.parent,
    document?.object?.actor,
  ];
}

function documentActorIds(document) {
  return stringValues([
    ...documentActorValues(document).flatMap(actorIdentityValues),
    ...uuidIds(document?.uuid, "Actor"),
    ...uuidIds(document?.document?.uuid, "Actor"),
    ...uuidIds(document?.parent?.uuid, "Actor"),
  ]);
}

function documentTokenIds(document) {
  return stringValues([
    ...tokenIdentityValues(document?.token),
    ...tokenIdentityValues(document?.tokenDocument),
    ...tokenIdentityValues(document?.object),
    ...uuidIds(document?.uuid, "Token"),
    ...uuidIds(document?.document?.uuid, "Token"),
    ...uuidIds(document?.parent?.uuid, "Token"),
  ]);
}

function contextReferences(context) {
  const targets = [
    ...(context?.targets ?? []),
    ...(context?.battlefield?.targets ?? []),
    ...(context?.battlefield?.enemies ?? []),
    ...(context?.battlefield?.allies ?? []),
  ];
  const combatants = collectionValues(context?.combat?.combatants);

  return [
    context?.actor,
    context?.actor?.document,
    context?.combatant?.actor,
    context?.token,
    ...targets.flatMap((target) => [target, target?.actor, target?.token]),
    ...combatants.flatMap((combatant) => [
      combatant?.actor,
      combatant?.token,
      combatant?.token?.object,
      combatant?.tokenDocument,
    ]),
  ];
}

function contextActorIds(context) {
  return new Set(contextReferences(context).flatMap(actorIdentityValues));
}

function contextTokenIds(context) {
  return new Set(contextReferences(context).flatMap(tokenIdentityValues));
}

function intersects(left, right) {
  return left.some((value) => right.has(value));
}

export function documentRelevantToContext(document, context) {
  if (!document || !context) return false;

  const actorIds = contextActorIds(context);
  if (intersects(documentActorIds(document), actorIds)) return true;

  const tokenIds = contextTokenIds(context);
  return intersects(documentTokenIds(document), tokenIds);
}
