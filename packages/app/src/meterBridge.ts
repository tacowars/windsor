/**
 * The meter bridge (windsor#194 decision 8; record
 * `2026-09-30-master-column-and-meters`, decision 9; the mockup's `.bridge`):
 * a thin bar stuck to the top of the Mixer tab while the master column's
 * meters are out of view, which happens only where the column stacks above
 * the racks. It holds "Master", Out L and R as thin bars with the ceiling
 * mark, GR or Over as a number, the mode and ceiling as text, and the stage
 * lamp.
 *
 * An `IntersectionObserver` on the column's meters shows and hides it; it
 * reports only on a crossing, so nothing runs per frame. The bar sits in a
 * dock of no height, so showing it moves nothing under it. Its moving parts
 * paint from the tab's meter loop.
 */
import { el } from './dom';
import { type BridgeBar, createBridgeBar } from './meterBar';
import type { MeterLoop } from './meterLoop';
import { type GaugeMeter, regauge, restingGauge, stepGauge } from './gaugeMeter';
import { amplitudeToDb, reductionReadout } from './meterModel';
import { REDUCTION_NAMES } from './meterTables';
import { gaugeFor, meterView } from './outputStageModel';
import type { OutputStageLink } from './outputStageLink';
import { OUTPUT_MODE_LABELS, formatCeilingDb } from './outputStageTables';
import { createStageLamp } from './stageLamp';
import { chromeHeightPx } from './stickyOffset';

/** A chip's text: a plain part and a bold part, in `order`, written only when either changes. */
function chip(order: 'bold-first' | 'plain-first'): {
  root: HTMLElement;
  set(plain: string, bold: string): void;
} {
  const root = el('span', 'meter-bridge-chip');
  const b = el('b');
  const plain = document.createTextNode('');
  if (order === 'bold-first') root.append(b, plain);
  else root.append(plain, b);
  let shown = '';
  return {
    root,
    set(plainText, boldText) {
      const key = `${plainText}|${boldText}`;
      if (key === shown) return;
      shown = key;
      plain.textContent = plainText;
      b.textContent = boldText;
    },
  };
}

/** The GR or Over reading, held for a second like the column's readout. */
function gaugeChip(link: OutputStageLink): {
  root: HTMLElement;
  paint(nowMs: number): void;
  reset(): void;
} {
  const view = chip('plain-first');
  let state: GaugeMeter = restingGauge(gaugeFor(link.settings().mode));
  const draw = (): void => {
    // A new gauge starts from rest, never renaming the old one's hold (`gaugeMeter.ts`).
    state = regauge(state, gaugeFor(link.settings().mode));
    view.root.hidden = state.gauge === 'none';
    view.set(`${REDUCTION_NAMES[state.gauge]} `, reductionReadout(state.meter.heldDb, false));
  };
  link.onChange(draw);
  draw();
  return {
    root: view.root,
    paint(nowMs) {
      const reading = meterView(link.report(), link.settings().mode).gaugeDb;
      state = stepGauge(regauge(state, gaugeFor(link.settings().mode)), reading, nowMs);
      draw();
    },
    reset() {
      state = restingGauge(state.gauge);
      draw();
    },
  };
}

export interface MeterBridge {
  /** The dock to place at the top of the tab. */
  readonly root: HTMLElement;
  /** Stop watching the column's meters (the tab re-rendered). */
  disconnect(): void;
}

export function renderMeterBridge(
  link: OutputStageLink,
  loop: MeterLoop<Element>,
  watched: Element,
): MeterBridge {
  const dock = el('div', 'meter-bridge-dock');
  const bridge = el('div', 'meter-bridge');
  bridge.hidden = true;
  bridge.setAttribute('role', 'group');
  bridge.setAttribute('aria-label', 'Master meter bridge');
  const bars: BridgeBar[] = ['left', 'right'].map((side) =>
    createBridgeBar({ label: `Output stage output, ${side}` }),
  );
  const barBox = el('div', 'meter-bridge-bars');
  barBox.append(...bars.map((bar) => bar.root));
  const gauge = gaugeChip(link);
  const settings = chip('bold-first');
  const lamp = createStageLamp(link);
  bridge.append(
    el('span', 'meter-bridge-tag', 'Master'),
    barBox,
    gauge.root,
    settings.root,
    lamp.root,
  );
  dock.appendChild(bridge);

  const syncSettings = (): void => {
    const { mode, ceilingDb } = link.settings();
    for (const bar of bars) bar.setCeiling(ceilingDb);
    bridge.classList.toggle('is-off', mode === 'off');
    settings.set(mode === 'off' ? '' : ` ${formatCeilingDb(ceilingDb)}`, OUTPUT_MODE_LABELS[mode]);
  };
  link.onChange(syncSettings);
  syncSettings();

  loop.add({
    root: bridge,
    paint(nowMs) {
      const report = link.report();
      bars[0]!.update(amplitudeToDb(report?.outputLeft ?? 0), nowMs);
      bars[1]!.update(amplitudeToDb(report?.outputRight ?? 0), nowMs);
      gauge.paint(nowMs);
    },
    reset() {
      for (const bar of bars) bar.reset();
      gauge.reset();
    },
  });
  loop.add(lamp);
  const observer = new IntersectionObserver(
    (entries) => {
      if (!watched.isConnected) return observer.disconnect();
      for (const entry of entries) {
        // A hidden tab lays nothing out: keep the last answer until it shows.
        if (entry.boundingClientRect.height > 0) bridge.hidden = entry.isIntersecting;
      }
    },
    { rootMargin: `-${Math.round(chromeHeightPx())}px 0px 0px 0px` },
  );
  observer.observe(watched);
  return { root: dock, disconnect: () => observer.disconnect() };
}
