// Expands a Command an Animal row into its commanded-companion browse options, one row per
// distinct minion action, tracking the minion's own per-command action budget.
import { slugify } from "../text.js";
import { t } from "../../../i18n.js";
import { actionBuilderKey, scoreValue } from "./shared.js";

const COMMAND_ANIMAL_SLUG = "command-an-animal";
const MINION_ACTION_SOURCE = "minion-action";

function minionActionBudget(action, plan = action?.activityProfile?.minionPlan) {
  const value = Number(plan?.actionBudget ?? action?.activityProfile?.minionActionBudget ?? 2);
  return Math.max(1, Math.min(3, Number.isFinite(value) ? Math.round(value) : 2));
}

function isMinionCommandAction(action) {
  return String(action?.slug ?? "").toLowerCase() === COMMAND_ANIMAL_SLUG
    && action?.activityProfile?.minionPlan;
}

function minionPlanFromDraftStep(step) {
  return step?.activityProfile?.minionPlan ?? step?.action?.activityProfile?.minionPlan ?? null;
}

function minionDraftPlanForAction(draft, action) {
  const plan = action?.activityProfile?.minionPlan;
  const minionId = String(plan?.minionId ?? "");
  const minionName = String(plan?.minionName ?? "").toLowerCase();
  const commandKey = String(actionBuilderKey(action));
  for (const step of draft?.steps ?? []) {
    const stepPlan = minionPlanFromDraftStep(step);
    if (!stepPlan) continue;
    const sameMinion = minionId
      ? String(stepPlan.minionId ?? "") === minionId
      : String(stepPlan.minionName ?? "").toLowerCase() === minionName;
    if (!sameMinion) continue;
    const stepKeys = [
      step?.actionKey,
      step?.key,
      step?.action?.key,
      step?.action?.baseKey,
      step?.action?.slug,
      step?.slug,
    ].map((value) => String(value ?? ""));
    if (stepKeys.includes(commandKey) || stepKeys.includes(COMMAND_ANIMAL_SLUG)) return stepPlan;
  }
  return null;
}

function uniqueMinionOptions(plan) {
  const seen = new Set();
  const options = [];
  for (const value of [
    ...(Array.isArray(plan?.actionOptions) ? plan.actionOptions : []),
    ...(Array.isArray(plan?.steps) ? plan.steps : []),
  ]) {
    const name = String(value ?? "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    options.push(name);
  }
  return options;
}

function minionBrowseRole(option) {
  const slug = slugify(option);
  if (["stride", "step", "leap", "stand", "drop-prone"].includes(slug)) return "mobility";
  if (slug === "seek") return "utility";
  return "damage";
}

function minionBrowseRow(commandAction, option, index, draft) {
  const plan = commandAction.activityProfile.minionPlan;
  const existingPlan = minionDraftPlanForAction(draft, commandAction);
  const budget = minionActionBudget(commandAction, existingPlan ?? plan);
  const used = Array.isArray(existingPlan?.steps) ? existingPlan.steps.length : 0;
  const hasOpenCommand = Boolean(existingPlan && used < budget);
  const minion = String(plan.minionName ?? t("MinionPlan.Minion", "Companion")).trim()
    || t("MinionPlan.Minion", "Companion");
  const actionName = String(option ?? "").trim() || t("Panel.UnknownAction", "Unknown action");
  const commandKey = actionBuilderKey(commandAction);
  return {
    ...commandAction,
    id: `${commandKey}::minion::${slugify(actionName)}::${index}`,
    name: t("MinionPlan.BrowseActionName", "{minion}: {action}", { minion, action: actionName }),
    slug: `minion-${slugify(actionName)}`,
    source: MINION_ACTION_SOURCE,
    role: minionBrowseRole(actionName),
    score: scoreValue(commandAction) + Math.max(0, 100 - index) / 100000,
    actionCost: 1,
    cost: 1,
    tabCost: 1,
    budgetCost: hasOpenCommand ? 0 : 1,
    hideFromBuilder: false,
    hideUncounted: true,
    minionCommandKey: commandKey,
    minionCommandAction: commandAction,
    minionActionName: actionName,
    minionActionBudget: budget,
    minionPlanFull: Boolean(existingPlan && used >= budget),
    reason: hasOpenCommand
      ? t("MinionPlan.BrowseAppendReason", "Add {action} to {minion}'s commanded turn.", { action: actionName, minion })
      : t("MinionPlan.BrowseStartReason", "Spend 1 action to command {minion}; add {action} as its first minion action.", { action: actionName, minion }),
    activityProfile: {
      ...(commandAction.activityProfile ?? {}),
      minionBrowseAction: true,
      minionActionName: actionName,
      minionActionBudget: budget,
      minionPlan: { ...plan, actionBudget: budget },
    },
  };
}

export function expandMinionCommandRows(actions, draft) {
  const rows = [];
  for (const action of actions) {
    if (!isMinionCommandAction(action)) {
      rows.push(action);
      continue;
    }
    const budget = minionActionBudget(action);
    const commandAction = {
      ...action,
      name: t("MinionPlan.CommandAction", "Command Companion"),
      hideFromBuilder: true,
      activityProfile: {
        ...(action.activityProfile ?? {}),
        minionActionBudget: budget,
        minionPlan: {
          ...action.activityProfile.minionPlan,
          actionBudget: budget,
        },
      },
    };
    rows.push(commandAction);
    uniqueMinionOptions(commandAction.activityProfile.minionPlan)
      .forEach((option, index) => rows.push(minionBrowseRow(commandAction, option, index, draft)));
  }
  return rows;
}
