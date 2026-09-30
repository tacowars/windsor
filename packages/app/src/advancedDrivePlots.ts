/**
 * Base transfer and magnitude response use engine functions; modulation is
 * labelled separately. In the rack (windsor#174 decision 4) the two plots
 * stand stacked in one column and take their size from it: the SVG stretches
 * to the box, and its line keeps its width.
 */
import { driveShape, DriveFilter, DRIVE_SHAPERS, DRIVE_DSP } from '@windsor/engine';
import type { DriveStageSpec } from '@windsor/engine';
import { DRIVE_PLOT as P } from './advancedDriveTables';
import { el } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

function line(svg: SVGSVGElement, [x1, y1, x2, y2]: readonly number[]): void {
  const rule = document.createElementNS(SVG_NS, 'line');
  rule.setAttribute('class', 'drive-plot-grid');
  rule.setAttribute('x1', String(x1));
  rule.setAttribute('y1', String(y1));
  rule.setAttribute('x2', String(x2));
  rule.setAttribute('y2', String(y2));
  svg.appendChild(rule);
}

interface PlotSpec {
  readonly label: string;
  /** Where the grid's two rules cross, as shares of the width and of the height from the bottom. */
  readonly origin: readonly [x: number, y: number];
  readonly sample: (x: number) => number;
}

function plot(name: string, { label, origin, sample }: PlotSpec): HTMLElement {
  const root = el('div', 'drive-plot');
  root.title = label;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${P.width} ${P.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const [ox, oy] = [origin[0] * P.width, (1 - origin[1]) * P.height];
  line(svg, [0, oy, P.width, oy]);
  line(svg, [ox, 0, ox, P.height]);
  const path = document.createElementNS(SVG_NS, 'path');
  let d = '';
  for (let i = 0; i <= P.points; i++) {
    const x = i / P.points,
      y = Math.max(0, Math.min(1, sample(x)));
    d += `${i ? 'L' : 'M'}${x * P.width},${(1 - y) * P.height} `;
  }
  path.setAttribute('d', d);
  path.setAttribute('class', 'drive-plot-line');
  svg.appendChild(path);
  root.append(el('span', 'drive-plot-name', name), svg);
  return root;
}

/** The stage's shaper and filter plots, in that order. */
export function drivePlots(stage: DriveStageSpec): HTMLElement[] {
  const filter = new DriveFilter();
  filter.configure({
    type: stage.filter,
    hz: stage.frequency,
    q: stage.resonance,
    gain: stage.peak,
    rate: P.rate * DRIVE_DSP.oversample,
  });
  return [
    plot('Shaper', {
      label: 'Base shaper · before modulation and DC removal',
      origin: [P.shaperOrigin, P.shaperOrigin],
      sample: (x) => {
        const input = 2 * x - 1;
        const output =
          stage.enabled && stage.shaping
            ? driveShape(input, DRIVE_SHAPERS.indexOf(stage.shaper), stage.amount, stage.bias)
            : input;
        return (output + 1) / 2;
      },
    }),
    plot('Filter', {
      label: 'Base filter · 48 kHz reference · −36 to +24 dB',
      origin: [
        Math.log(P.gridHz / P.minHz) / Math.log(P.maxHz / P.minHz),
        -P.minDb / (P.maxDb - P.minDb),
      ],
      sample: (x) => {
        const hz = P.minHz * (P.maxHz / P.minHz) ** x;
        const magnitude =
          stage.enabled && stage.filtering
            ? filter.magnitude(hz, P.rate * DRIVE_DSP.oversample)
            : 1;
        const db = P.dbScale * Math.log10(Math.max(Number.EPSILON, magnitude));
        return (db - P.minDb) / (P.maxDb - P.minDb);
      },
    }),
  ];
}
