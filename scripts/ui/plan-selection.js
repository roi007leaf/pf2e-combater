export function selectDisplayPlan(plans, pinnedPlanId) {
  const safePlans = Array.isArray(plans) ? plans : [];
  if (!pinnedPlanId) return safePlans[0] ?? null;
  return safePlans.find((plan) => plan?.id === pinnedPlanId) ?? safePlans[0] ?? null;
}

export function selectableAlternativePlans(plans, displayPlan) {
  const displayPlanId = displayPlan?.id ?? null;
  return (Array.isArray(plans) ? plans : []).filter((plan) => plan?.id !== displayPlanId);
}
