function confirmedRemoved(collection, id) {
  return Boolean(collection?.get) && id != null && !collection.get(id);
}

async function deleteEffect(effectUuid) {
  if (!effectUuid || typeof globalThis.fromUuid !== "function") return;
  try {
    const effect = await globalThis.fromUuid(effectUuid);
    if (typeof effect?.delete !== "function") return;
    if (confirmedRemoved(effect.parent?.items, effect.id)) return;
    await effect.delete();
  } catch (_error) {
    // Best-effort: the timer effect may already be gone.
  }
}

export async function revertEffect(op) {
  await deleteEffect(op?.effectUuid);
}

export async function revertRegion(op) {
  await deleteEffect(op?.effectUuid);

  const scene = (op?.sceneId && globalThis.game?.scenes?.get?.(op.sceneId))
    ?? globalThis.canvas?.scene
    ?? null;
  if (!op?.regionId || !scene) return;
  if (confirmedRemoved(scene.regions, op.regionId)) return;
  if (typeof scene.deleteEmbeddedDocuments === "function") {
    await scene.deleteEmbeddedDocuments("Region", [op.regionId]);
    return;
  }
  const region = scene.regions?.get?.(op.regionId);
  if (typeof region?.delete === "function") {
    await region.delete();
    return;
  }
  throw new Error("region deletion API is unavailable");
}

export async function revertChat(op) {
  const id = op?.messageId;
  if (!id) return;
  const message = globalThis.game?.messages?.get?.(id) ?? null;
  if (typeof message?.delete === "function") {
    await message.delete();
    return;
  }
  if (typeof globalThis.ChatMessage?.deleteDocuments === "function") {
    await globalThis.ChatMessage.deleteDocuments([id]);
    return;
  }
  throw new Error("chat message could not be deleted");
}
