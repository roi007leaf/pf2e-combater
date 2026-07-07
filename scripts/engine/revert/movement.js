import { canvasTokenById, tokenId } from "../execution/targets.js";

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

export async function revertMovement(op, { context }) {
  const token = canvasTokenById(op?.tokenId) ?? canvasTokenById(tokenId(context));
  const document = token?.document ?? token ?? null;
  if (!document) throw new Error("token is unavailable");

  const steps = Array.isArray(op?.path) && op.path.length > 1
    ? op.path.slice(0, -1).reverse()
    : (op?.origin ? [op.origin] : []);
  if (!steps.length) throw new Error("token is unavailable");

  for (const step of steps) {
    await moveTokenTo(document, step);
  }
}
