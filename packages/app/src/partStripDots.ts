/**
 * The part strip's activity dots (windsor#520 decision 3): each chip's dot
 * lights from its part strip's post-fader meter, the one the Song tab's
 * mixer lights read (`songMixerLights.ts`'s `partMeters`), on the same
 * brightness rule (`songMixerLightsModel.ts`).
 *
 * The dots only read. A meter runs while a view that owns it switches it on,
 * and today that is the Song tab's mixer column, for the rows it shows. A
 * meter switched off reports silence, so on the other tabs the dots stay
 * dark: switching every part's meter on for the strip would run a meter
 * worklet per part on every tab, and a second owner would fight the Song
 * column's release (a meter's `setActive(false)` is a full stop).
 *
 * The loop is the console's one frame request (`watchPlayhead`), and a dot
 * is touched only when its meter's revision moved and its step changed.
 */
import type { PeakMeter } from '@windsor/engine';
import type { AppCtx } from './context';
import { partMeters } from './songMixerLights';
import { lightStep, peakBrightness } from './songMixerLightsModel';
import { MIXER_LIGHTS } from './songMixerLightsTables';
import { watchPlayhead } from './stepStrip';

interface DotRead {
  readonly meter: PeakMeter | undefined;
  readonly revision: number;
  readonly step: number;
}

/** The dots of the chips drawn now, by slot; `set` hands over a fresh set after each draw. */
export interface StripDots {
  set(dots: ReadonlyMap<number, HTMLElement>): void;
}

function paintDot(dot: HTMLElement, step: number): void {
  dot.style.opacity = String(step / MIXER_LIGHTS.steps);
  dot.classList.toggle('on', step > 0);
}

/** Start the dots' poll for as long as `root` is in the document. */
export function watchStripDots(ctx: AppCtx, root: HTMLElement): StripDots {
  let dots: ReadonlyMap<number, HTMLElement> = new Map();
  const reads = new Map<number, DotRead>();
  let changes = 0;
  const poll = (slot: number): boolean => {
    const meter = partMeters(ctx, slot);
    const revision = meter?.revision ?? 0;
    const last = reads.get(slot);
    if (last && last.meter === meter && last.revision === revision) return false;
    const report = meter?.read();
    const step = lightStep(peakBrightness(Math.max(report?.left ?? 0, report?.right ?? 0)));
    reads.set(slot, { meter, revision, step });
    return step !== last?.step;
  };
  watchPlayhead({
    attached: () => root.isConnected,
    playheadAt: () => {
      let changed = false;
      for (const slot of dots.keys()) changed = poll(slot) || changed;
      if (changed) changes++;
      return changes;
    },
    mark: () => {
      for (const [slot, dot] of dots) paintDot(dot, reads.get(slot)?.step ?? 0);
    },
  });
  return {
    set(next) {
      dots = next;
      for (const slot of [...reads.keys()]) if (!next.has(slot)) reads.delete(slot);
      for (const [slot, dot] of next) paintDot(dot, reads.get(slot)?.step ?? 0);
    },
  };
}
