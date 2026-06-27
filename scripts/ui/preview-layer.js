let previewContainer = null;

function fallbackPreviewLayer() {
  return globalThis.canvas?.interface ?? globalThis.canvas?.controls ?? globalThis.canvas?.stage ?? null;
}

function stageLayer() {
  const canvas = globalThis.canvas;
  return canvas?.stage
    ?? canvas?.app?.stage
    ?? canvas?.app?.renderer?.stage
    ?? null;
}

export function previewLayer() {
  const stage = stageLayer();
  const Container = globalThis.PIXI?.Container;
  if (!stage?.addChild || !Container) return fallbackPreviewLayer();

  if (previewContainer?.parent !== stage) {
    previewContainer?.parent?.removeChild?.(previewContainer);
    previewContainer = new Container();
    previewContainer.name = "pf2e-combater-preview-layer";
    previewContainer.eventMode = "none";
    previewContainer.interactive = false;
    previewContainer.interactiveChildren = false;
    previewContainer.zIndex = 1_000_000;
    // Render on top via insertion order (added last) instead of flipping the main stage's
    // sortableChildren. Forcing the stage to sort made PIXI re-sort every scene child whenever any
    // child or zIndex changed — a continuous cost that dropped canvas FPS while the panel was open.
    // The overlay's own children still sort, but on this tiny module-owned container (see callers).
    stage.addChild(previewContainer);
  }

  return previewContainer;
}
