/**
 * Where a mixer lights poller's lights come from (windsor#159, windsor#528).
 * The Song mixer's part rows read the part meter bank through `partLights.ts`,
 * which the part strip's chips share. The Mixer tab's Groups section
 * (windsor#287) reads each group bus's strip meter through `meterLights`
 * here: the meters of the rows on screen switched on, the rest released.
 *
 * A strip meter's `setActive(false)` is a full stop, not a pause, so the
 * source keeps its meters by key, never by row: a re-render that replaces a
 * row never switches off the meter its replacement just switched on. It
 * reads a meter only when its revision moves, and the red latch lives in
 * `ClipLatches`, which outlives every row and every release.
 */
import type { PeakMeter } from '@windsor/engine';
import type { AppCtx } from './context';
import { ClipLatches, reportStep } from './songMixerLightsModel';

/** One view's lights, by the number its rows are keyed on. */
export interface LightSource {
  /** Bring the lights of `keys`, the rows on screen, up to date; a count that moves when one changed. */
  poll(keys: ReadonlySet<number>): number;
  /** The key's green step, 0 (dark) to the table's `steps`. */
  step(key: number): number;
  /** Whether the key's red light is lit. */
  lit(key: number): boolean;
  /** A click on a red light: put it out and reset the meter's latch. */
  clear(key: number): void;
  /** The view hid or lost its rows: switch off whatever `poll` switched on. */
  release(): void;
  /** Forget every key `keep` refuses: its row is gone. */
  retain(keep: (key: number) => boolean): void;
}

/** Where a key's strip meter comes from. */
export type LightMeters = (ctx: AppCtx, key: number) => PeakMeter | undefined;

/** A key's meter as last read: which object, at which revision, and the step it showed. */
interface KeyRead {
  meter: PeakMeter | undefined;
  revision: number;
  step: number;
}

/** Lights over one strip meter per key, switched on only while their row is on screen. */
export function meterLights(ctx: AppCtx, meters: LightMeters): LightSource {
  const active = new Map<number, PeakMeter>();
  const reads = new Map<number, KeyRead>();
  const latches = new ClipLatches<PeakMeter | undefined>();
  let changes = 0;

  const release = (key: number): void => {
    active.get(key)?.setActive(false);
    active.delete(key);
  };

  /** Switch the key's meter on and read it if it reported; true when a light must change. */
  const poll = (key: number): boolean => {
    const meter = meters(ctx, key);
    if (active.get(key) !== meter) release(key);
    if (meter) {
      meter.setActive(true);
      active.set(key, meter);
    }
    const last = reads.get(key);
    const revision = meter?.revision ?? 0;
    if (last && last.meter === meter && last.revision === revision) return false;
    const report = meter?.read();
    const clippedBefore = latches.lit(key);
    const clipped = latches.observe(key, meter, {
      revision,
      overload: report?.overload ?? false,
    });
    const step = reportStep(report);
    reads.set(key, { meter, revision, step });
    return step !== last?.step || clipped !== clippedBefore;
  };

  return {
    poll(keys) {
      for (const key of active.keys()) if (!keys.has(key)) release(key);
      let changed = false;
      for (const key of keys) changed = poll(key) || changed;
      if (changed) changes++;
      return changes;
    },
    step: (key) => reads.get(key)?.step ?? 0,
    lit: (key) => latches.lit(key),
    clear(key) {
      const meter = active.get(key) ?? meters(ctx, key);
      latches.clear(key, meter?.revision ?? 0);
      meter?.reset();
    },
    release() {
      for (const key of [...active.keys()]) release(key);
    },
    retain(keep) {
      latches.retain(keep);
      for (const key of [...reads.keys()]) if (!keep(key)) reads.delete(key);
    },
  };
}
