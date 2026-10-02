/**
 * The Euclid card's Density page (windsor#356, decision 2 of the issue;
 * fitted to the 244 px device by windsor#393, decision 7): two sections,
 * the modulator's controls as they were (`densityControls`) in a column
 * wide enough for its kinds, then Hits per pass, a plot of `k` beside the
 * `k` bounds, min, max and start. For an LFO the plot steps through the `k`
 * of the next `EUCLID_PLOT_BARS` bars from the current one; for a walk,
 * which is random, it shows the bounds band and the current `k`. The card's
 * loop repaints the plot when the bar, `k` or the spec moves it.
 *
 * The page keeps the width the Pattern page gives the device, and the plot
 * takes the room left over: it stretches to its box, its lines drawn at a
 * fixed width and its labels set over it, placed by share.
 */
import type { EuclideanSpec } from '@windsor/engine';
import { PERC_COLOR } from './consoleColors';
import { el, html } from './dom';
import type { EuclidCard } from './euclidCardState';
import { EUCLID_PERCENT, EUCLID_PLOT, EUCLID_PLOT_BARS } from './euclidConstants';
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

/** A y in the plot's box as a share of its height, for a label set over the stretched plot. */
const share = (y: number): string => `${(y / EUCLID_PLOT.height) * EUCLID_PERCENT}%`;

/**
 * The plot: the bounds band and lines, the LFO's path or the walk's `k`
 * (an SVG stretched to the box), and the bound labels and caption over it.
 */
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
    '</svg>' +
    `<span class="euclid-plot-max" style="top:${share(top)}">${spec.pulses.max}</span>` +
    `<span class="euclid-plot-min" style="top:${share(bottom)}">${spec.pulses.min}</span>` +
    `<span class="euclid-plot-caption">${caption}</span>`
  );
}

/** A section: its label and any note in it, then its body. */
function section(
  className: string,
  label: readonly [string, ...HTMLElement[]],
  ...body: HTMLElement[]
): HTMLElement {
  const node = el('div', `seq-section ${className}`);
  const [text, ...notes] = label;
  const head = el('div', 'seq-sec-label', text);
  head.append(...notes);
  const inner = el('div', 'seq-sec-body');
  inner.append(...body);
  node.append(head, inner);
  return node;
}

/** The Density page for the card's part and region. */
export function densityPage(card: EuclidCard): DensityPage {
  const root = el('div', 'euclid-page euclid-density');
  const plot = el('div', 'euclid-plot');
  const bounds = el('div', 'seq-col k3');
  bounds.append(pulseKnob(card, 'min'), pulseKnob(card, 'max'), pulseKnob(card, 'start'));
  const modulator = densityControls(card.ctx, card.slot, card.region);
  // Its column, not the card it was drawn for: the section's label names it.
  modulator.style.marginTop = '';
  modulator.className = 'seq-col wide euclid-mod';
  const now = el('em');
  root.append(
    section('euclid-mod-section', ['Density modulator'], modulator),
    section('euclid-hits', ['Hits per pass', now], plot, bounds),
  );
  return {
    root,
    paint: (spec, k, clock) => {
      now.textContent = `k ${k} now`;
      plot.replaceChildren(html('div', 'euclid-plot-box', plotMarkup(spec, k, clock)));
    },
  };
}
