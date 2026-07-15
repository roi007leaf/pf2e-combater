import { canvasTokenById, tokenId } from "../execution/targets.js";
import { addRevertConflictWarning, canRestoreSnapshot } from "./transaction.js";

function currentPoint(document) {
  const point = {
    x: Number(document?.x),
    y: Number(document?.y),
  };
  if (Object.prototype.hasOwnProperty.call(document ?? {}, "elevation")) {
    point.elevation = Number(document.elevation);
  }
  return point;
}

function latestRecordedMovementId(document) {
  const history = document?._source?._movementHistory;
  return Array.isArray(history) && history.length ? history[0]?.movementId ?? null : null;
}

async function moveTokenTo(document, point) {
  const elevation = Number.isFinite(Number(point?.elevation)) ? { elevation: Number(point.elevation) } : {};
  if (typeof document.update === "function") {
    await document.update({ x: point.x, y: point.y, ...elevation });
    return;
  }
  if (typeof document.move === "function") {
    await document.move(
      { x: point.x, y: point.y, ...elevation, action: "walk", explicit: true, checkpoint: true, snapped: true },
      { method: "api" },
    );
    return;
  }
  throw new Error("token movement API is unavailable");
}

export async function revertMovement(op, { context, warnings }) {
  const token = canvasTokenById(op?.tokenId) ?? canvasTokenById(tokenId(context));
  const document = token?.document ?? token ?? null;
  if (!document) throw new Error("token is unavailable");

  if (!canRestoreSnapshot({
    current: currentPoint(document),
    expectedAfter: op?.expectedAfter,
    warnings,
    label: "movement",
  })) return;

  if (op?.movementId && typeof document.revertRecordedMovement === "function") {
    const latestId = latestRecordedMovementId(document);
    if (latestId && latestId !== op.movementId) {
      addRevertConflictWarning(warnings, "movement");
      return;
    }
    const reverted = await document.revertRecordedMovement(op.movementId);
    if (!reverted) throw new Error("recorded movement could not be reverted");
    return;
  }

  const steps = Array.isArray(op?.path) && op.path.length > 1
    ? op.path.slice(0, -1).reverse()
    : (op?.origin ? [op.origin] : []);
  if (!steps.length) throw new Error("token is unavailable");

  for (const step of steps) {
    await moveTokenTo(document, step);
  }
}
