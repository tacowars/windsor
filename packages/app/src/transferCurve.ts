/**
 * The transfer curve beside the Ceiling knob (windsor#194 decision 7; the
 * mockup's `.curve`): a 96 px square SVG of the output stage's static curve
 * from −24 to +6 dB on both axes, with a grid, the unity diagonal and the
 * ceiling. The path is the engine's `outputStageCurve` (`transferCurveModel.ts`)
 * and is redrawn only when the mode or the ceiling changes, through the
 * link. The dot at the louder input peak is the only part the meter loop
 * moves, and it writes its attribute only when its place changes.
 */
import { TRANSFER_CURVE, TRANSFER_DECIMALS } from './masterColumnTables';
import type { MeterPart } from './meterLoop';
import type { OutputStageLink } from './outputStageLink';
import { OUTPUT_MODE_LABELS } from './outputStageTables';
import { curveX, curveY, transferDot, transferLabel, transferPath } from './transferCurveModel';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  cls: string,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  if (cls) node.setAttribute('class', cls);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

/** The fixed parts: the grid, the unity line and the axis names. */
function frame(root: SVGSVGElement): void {
  const { view } = TRANSFER_CURVE;
  for (const db of TRANSFER_CURVE.gridDb) {
    const x = curveX(db);
    const y = curveY(db);
    root.append(
      svg('line', 'transfer-grid', { x1: x, y1: 0, x2: x, y2: view }),
      svg('line', 'transfer-grid', { x1: 0, y1: y, x2: view, y2: y }),
    );
  }
  root.append(svg('line', 'transfer-unity', { x1: 0, y1: view, x2: view, y2: 0 }));
  const inName = svg('text', 'transfer-axis', { ...TRANSFER_CURVE.inLabel, 'text-anchor': 'end' });
  inName.textContent = 'in';
  const outName = svg('text', 'transfer-axis', TRANSFER_CURVE.outLabel);
  outName.textContent = 'out';
  root.append(inName, outName);
}

export function createTransferCurve(link: OutputStageLink): MeterPart<Element> {
  const { view, sizePx } = TRANSFER_CURVE;
  const root = svg('svg', 'transfer-curve', {
    viewBox: `0 0 ${view} ${view}`,
    width: sizePx,
    height: sizePx,
    role: 'img',
  });
  frame(root);
  const ceiling = svg('line', 'transfer-ceiling', { x1: 0, x2: view });
  const path = svg('path', 'transfer-path');
  const dot = svg('circle', 'transfer-dot is-hidden', {
    r: TRANSFER_CURVE.dotRadius,
    cx: 0,
    cy: view,
  });
  root.append(ceiling, path, dot);
  let dotAt = '';
  let lastPeak = 0;

  const moveDot = (inputPeak: number): void => {
    lastPeak = inputPeak;
    const { mode, ceilingDb } = link.settings();
    const at = transferDot(mode, ceilingDb, inputPeak);
    const next = at
      ? `translate(${at.x.toFixed(TRANSFER_DECIMALS)} ${(at.y - view).toFixed(TRANSFER_DECIMALS)})`
      : '';
    if (next === dotAt) return;
    dotAt = next;
    if (next) dot.setAttribute('transform', next);
    dot.classList.toggle('is-hidden', !next);
  };
  const draw = (): void => {
    const { mode, ceilingDb } = link.settings();
    path.setAttribute('d', transferPath(mode, ceilingDb));
    const y = curveY(ceilingDb).toFixed(TRANSFER_DECIMALS);
    ceiling.setAttribute('y1', y);
    ceiling.setAttribute('y2', y);
    ceiling.classList.toggle('is-hidden', mode === 'off');
    root.setAttribute('aria-label', transferLabel(OUTPUT_MODE_LABELS[mode], mode, ceilingDb));
    moveDot(lastPeak);
  };
  const reset = (): void => moveDot(0);
  link.onChange(draw);
  draw();
  return {
    root,
    paint: () => {
      const report = link.report();
      moveDot(report ? Math.max(report.inputLeft, report.inputRight) : 0);
    },
    reset,
  };
}
