/** Base transfer and magnitude response use engine functions; modulation is labelled separately. */
import {
  driveShape,
  DriveFilter,
  DRIVE_SHAPERS,
  DRIVE_DSP,
} from '../../../packages/client/src/audio/index-for-editor';
import type { DriveStageSpec } from '../../../packages/client/src/audio/index-for-editor';
import { DRIVE_PLOT as P } from './advancedDriveTables';
import { STRIP_COLOR } from './consoleColors';
import { el } from './dom';
function plot(label: string, sample: (x: number) => number): HTMLElement {
  const root = el('div', 'drive-plot');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${P.width} ${P.height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  let d = '';
  for (let i = 0; i <= P.points; i++) {
    const x = i / P.points,
      y = Math.max(0, Math.min(1, sample(x)));
    d += `${i ? 'L' : 'M'}${x * P.width},${(1 - y) * P.height} `;
  }
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', STRIP_COLOR);
  path.setAttribute('stroke-width', '2');
  svg.appendChild(path);
  root.append(el('div', 'hint', label), svg);
  return root;
}
export function drivePlots(stage: DriveStageSpec): HTMLElement {
  const root = el('div', 'knob-row');
  const filter = new DriveFilter();
  filter.configure({
    type: stage.filter,
    hz: stage.frequency,
    q: stage.resonance,
    gain: stage.peak,
    rate: P.rate * DRIVE_DSP.oversample,
  });
  root.append(
    plot('Base shaper · before modulation and DC removal', (x) => {
      const input = 2 * x - 1;
      const output =
        stage.enabled && stage.shaping
          ? driveShape(input, DRIVE_SHAPERS.indexOf(stage.shaper), stage.amount, stage.bias)
          : input;
      return (output + 1) / 2;
    }),
    plot('Base filter · 48 kHz reference · −36 to +24 dB', (x) => {
      const hz = P.minHz * (P.maxHz / P.minHz) ** x;
      const magnitude =
        stage.enabled && stage.filtering ? filter.magnitude(hz, P.rate * DRIVE_DSP.oversample) : 1;
      const db = P.dbScale * Math.log10(Math.max(Number.EPSILON, magnitude));
      return (db - P.minDb) / (P.maxDb - P.minDb);
    }),
  );
  return root;
}
