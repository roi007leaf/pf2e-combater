import { drawableSwapItems, heldSwapItems } from "../engine/equipment-items.js";
import { t } from "../i18n.js";

function swapItemChoice(item) {
  const id = item?.id ?? item?._id ?? item?.uuid;
  return id ? { id: String(id), name: String(item?.name ?? id) } : null;
}

export function readSwapItemActions(actor) {
  const heldItems = heldSwapItems(actor);
  const drawableItems = drawableSwapItems(actor);
  if (!heldItems.length || !drawableItems.length) return [];

  return [{
    id: "swap-items",
    name: t("Action.SwapItems", "Swap Items"),
    slug: "swap-items",
    actionCost: 1,
    actionType: "action",
    source: "system-inferred",
    confidence: "low",
    executable: "swap-items",
    detected: true,
    available: true,
    role: "utility",
    combatUse: "browse-only",
    activityProfile: {
      includes: ["interact"],
      swapsItems: true,
      heldItemIds: heldItems.map((item) => item.id ?? item._id ?? item.uuid).filter(Boolean),
      drawableItemIds: drawableItems.map((item) => item.id ?? item._id ?? item.uuid).filter(Boolean),
      heldItems: heldItems.map(swapItemChoice).filter(Boolean),
      drawableItems: drawableItems.map(swapItemChoice).filter(Boolean),
    },
    targetingProfile: { self: true },
    reasons: [t("Reason.SwapItems", "Put away one held item and draw one worn item with the same Interact action.")],
    traits: [],
    attackTrait: false,
  }];
}
