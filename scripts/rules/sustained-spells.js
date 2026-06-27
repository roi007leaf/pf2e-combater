import { readSpellActions } from "../readers/spell-reader.js";
import { readDraftPlan } from "../state/draft-plans.js";
import { MODULE_ID } from "../constants.js";

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return Object.values(collection);
}

function systemValue(value) {
  if (value && typeof value === "object" && "value" in value) return value.value;
  return value;
}

function actorDocument(context) {
  return context?.actor?.document ?? context?.combatant?.actor ?? context?.actor ?? null;
}

function normalizeSlug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displayName(value) {
  return String(value ?? "")
    .replace(/^(?:spell\s*)?effect:\s*/i, "")
    .trim();
}

function spellKey(action) {
  return normalizeSlug(action?.slug ?? action?.item?.slug ?? action?.item?.system?.slug ?? action?.name);
}

function spellName(action) {
  return action?.name ?? action?.item?.name ?? action?.slug ?? "Sustained spell";
}

function spellIdentityValues(action) {
  return [
    action?.id,
    action?.uuid,
    action?.sourceId,
    action?.slug,
    action?.item?.id,
    action?.item?._id,
    action?.item?.uuid,
    action?.item?.sourceId,
    action?.item?.system?.slug,
    action?.item?.slug,
    action?.item?.name,
    action?.name,
  ].filter(Boolean).map((value) => String(value).toLowerCase());
}

function documentFlag(document, scope, key) {
  return document?.getFlag?.(scope, key)
    ?? document?.flags?.[scope]?.[key]
    ?? null;
}

function effectDocuments(actor) {
  const typedEffects = collectionValues(actor?.itemTypes?.effect);
  const typedIds = new Set(typedEffects.map((effect) => effect?.id ?? effect?._id).filter(Boolean));
  const fallbackEffects = collectionValues(actor?.items)
    .filter((item) => item?.type === "effect")
    .filter((item) => !typedIds.has(item?.id ?? item?._id));
  const activeEffects = collectionValues(actor?.effects)
    .filter((effect) => !typedIds.has(effect?.id ?? effect?._id));
  return [
    ...typedEffects.map((effect) => ({ documentType: "Item", effect })),
    ...fallbackEffects.map((effect) => ({ documentType: "Item", effect })),
    ...activeEffects.map((effect) => ({ documentType: "ActiveEffect", effect })),
  ];
}

function effectSummary(entry) {
  const effect = entry?.effect ?? entry;
  const sourceId = effect?.sourceId
    ?? systemValue(effect?.system?.source)
    ?? effect?.system?.source?.id
    ?? effect?.origin
    ?? effect?.flags?.core?.sourceId
    ?? null;
  const rawSlug = effect?.slug ?? effect?.system?.slug?.value ?? effect?.system?.slug ?? effect?.name;
  return {
    id: effect?.id ?? effect?._id ?? null,
    uuid: effect?.uuid ?? null,
    name: effect?.name ?? effect?.label ?? "Sustained spell effect",
    slug: normalizeSlug(rawSlug),
    sourceId,
    documentType: entry?.documentType ?? (effect?.documentName === "ActiveEffect" ? "ActiveEffect" : "Item"),
  };
}

function isSustainedSpellAction(action) {
  return action?.activityProfile?.spell === true && action?.activityProfile?.sustained === true;
}

function effectMatchesSpell(effect, action) {
  const key = spellKey(action);
  if (!key) return false;
  const effectSlug = normalizeSlug(effect.slug);
  const effectName = normalizeSlug(displayName(effect.name));
  if (effectSlug.includes(key) || effectName === key) return true;

  const source = String(effect.sourceId ?? "").toLowerCase();
  return spellIdentityValues(action).some((identity) => {
    const normalizedIdentity = normalizeSlug(identity);
    return source.includes(identity) || (normalizedIdentity && source.includes(normalizedIdentity));
  });
}

function templateMatchesSpell(document, action) {
  const originUuid = documentFlag(document, MODULE_ID, "originUuid")
    ?? documentFlag(document, "pf2e-combater", "originUuid")
    ?? document?.origin
    ?? null;
  const origin = String(originUuid ?? "").toLowerCase();
  if (!origin) return false;
  return spellIdentityValues(action).some((identity) => {
    const normalizedIdentity = normalizeSlug(identity);
    return origin.includes(identity) || (normalizedIdentity && origin.includes(normalizedIdentity));
  });
}

function sceneEntries() {
  const scenes = collectionValues(globalThis.game?.scenes);
  const activeScene = globalThis.canvas?.scene;
  if (activeScene && !scenes.some((scene) => scene?.id === activeScene.id)) scenes.push(activeScene);
  return scenes;
}

