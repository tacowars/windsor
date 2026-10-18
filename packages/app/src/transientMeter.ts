/**
 * The Transient card's bipolar gain meter (record `2026-10-18-transient-insert`
 * decision 9), built as `compressorMeter.ts` is: the console's frame loop,
 * and the processor's telemetry only while the card is on screen; a hidden
 * or detached card stops it. The live insert is resolved each frame, so a
 * chain replacement cannot leave a stale meter. A center line at 0 dB, the
 * window's largest boost filling up from it and its largest cut filling
 * down, on a ±24 dB scale; the readouts above and below hold each half
 * second's extremes (`transientMeterModel.ts`).
 */
import type { InsertTarget } from './insertTarget';
import { TRANSIENT_DSP } from '@windsor/engine';
import type { InsertSpec, InsertStage, TransientShapingReading } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { liveInsert } from './insertTarget';
import { watchPlayhead } from './stepStrip';
import { EMPTY_METER_WINDOW, meterKey, meterShare, stepMeterWindow } from './transientMeterModel';
import { fmtSignedDb, TRANSIENT_METER } from './transientTables';

const AT_REST: TransientShapingReading = { boost: 0, cut: 0 };

/** The bar: a center line, the boost's fill above it and the cut's below. */
function meterBar(): { bar: HTMLElement; boost: HTMLElement; cut: HTMLElement } {
  const ceiling = String(TRANSIENT_DSP.meterCeilingDb);
  const bar = el('div', 'tr-meter');
  bar.setAttribute('role', 'meter');
  bar.setAttribute('aria-label', TRANSIENT_METER.label);
  bar.setAttribute('aria-valuemin', `-${ceiling}`);
  bar.setAttribute('aria-valuemax', ceiling);
  bar.setAttribute('aria-valuenow', '0');
  const boost = el('div', 'tr-fill tr-boost');
  const cut = el('div', 'tr-fill tr-cut');
  boost.style.transform = cut.style.transform = 'scaleY(0)';
  bar.append(boost, cut, el('div', 'tr-center'));
  return { bar, boost, cut };
}

export function transientMeter(ctx: AppCtx, slot: InsertTarget, index: number): HTMLElement {
  const root = el('div', 'transient-meter');
  const { bar, boost, cut } = meterBar();
  const boostLabel = el('span', 'tr-readout', fmtSignedDb(0));
  const cutLabel = el('span', 'tr-readout', fmtSignedDb(0));
  root.append(boostLabel, bar, cutLabel);
  let active: InsertStage<InsertSpec>['shaping'];
  let reading = AT_REST;
  let readout = EMPTY_METER_WINDOW;
  const stop = (): void => {
    active?.setActive(false);
    active = undefined;
    reading = AT_REST;
    // A window cut short by a hidden tab or a replaced insert is dropped.
    readout = EMPTY_METER_WINDOW;
  };
  watchPlayhead({
    attached: () => {
      if (root.isConnected) return true;
      stop();
      return false;
    },
    shown: () => {
      if (root.closest('[hidden]') === null) return true;
      stop();
      return false;
    },
    playheadAt: () => {
      const stage = liveInsert(ctx, slot, index);
      const next = stage?.kind === 'transient' ? stage.shaping : undefined;
      if (next !== active) {
        stop();
        active = next;
        active?.setActive(true);
      }
      reading = active?.read() ?? AT_REST;
      const step = stepMeterWindow(readout, reading, performance.now());
      readout = step.window;
      if (step.shown) {
        boostLabel.textContent = fmtSignedDb(step.shown.boost);
        cutLabel.textContent = fmtSignedDb(step.shown.cut);
      }
      return meterKey(reading);
    },
    mark: () => {
      boost.style.transform = `scaleY(${meterShare(reading.boost)})`;
      cut.style.transform = `scaleY(${meterShare(reading.cut)})`;
      const loudest = reading.boost >= -reading.cut ? reading.boost : reading.cut;
      bar.setAttribute('aria-valuenow', loudest.toFixed(1));
    },
  });
  return root;
}
