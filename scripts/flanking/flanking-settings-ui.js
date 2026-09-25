import {
  angularSpanFrom,
  lineThroughTarget,
  oppositeArcsFlank,
  pointsOnOppositeSides,
  segmentLiesOnEdge,
} from './flanking-size-rule.js';

const CHOICE_KEY = 'PF2E_COMBATER.Settings.FlankingSizeRule.Choices';
const DIAGRAM_KEY = 'PF2E_COMBATER.Settings.FlankingSizeRule.Diagram';
const CHOICE_NAMES = { raw: 'Raw', anySquare: 'AnySquare', anyCorner: 'AnyCorner', oppositeArcs: 'OppositeArcs', lineThrough: 'LineThrough' };
const boundChoosers = new WeakSet();

const CELL = 100;
const COLS = 4;
const ROWS = 4;

const SCENE = {
  ally: { x: 0, y: 0, w: 200, h: 200 },
  target: { x: 100, y: 200, w: 100, h: 100 },
  flanker: { x: 200, y: 300, w: 100, h: 100 },
};

const RULE_POINTS = {
  raw: 'center',
  anySquare: 'squares',
  anyCorner: 'corners',
  oppositeArcs: 'center',
  lineThrough: 'center',
};

function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function gridLines() {
  const lines = [];
  for (let i = 0; i <= COLS; i++) {
    lines.push(`<line class="combater-dg-grid" x1="${i * CELL}" y1="0" x2="${i * CELL}" y2="${ROWS * CELL}"/>`);
  }
  for (let i = 0; i <= ROWS; i++) {
    lines.push(`<line class="combater-dg-grid" x1="0" y1="${i * CELL}" x2="${COLS * CELL}" y2="${i * CELL}"/>`);
  }
  return lines.join('');
}

function box(rect, cls) {
  return `<rect class="${cls}" x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" rx="8"/>`;
}

function dot(p, cls = 'combater-dg-dot') {
  return `<circle class="${cls}" cx="${p.x}" cy="${p.y}" r="7"/>`;
}

function centerOf(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function squareCenters(rect) {
  const points = [];
  for (let y = rect.y + CELL / 2; y < rect.y + rect.h; y += CELL) {
    for (let x = rect.x + CELL / 2; x < rect.x + rect.w; x += CELL) points.push({ x, y });
  }
  return points;
}

function corners(rect) {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x, y: rect.y + rect.h },
    { x: rect.x + rect.w, y: rect.y + rect.h },
  ];
}

function candidatePoints(rect, mode) {
  if (mode === 'squares') return squareCenters(rect);
  if (mode === 'corners') return corners(rect);
  return [centerOf(rect)];
}

function boundsOf(rect) {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.w,
    bottom: rect.y + rect.h,
  };
}

function pairPasses(rule, from, to) {
  const target = boundsOf(SCENE.target);
  if (rule === 'oppositeArcs') return oppositeArcsFlank(boundsOf(SCENE.flanker), boundsOf(SCENE.ally), target);
  if (rule === 'lineThrough') return lineThroughTarget(boundsOf(SCENE.flanker), boundsOf(SCENE.ally), target);
  if (rule === 'anyCorner' && segmentLiesOnEdge(from, to, target)) return false;
  return pointsOnOppositeSides(from, to, target);
}

function candidateLines(rule) {
  const mode = RULE_POINTS[rule];
  const lines = [];
  for (const from of candidatePoints(SCENE.flanker, mode)) {
    for (const to of candidatePoints(SCENE.ally, mode)) {
      lines.push({ from, to, pass: pairPasses(rule, from, to) });
    }
  }
  return lines;
}

function lineSvg({ from, to, pass }) {
  const cls = pass ? 'combater-dg-line combater-dg-pass' : 'combater-dg-line combater-dg-fail';
  return `<line class="${cls}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`;
}

function linesSvg(lines) {
  const failing = lines.filter((l) => !l.pass).map(lineSvg);
  const passing = lines.filter((l) => l.pass).map(lineSvg);
  const dots = new Set();
  for (const { from, to } of lines) dots.add(dot(from)).add(dot(to));
  return [...failing, ...passing, ...dots].join('');
}