function sceneDocumentEntries(scene, collectionName, embeddedName) {
  const collection = scene?.[collectionName]
    ?? scene?.getEmbeddedCollection?.(embeddedName)
    ?? null;
  return collectionValues(collection);
}

function sceneTemplateRefsForSpell(action) {
  const refs = [];
  for (const scene of sceneEntries()) {
    const sceneId = scene?.id ?? scene?._id ?? null;
    // v14 merged MeasuredTemplate into Region, so area templates are Regions. Reading the legacy
    // `scene.templates` / `MeasuredTemplate` collection throws a deprecation warning on every render
    // (and is removed in v16), so we only read regions now.
    for (const region of sceneDocumentEntries(scene, "regions", "Region")) {
      const regionId = region?.id ?? region?._id ?? null;
      if (!regionId || !templateMatchesSpell(region, action)) continue;
      refs.push({ kind: "region", regionId, ...(sceneId ? { sceneId } : {}) });
    }
  }
  return refs;
}

function dedupeTemplateRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    const id = ref.regionId ?? ref.templateId ?? ref.id;
    const key = `${ref.kind}:${ref.sceneId ?? ""}:${id ?? ""}`;
    if (!id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function templateRefsForSpell(draft, action) {
  const key = spellKey(action);
  const refs = [];
  for (const step of Array.isArray(draft?.steps) ? draft.steps : []) {
    const stepAction = step?.action ?? {};
    if (!isSustainedSpellAction(stepAction)) continue;
    if (spellKey(stepAction) !== key) continue;
    for (const op of step?.execution?.revert?.ops ?? []) {
      if (op?.kind !== "region" && op?.kind !== "template") continue;
      const id = op.regionId ?? op.templateId ?? op.id;
      if (!id) continue;
      const ref = {
        kind: op.kind,
        ...(op.regionId ? { regionId: op.regionId } : {}),
        ...(op.templateId ? { templateId: op.templateId } : {}),
        ...(op.sceneId ? { sceneId: op.sceneId } : {}),
      };
      refs.push(ref);
    }
  }
  return dedupeTemplateRefs([...refs, ...sceneTemplateRefsForSpell(action)]);
}

function sustainStateForDraft(draft) {
  const planned = new Set();
  const sustained = new Set();
  for (const step of Array.isArray(draft?.steps) ? draft.steps : []) {
    const slug = normalizeSlug(step?.action?.slug ?? step?.actionKey);
    if (slug !== "sustain-a-spell") continue;
    const id = normalizeSlug(step?.sustainedSpell?.id);
    if (!id) continue;
    planned.add(id);
    if (step?.execution?.status === "done") sustained.add(id);
  }
  return { planned, sustained };
}

// Keys of sustained spells that were cast during the draft being read. A spell cast this turn
// cannot be sustained until the caster's NEXT turn, so it must be excluded from end-of-turn
// cleanup — otherwise we'd nag the caster to drop a spell the same turn they cast it.
function castThisTurnSpellKeys(draft) {
  const keys = new Set();
  for (const step of Array.isArray(draft?.steps) ? draft.steps : []) {
    const action = step?.action ?? {};
    if (!isSustainedSpellAction(action)) continue;
    const key = spellKey(action);
    if (key) keys.add(key);
  }
  return keys;
}

export function readSustainedSpellEntries(context, actions = readSpellActions(context), draft = readDraftPlan(context)) {
  const actor = actorDocument(context);
  if (!actor) return [];
  const effects = effectDocuments(actor).map(effectSummary).filter((effect) => effect.id);
  const { planned, sustained } = sustainStateForDraft(draft);
  const entries = [];

  for (const action of actions.filter(isSustainedSpellAction)) {
    const id = spellKey(action);
    if (!id || entries.some((entry) => entry.id === id)) continue;
    const matchingEffects = effects.filter((effect) => effectMatchesSpell(effect, action));
    const templateRefs = templateRefsForSpell(draft, action);
    if (!matchingEffects.length && !templateRefs.length) continue;
    entries.push({
      id,
      name: spellName(action),
      spellSlug: id,
      spellUuid: action?.item?.uuid ?? action?.uuid ?? null,
      effectIds: matchingEffects.map((effect) => effect.id),
      effects: matchingEffects,
      templateRefs,
      planned: planned.has(id),
      sustained: sustained.has(id),
    });
  }

  return entries.toSorted((left, right) => left.name.localeCompare(right.name));
}

export function unsustainedSpellCleanupEntries(context, actions = readSpellActions(context), draft = readDraftPlan(context)) {
  const castThisTurn = castThisTurnSpellKeys(draft);
  return readSustainedSpellEntries(context, actions, draft)
    .filter((entry) => !entry.sustained)
    .filter((entry) => !castThisTurn.has(entry.id));
}

// True only when an embedded document is positively confirmed gone from its collection.
// Returns false when we cannot check, so a real deletion is still attempted.
function confirmedRemoved(collection, id) {
  return Boolean(collection?.get) && id != null && !collection.get(id);
}

async function deleteActorEffects(actor, entry, warnings) {
  if (typeof actor?.deleteEmbeddedDocuments !== "function") return;
  const grouped = new Map();
  for (const effect of entry.effects ?? []) {
    if (!effect.id) continue;
    const type = effect.documentType === "ActiveEffect" ? "ActiveEffect" : "Item";
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(effect.id);
  }

  for (const [type, ids] of grouped) {
    // Skip ids confirmed gone (another cleanup path may have removed them already).
    const collection = type === "ActiveEffect" ? actor.effects : actor.items;
    const existing = collection?.get ? ids.filter((id) => collection.get(id)) : ids;
    if (!existing.length) continue;
    try {
      await actor.deleteEmbeddedDocuments(type, existing);
    } catch (_error) {
      warnings.push(`Could not remove ${entry.name} effect.`);
    }
  }
}

async function deleteTemplates(entry, warnings) {
  for (const ref of entry.templateRefs ?? []) {
    try {
      const scene = globalThis.game?.scenes?.get?.(ref.sceneId) ?? globalThis.canvas?.scene;
      if (typeof scene?.deleteEmbeddedDocuments !== "function") continue;
      // Idempotent: delete unless the target is confirmed already gone.
      if (ref.kind === "region" && ref.regionId && !confirmedRemoved(scene.regions, ref.regionId)) {
        await scene.deleteEmbeddedDocuments("Region", [ref.regionId]);
      } else if (ref.kind === "template" && ref.templateId
        && !confirmedRemoved(scene.templates ?? scene.measuredTemplates, ref.templateId)) {
        await scene.deleteEmbeddedDocuments("MeasuredTemplate", [ref.templateId]);
      }
    } catch (_error) {
      warnings.push(`Could not remove ${entry.name} template.`);
    }
  }
}

export async function removeSustainedSpellEntries(context, entries) {
  const actor = actorDocument(context);
  const warnings = [];
  for (const entry of entries ?? []) {
    await deleteActorEffects(actor, entry, warnings);
    await deleteTemplates(entry, warnings);
  }
  return { removed: entries?.length ?? 0, warnings };
}

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[char]));
}

