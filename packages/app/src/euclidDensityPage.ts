/**
 * The Euclid card's Density page (windsor#356, decision 2 of the issue): the
 * modulator's controls as they were (`densityControls`), a plot of `k`, and
 * the `k` bounds, min, max and start. For an LFO the plot steps through the
 * `k` of the next `EUCLID_PLOT_BARS` bars from the current one; for a walk,
 * which is random, it shows the bounds band and the current `k`. The card's
 * loop repaints the plot when the bar, `k` or the spec moves it.
 */
import type { EuclideanSpec } from '@windsor/engine';
import { PERC_COLOR } from './consoleColors';
import { el, html } from './dom';
import type { EuclidCard } from './euclidCardState';
import { EUCLID_PLOT, EUCLID_PLOT_BARS } from './euclidConstants';
import { type PlotClock, lfoKs, plotPath, plotScale, plotY } from './euclidDensityModel';
import { type PulseField, pulsesChange } from './euclidModel';
import { makeKnob } from './knob';
import { densityControls } from './seqFields';
import { euclidPulseKnob } from './sequencerKnobTables';

/** The page, and the plot's repaint for the spec, the current `k` and the clock. */
export interface DensityPage {
  readonly root: HTMLElement;
  paint(spec: EuclideanSpec, k: number, clock: PlotClock): void;
}

function pulseKnob(card: EuclidCard, field: PulseField): HTMLElement {
  const spec = euclidPulseKnob(field);
  const knob = makeKnob({
    ...spec,
    color: PERC_COLOR,
    get: () => card.spec()?.pulses[field] ?? spec.def,
    set: (v) => {
      const now = card.spec();
      if (!now) return;
      if (card.write({ pulses: pulsesChange(now, field, v) })) {
        card.dependents.forEach((k) => k.refresh());
      }
    },
  });
  card.dependents.push(knob);
  return knob;
}

/** The plot's SVG: the bounds band and lines, the LFO's path or the walk's `k`, the labels. */
function plotMarkup(spec: EuclideanSpec, k: number, clock: PlotClock): string {
  const box = EUCLID_PLOT;
  const scale = plotScale(spec);
  const top = plotY(spec.pulses.max, scale);
  const bottom = plotY(spec.pulses.min, scale);
  const walk = spec.density.kind === 'walk';
  const ks = lfoKs(spec, clock, EUCLID_PLOT_BARS);
  const trace = walk
    ? `<line class="now" x1="0" y1="${plotY(k, scale)}" x2="${box.width}" y2="${plotY(k, scale)}"/>`
    : `<path class="path" d="${plotPath(ks, scale)}"/>`;
  const caption = walk ? `walk · k ${k}` : `next ${EUCLID_PLOT_BARS} bars`;
  return (
    `<svg viewBox="0 0 ${box.width} ${box.height}" preserveAspectRatio="none" role="img"` +
    ` aria-label="k: ${caption}">` +
    `<rect class="band" x="0" y="${top}" width="${box.width}" height="${bottom - top}"/>` +
    `<line class="bound" x1="0" y1="${top}" x2="${box.width}" y2="${top}"/>` +
    `<line class="bound" x1="0" y1="${bottom}" x2="${box.width}" y2="${bottom}"/>` +
    trace +
    `<text x="${box.labelX}" y="${top - 2}">${spec.pulses.max}</text>` +
    `<text x="${box.labelX}" y="${Math.min(box.height - 1, bottom + box.pad)}">${spec.pulses.min}</text>` +
    `<text x="${box.width - box.labelX}" y="${box.labelY}" text-anchor="end">${caption}</text>` +
    '</svg>'
  );
}

/** The Density page for the card's part and region. */
export function densityPage(card: EuclidCard): DensityPage {
  const root = el('div', 'euclid-page euclid-density');
  const plot = el('div', 'euclid-plot');
  const bounds = el('div', 'euclid-bounds');
  bounds.append(pulseKnob(card, 'min'), pulseKnob(card, 'max'));
  const start = el('div', 'euclid-bounds');
  start.append(pulseKnob(card, 'start'));
  root.append(densityControls(card.ctx, card.slot, card.region), plot, bounds, start);
  return {
    root,
    paint: (spec, k, clock) => {
      plot.replaceChildren(html('div', 'euclid-plot-box', plotMarkup(spec, k, clock)));
    },
  };
}