function arcPath(span, radius) {
  const origin = centerOf(SCENE.target);
  const point = (angle) => ({
    x: (origin.x + Math.cos(angle) * radius).toFixed(1),
    y: (origin.y + Math.sin(angle) * radius).toFixed(1),
  });
  const from = point(span.start);
  const to = point(span.end);
  const large = span.end - span.start > Math.PI ? 1 : 0;
  return `<path class="combater-dg-arc" d="M ${from.x} ${from.y} A ${radius} ${radius} 0 ${large} 1 ${to.x} ${to.y}"/>`;
}

function arcsSvg(rule) {
  if (rule !== 'oppositeArcs') return '';
  const origin = centerOf(SCENE.target);
  const flankerSpan = angularSpanFrom(origin, boundsOf(SCENE.flanker));
  const allySpan = angularSpanFrom(origin, boundsOf(SCENE.ally));
  return arcPath(flankerSpan, 70) + arcPath(allySpan, 60);
}

function badge(flanked) {
  const text = localize(`${DIAGRAM_KEY}.${flanked ? 'Flanked' : 'NotFlanked'}`);
  const cls = flanked ? 'combater-dg-badge combater-dg-pass' : 'combater-dg-badge combater-dg-fail';
  return `<text class="${cls}" x="${COLS * CELL - 10}" y="${ROWS * CELL - 14}" text-anchor="end">${text}</text>`;
}

function sceneSvg(rule, lines) {
  return [
    `<svg class="combater-dg" viewBox="0 0 ${COLS * CELL} ${ROWS * CELL}" xmlns="http://www.w3.org/2000/svg" role="img">`,
    gridLines(),
    box(SCENE.ally, 'combater-dg-ally'),
    box(SCENE.flanker, 'combater-dg-ally'),
    box(SCENE.target, 'combater-dg-target'),
    arcsSvg(rule),
    linesSvg(lines),
    badge(lines.some((l) => l.pass)),
    '</svg>',
  ].join('');
}

export function buildFlankingIllustrations() {
  return Object.keys(RULE_POINTS).map((value) => {
    const lines = candidateLines(value);
    return {
      value,
      label: `${CHOICE_KEY}.${CHOICE_NAMES[value]}`,
      flanked: lines.some((l) => l.pass),
      svg: sceneSvg(value, lines),
    };
  });
}

export function mountFlankingSettingsCards(html, document = globalThis.document) {
  const root = html?.[0] ?? html;
  const select = root?.querySelector?.('select[name="pf2e-combater.flankingSizeRule"]');
  const group = select?.closest?.('.form-group');
  if (!group) return false;
  group.classList.add('combater-flanking-setting');

  let chooser = group.querySelector('.combater-flanking-cards');
  const created = !chooser;
  if (created) {
    chooser = document.createElement('div');
    chooser.className = 'combater-flanking-cards';
    chooser.setAttribute?.('role', 'group');
    chooser.setAttribute?.('aria-label', localize('PF2E_COMBATER.Settings.FlankingSizeRule.Name'));
    for (const card of buildFlankingIllustrations()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'combater-flanking-card';
      button.dataset.value = card.value;
      button.innerHTML = card.svg;
      const label = document.createElement('span');
      label.className = 'combater-flanking-card-label';
      label.textContent = localize(card.label);
      button.append(label);
      chooser.append(button);
    }
    group.append(chooser);
  }
  const sync = () => {
    for (const button of chooser.children) {
      const active = button.dataset.value === select.value;
      button.classList.toggle('active', active);
      button.setAttribute?.('aria-pressed', String(active));
    }
  };
  if (!boundChoosers.has(chooser)) {
    for (const button of chooser.children) {
      button.addEventListener('click', () => {
        select.value = button.dataset.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    select.addEventListener('change', sync);
    boundChoosers.add(chooser);
  }
  sync();
  return created;
}