function canCleanup(context) {
  const actor = actorDocument(context);
  if (!actor) return false;
  if (globalThis.game?.user?.isGM === true || actor.isOwner === true) return true;
  return typeof actor.testUserPermission === "function"
    && actor.testUserPermission(globalThis.game?.user, globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
}

async function confirmCleanup(entries) {
  const names = entries.map((entry) => `<li>${escapeHtml(entry.name)}</li>`).join("");
  const suffix = entries.some((entry) => entry.templateRefs?.length) ? " Effects and templates will be removed." : "";
  const content = `<p>Remove unsustained spells?</p><ul>${names}</ul><p>${escapeHtml(suffix)}</p>`;
  const dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof dialog?.wait === "function") {
    const choice = await dialog.wait({
      window: { title: "Unsustained spells" },
      content,
      buttons: [
        { action: "remove", label: "Remove unsustained" },
        { action: "keep", label: "Keep all" },
      ],
      rejectClose: false,
    }).catch(() => "keep");
    return choice === "remove";
  }
  const confirm = globalThis.window?.confirm;
  return typeof confirm === "function"
    ? confirm(`Remove unsustained spells: ${entries.map((entry) => entry.name).join(", ")}?`)
    : false;
}

export async function promptUnsustainedSpellCleanup(context, actions = readSpellActions(context), draft = readDraftPlan(context)) {
  if (!canCleanup(context)) return { status: "skipped", reason: "permission" };
  const entries = unsustainedSpellCleanupEntries(context, actions, draft);
  if (!entries.length) return { status: "empty" };
  if (!await confirmCleanup(entries)) return { status: "kept", entries };
  const result = await removeSustainedSpellEntries(context, entries);
  for (const warning of result.warnings ?? []) globalThis.ui?.notifications?.warn?.(warning);
  return { status: "removed", entries, ...result };
}
