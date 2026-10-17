// PF2e's generic action art (the cost diamonds, Passive, default icons) looks the same for
// every basic action, so compact views swap it for something recognizable.
export const GENERIC_ACTION_ART = /default-icons|icons\/actions\//;

// Core Foundry icons for basic actions the system gives no art of its own.
const FALLBACK_ART = {
  stride: "icons/skills/movement/feet-winged-boots-brown.webp",
  step: "icons/skills/movement/feet-spurred-boots-brown.webp",
  "recall-knowledge": "icons/skills/wounds/anatomy-organ-brain-pink-red.webp",
  "learn-a-spell": "icons/sundries/books/book-open-purple.webp",
  "treat-wounds": "icons/magic/nature/root-vine-caduceus-healing.webp",
  "drop-prone": "icons/magic/control/silhouette-fall-slip-prone.webp",
  "raise-a-shield": "icons/equipment/shield/heater-steel-worn.webp",
  interact: "icons/skills/melee/hand-grip-staff-yellow-brown.webp",
  delay: "icons/magic/time/hourglass-tilted-gray.webp",
};

function baseSlug(slug) {
  return String(slug ?? "").toLowerCase().replace(/^generic-/, "");
}

// The action's own art when it has some; otherwise PF2e's art for that action, then ours.
export function actionArt(slug, img) {
  if (img && !GENERIC_ACTION_ART.test(String(img))) return img;
  const key = baseSlug(slug);
  if (!key) return "";
  const system = globalThis.game?.pf2e?.actions?.get?.(key)?.img;
  if (system && !GENERIC_ACTION_ART.test(String(system))) return system;
  return FALLBACK_ART[key] ?? "";
}
