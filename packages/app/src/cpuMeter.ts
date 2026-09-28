/**
 * The CPU meter (windsor#13): once audio is on, the power button shows the
 * engine's DSP load (`AudioSystem.readout().load`) as a bar and `NN%`, the
 * interval's peak as a tick, and flashes red with a warning toast when the
 * underrun count rises. The rules are `cpuMeterModel.ts`; this file draws.
 *
 * It rides the console's one frame loop (`watchPlayhead`): the "playhead" is
 * the meter's sample number, which moves about 4 Hz, so the meter repaints
 * four times a second and does nothing on the frames between. While audio is
 * off the loop idles.
 */
import type { AppCtx } from './context';
import { cpuMeterView, INITIAL_OVERRUN_STATE, meterSampleAt, stepOverrun } from './cpuMeterModel';
import { el } from './dom';
import { watchPlayhead } from './stepStrip';

function overrunMessage(added: number): string {
  const deadlines = added === 1 ? 'a deadline' : `${added} deadlines`;
  return `audio overrun: the DSP missed ${deadlines} — this song is at the CPU's limit`;
}

/** Turn `button` into the meter and start it; the click stays the caller's. */
export function mountCpuMeter(button: HTMLElement, ctx: AppCtx): void {
  const fill = el('span', 'cpu-meter-fill');
  const peak = el('span', 'cpu-meter-peak');
  const bar = el('span', 'cpu-meter-bar');
  bar.append(fill, peak);
  const label = el('span', 'cpu-meter-label', '0%');
  button.replaceChildren(bar, label);
  button.classList.add('cpu-meter');
  let overrun = INITIAL_OVERRUN_STATE;

  const paint = (): void => {
    const system = ctx.host.system;
    if (!system) return;
    const { load } = system.readout();
    const now = performance.now();
    const view = cpuMeterView(load);
    const step = stepOverrun(overrun, load.underruns, now);
    overrun = step.state;
    button.style.setProperty('--cpu-fill', String(view.fill));
    button.style.setProperty('--cpu-peak', String(view.peak));
    label.textContent = view.label;
    button.classList.toggle('over', view.over);
    button.classList.toggle('overrun', step.flashing);
    const summary = `CPU ${view.label}, peak ${Math.round(load.peakPct)}%, underruns ${load.underruns}`;
    button.title = summary;
    button.setAttribute('aria-label', `Audio on — ${summary}`);
    if (step.toast) ctx.notify(overrunMessage(step.added), 'warning');
  };

  watchPlayhead({
    attached: () => button.isConnected,
    shown: () => ctx.host.enabled,
    playheadAt: () => meterSampleAt(performance.now()),
    mark: paint,
  });
}
