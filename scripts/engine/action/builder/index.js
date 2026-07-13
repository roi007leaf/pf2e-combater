export {
  computeAreaMarker,
  projectContextForDraftDestination,
  projectContextForDraftStepOrigin,
} from "./projection.js";

export { actionBuilderKey } from "./shared.js";

export {
  backingStrikeOverrideFields,
  builderAtomicActionsForStep,
} from "./atomize.js";

export {
  ACTION_BUILDER_TABS,
  buildActionBuilderModel,
  isUnreachableStrikeStep,
} from "./model.js";

// No longer injected into the builder tabs (the sustained-spells section handles sustaining),
// but kept as a self-contained template the section uses to build a Sustain step.
export const SUSTAIN_A_SPELL_ACTION = {
  id: "sustain-a-spell",
  name: "Sustain a Spell",
  slug: "sustain-a-spell",
  actionCost: 1,
  source: "generic",
  role: "utility",
  confidence: "medium",
  detected: true,
  available: true,
  executable: "chat-guidance",
  activityProfile: { includes: ["concentrate", "sustain"] },
  reason: "Spend 1 action to extend a sustained spell's duration.",
};
