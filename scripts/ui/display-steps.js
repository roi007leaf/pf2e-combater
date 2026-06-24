function stripInteractPrefix(name) {
  const value = String(name ?? "").trim();
  return value.replace(/^Interact\s*->\s*/i, "").trim() || value;
}

function itemDisplayName(step) {
  return stripInteractPrefix(step?.name ?? step?.item?.name ?? "Item");
}

export function displayStepEntries(steps) {
  return (Array.isArray(steps) ? steps : []).flatMap((step, sourceIndex) => {
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
        name: "Interact",
        actionCost: drawCost,
        reason: `Draw or retrieve ${name}.`,
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
