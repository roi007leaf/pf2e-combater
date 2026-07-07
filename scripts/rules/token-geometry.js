function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function movementFootprintForToken(value) {
  const token = value?.token ?? value ?? {};
  const document = token.document ?? token;
  return {
    widthCells: Math.max(1, numeric(document.width ?? token.width, 1) || 1),
    heightCells: Math.max(1, numeric(document.height ?? token.height, 1) || 1),
  };
}

export function movementPlacementForCenter(center, value, gridSize) {
  const footprint = value?.widthCells && value?.heightCells ? value : movementFootprintForToken(value);
  return {
    center,
    x: center.x - (footprint.widthCells * gridSize) / 2,
    y: center.y - (footprint.heightCells * gridSize) / 2,
    width: footprint.widthCells * gridSize,
    height: footprint.heightCells * gridSize,
  };
}

function footprintCellCount(value) {
  return Math.max(1, Math.ceil(Number(value ?? 1) || 1));
}

export function movementFootprintCentersForToken(center, value, gridSize, { maxCells = 64 } = {}) {
  if (!center) return [];
  const footprint = movementFootprintForToken(value);
  const columns = footprintCellCount(footprint.widthCells);
  const rows = footprintCellCount(footprint.heightCells);
  if ((columns === 1 && rows === 1) || columns * rows > maxCells) return [center];

  const placement = movementPlacementForCenter(center, { widthCells: columns, heightCells: rows }, gridSize);
  const centers = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      centers.push({
        x: placement.x + (column + 0.5) * gridSize,
        y: placement.y + (row + 0.5) * gridSize,
      });
    }
  }
  return centers;
}

// Foundry's own grid measurement (canvas.grid.measurePath) is the authoritative PF2e distance --
// it applies the real 5-10-5 alternating diagonal rule, confirmed live against the actual engine
// (two fresh diagonal squares price at 5+10=15 ft, not a flat 10 ft). A simpler edge-gap
// approximation (Chebyshev distance + one grid unit) looked equivalent for a direct-adjacency or
// orthogonal check, but silently under-counts a diagonal gap -- do not "simplify" this back to an
// edge-arithmetic formula without re-verifying against a live canvas.grid.measurePath call.
export function measurePathFeet(from, to) {
  try {
    const path = globalThis.canvas?.grid?.measurePath?.([from, to]);
    const distance = path?.distance ?? path;
    if (Number.isFinite(distance)) return distance;
  } catch (_error) {
    // Fall back to a grid-cell measurement when Foundry's measurePath is unavailable.
  }
  const size = Number(globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size) || 1;
  const gridDistance = Number(globalThis.canvas?.scene?.grid?.distance ?? globalThis.canvas?.grid?.distance) || size;
  const cells = Math.round(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / size);
  return cells * gridDistance;
}

// Shortest real path distance between two footprints (each may span multiple grid cells for a
// Large+ creature) -- samples every cell-center pair and keeps the minimum, so a big creature's
// nearest edge (not its own center) anchors the measurement.
export function footprintPathDistanceFeet(originCenter, originValue, targetCenter, targetValue, gridSize) {
  if (!originCenter || !targetCenter) return null;
  const size = Number(gridSize ?? globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size) || 1;
  const fromCenters = movementFootprintCentersForToken(originCenter, originValue, size);
  const toCenters = movementFootprintCentersForToken(targetCenter, targetValue, size);
  let shortest = Infinity;
  for (const from of fromCenters) {
    for (const to of toCenters) {
      shortest = Math.min(shortest, measurePathFeet(from, to));
    }
  }
  return Number.isFinite(shortest) ? shortest : null;
}
