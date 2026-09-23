/**
 * One gain-reduction line over the engine's actual detector (#660). Uses the
 * console's frame loop; hidden/detached cards stop processor telemetry. Resolve
 * the live insert each time so a chain replacement cannot leave a stale meter.
 */
import type { InsertTarget } from './insertTarget';
import { COMPRESSOR_DSP } from '../../../packages/client/src/audio/index-for-editor';
import type { InsertSpec, InsertStage } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { el } from './dom';
import { liveInsert } from './insertTarget';
import { watchPlayhead } from './stepStrip';

export function compressorMeter(ctx: AppCtx, slot: InsertTarget, index: number): HTMLElement {
  const root = el('div', 'compressor-meter');
  const line = document.createElement('meter');
  line.min = 0;
  line.max = COMPRESSOR_DSP.meterCeilingDb;
  line.value = 0;
  line.setAttribute('aria-label', 'Gain reduction');
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
      line.value = db;
      label.textContent = `GR ${db.toFixed(1)} dB`;
    },
  });
  return root;
}
