import { pf2eActionName, t } from "../i18n.js";

function stripInteractPrefix(name) {
  const value = String(name ?? "").trim();
  return value.replace(/^Interact\s*->\s*/i, "").trim() || value;
}

function itemDisplayName(step) {
  return stripInteractPrefix(step?.name ?? step?.item?.name ?? t("Label.Item", "Item"));
}

export function displayStepEntries(steps) {
  return (Array.isArray(steps) ? steps : []).flatMap((step, sourceIndex) => {
    const reloadCost = Number(step?.reloadCost ?? step?.activityProfile?.reloadCost);
    if (step?.activityProfile?.reloadBeforeStrike === true
      && Number.isFinite(reloadCost)
      && reloadCost > 0
      && Number(step?.actionCost) > reloadCost) {
      const strikeCost = Math.max(1, Number(step.actionCost) - reloadCost);
      const strikeName = String(step?.name ?? "").replace(/^Reload\s*->\s*/i, "").trim() || step?.name;
      return [{
        step: {
          ...step,
          id: `${step?.id ?? sourceIndex}-reload`,
          name: pf2eActionName("reload", "Reload"),
          actionCost: reloadCost,
          reason: t("Reason.ReloadBeforeStrike", "Reload before firing {name}.", { name: strikeName }),
          suggestedTarget: null,
          targetLabel: "",
          mapPenalty: 0,
          range: null,
          targetingProfile: null,
          displayOnly: true,
        },
        sourceIndex,
      }, {
        step: {
          ...step,
          id: `${step?.id ?? sourceIndex}-strike`,
          name: strikeName,
          actionCost: strikeCost,
          reloadCost: 0,
          activityProfile: {
            ...(step?.activityProfile ?? {}),
            reloadBeforeStrike: false,
            reloadCost: 0,
          },
          displayOnlyActivation: true,
        },
        sourceIndex,
      }];
    }

    const drawCost = Number(step?.interactDrawCost);
    const activationCost = Number(step?.activationActionCost ?? (Number(step?.actionCost) - drawCost));
    if (!Number.isFinite(drawCost) || drawCost <= 0 || !Number.isFinite(activationCost) || activationCost <= 0) {
      return [{ step, sourceIndex }];
    }

    const name = itemDisplayName(step);
    return [{
      step: {
        ...step,
        id: `${step?.id ?? sourceIndex}-draw`,
        name: pf2eActionName("interact", "Interact"),
        actionCost: drawCost,
        reason: t("Reason.DrawOrRetrieve", "Draw or retrieve {name}.", { name }),
        suggestedTarget: null,
        targetLabel: "",
        mapPenalty: 0,
        range: null,
        targetingProfile: null,
        displayOnly: true,
      },
      sourceIndex,
    }, {
      step: {
        ...step,
        id: `${step?.id ?? sourceIndex}-activate`,
        name,
        actionCost: activationCost,
        interactDrawCost: 0,
        displayOnlyActivation: true,
      },
      sourceIndex,
    }];
  });
}
