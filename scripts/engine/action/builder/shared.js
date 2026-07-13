// Small utilities genuinely shared across the atomization, minion-row, and tab-assembly concerns
// split out of builder.js -- everything else in those three areas turned out to be single-concern
// once traced, so this file stays intentionally tiny.

export function actionBuilderKey(action) {
  return action?.id
    ?? action?.uuid
    ?? action?.item?.uuid
    ?? action?.slug
    ?? action?.name
    ?? "unknown-action";
}

export function scoreValue(action) {
  const score = Number(action?.score);
  return Number.isFinite(score) ? score : 0;
}

export function actionName(action) {
  return String(action?.name ?? action?.label ?? actionBuilderKey(action));
}
