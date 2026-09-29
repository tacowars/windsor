/**
 * Independent L/R sample-peak bars; the shared frame loop owns the visible tap
 * (#666). They read before the output stage; Reset peaks also runs `onReset`,
 * which clears the output stage's clip light (windsor#94).
 */
import { PEAK_METER } from '@windsor/engine';
import type { PeakMeter } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { watchPlayhead } from './stepStrip';
import { amplitudeDb } from './masterTables';
export function masterMeter(ctx: AppCtx, onReset?: () => void): HTMLElement {
  const root = el('div', 'master-meter');
  const channels = ['L', 'R'].map((name) => {
    const row = el('label', 'master-meter-channel', name);
    const meter = document.createElement('meter');
    meter.min = PEAK_METER.floorDb;
    meter.max = PEAK_METER.ceilingDb;
    meter.high = 0;
    meter.value = PEAK_METER.floorDb;
    meter.setAttribute('aria-label', `Master ${name} sample peak`);
    const label = el('span', 'readout', '−∞ dBFS');
    row.append(meter, label);
    root.appendChild(row);
    return { meter, label };
  });
  const overload = el('button', 'btn', 'Reset peaks') as HTMLButtonElement;
  root.appendChild(overload);
  let active: PeakMeter | undefined;
  const stop = (): void => {
    active?.setActive(false);
    active = undefined;
  };
  overload.onclick = (): void => {
    active?.reset();
    onReset?.();
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
      const next = ctx.host.system?.masterStrip?.meter;
      if (next !== active) {
        stop();
        active = next;
      }
      active?.setActive(true);
      return active?.revision ?? 0;
    },
    mark: () => {
      const p = active?.read();
      const peaks = [p?.left ?? 0, p?.right ?? 0];
      const holds = [p?.holdLeft ?? 0, p?.holdRight ?? 0];
      channels.forEach(({ meter, label }, i) => {
        meter.value = amplitudeDb(peaks[i]!);
        label.textContent = `${holds[i] ? amplitudeDb(holds[i]!).toFixed(1) : '−∞'} dBFS peak`;
      });
      overload.textContent = p?.overload ? 'Overload — reset peaks' : 'Reset peaks';
      overload.classList.toggle('overload', p?.overload ?? false);
    },
  });
  return root;
}
