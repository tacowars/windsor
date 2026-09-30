/**
 * One gain-reduction line over the engine's actual detector (#660). Uses the
 * console's frame loop; hidden/detached cards stop processor telemetry. Resolve
 * the live insert each time so a chain replacement cannot leave a stale meter.
 */
import type { InsertTarget } from './insertTarget';
import { COMPRESSOR_DSP } from '@windsor/engine';
import type { InsertSpec, InsertStage } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { liveInsert } from './insertTarget';
import { watchPlayhead } from './stepStrip';

export function compressorMeter(ctx: AppCtx, slot: InsertTarget, index: number): HTMLElement {
  const root = el('div', 'compressor-meter');
  // A drawn meter rather than a native <meter>, so its fill is the rack's
  // --carrier in every browser (the mockup's .meter), hanging from the top.
  const line = el('div', 'gr-meter');
  line.setAttribute('role', 'meter');
  line.setAttribute('aria-label', 'Gain reduction');
  line.setAttribute('aria-valuemin', '0');
  line.setAttribute('aria-valuemax', String(COMPRESSOR_DSP.meterCeilingDb));
  line.setAttribute('aria-valuenow', '0');
  const fill = el('div', 'gr-fill');
  fill.style.transform = 'scaleY(0)';
  line.append(fill);
  const label = el('span', 'readout', 'GR 0.0 dB');
  root.append(line, label);
  let active: InsertStage<InsertSpec>['reduction'];
  const stop = (): void => {
    active?.setActive(false);
    active = undefined;
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
      const next = stage?.kind === 'compressor' ? stage.reduction : undefined;
      if (next !== active) {
        stop();
        active = next;
        active?.setActive(true);
      }
      return active?.read() ?? 0;
    },
    mark: (db) => {
      const share = Math.min(1, Math.max(0, db / COMPRESSOR_DSP.meterCeilingDb));
      fill.style.transform = `scaleY(${share})`;
      line.setAttribute('aria-valuenow', db.toFixed(1));
      label.textContent = `GR ${db.toFixed(1)} dB`;
    },
  });
  return root;
}
