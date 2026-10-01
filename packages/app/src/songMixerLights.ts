/**
 * The Song tab's mixer lights (windsor#159): a green activity light and a
 * red clip light in each part's strip cell, read from the part strip's
 * post-fader meter (windsor#155, `ctx.host.system.strip(name).meter`).
 *
 * One poller owns them for the whole Song view, not one per cell (the
 * issue's amendment after PR #170). A meter's `setActive(false)` is a full
 * stop, not a pause, and the Song tab draws every cell again on the arrow,
 * an undo or a region drag, so a cell that released its own meter would
 * switch off the one its replacement had just switched on. The cells only
 * hand their light elements to `lightsFor`; the poller activates a slot's
 * meter while that slot's row is attached, on screen and the tab shown, and
 * releases it otherwise, keyed by slot, never by cell.
 *
 * It runs on the shared frame driver (`watchPlayhead`) and, like the
 * Mixer's meter loop (`meterLoop.ts`), reads a meter only when its
 * revision moves, touches a light only when its step or its latch changes,
 * and releases on hide once, so a hidden Song tab never switches off a
 * meter another tab is using. The red latch lives in `ClipLatches`, which
 * outlives every cell, the arrow and a scroll away and back.
 */
import type { PeakMeter } from '@windsor/engine';
import { musicPartName } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { ClipLatches, lightRamp, lightStep, peakBrightness } from './songMixerLightsModel';
import { watchPlayhead } from './stepStrip';

/** What a part cell asks the column's poller for. */
export interface MixerLights {
  /** The part's two lights, registered with the poller by slot; the cell places the element. */
  lightsFor(slot: number, name: string): HTMLElement;
}

/** The red light's title while lit, as the issue words it. */
const CLIPPED_TITLE = 'Clipped: click to clear';
const CLEAR_TITLE = 'Not clipped';

interface LightRow {
  readonly slot: number;
  readonly root: HTMLElement;
  readonly clip: HTMLButtonElement;
  readonly activity: HTMLElement;
  /** The row is inside the scroll's view, as the `IntersectionObserver` last said. */
  onScreen: boolean;
  /** What is drawn, so a frame writes the DOM only when it changes; -1 before the first paint. */
  drawnStep: number;
  drawnClip: boolean | null;
}

/** A slot's meter as last read: which object, at which revision, and the step it showed. */
interface SlotRead {
  meter: PeakMeter | undefined;
  revision: number;
  step: number;
}

const RAMP = lightRamp();

function paintRow(row: LightRow, step: number, clipped: boolean): void {
  if (row.drawnStep !== step) {
    row.drawnStep = step;
    row.activity.style.backgroundColor = RAMP[step]!;
    row.activity.classList.toggle('on', step > 0);
  }
  if (row.drawnClip !== clipped) {
    row.drawnClip = clipped;
    row.clip.classList.toggle('lit', clipped);
    row.clip.setAttribute('aria-pressed', String(clipped));
    row.clip.title = clipped ? CLIPPED_TITLE : CLEAR_TITLE;
  }
}

/** Where a light's meter comes from, by the number its rows are keyed on. */
export type LightMeters = (ctx: AppCtx, key: number) => PeakMeter | undefined;

/** A part strip's post-fader meter, by slot: the Song tab's lights. */
export const partMeters: LightMeters = (ctx, slot) =>
  ctx.host.system?.strip(musicPartName(slot))?.meter;

/**
 * The poller over `meters`. The Song tab keys its rows on part slots; the
 * Mixer tab's Groups section (windsor#287) keys one of its own on group ids,
 * over `groupBus(id).meter`, with the same rules and the same latch.
 */
// eslint-disable-next-line max-lines-per-function -- one owner's closure: its rows, its active meters, the frame poll and the release rules share the same state
export function songMixerLights(ctx: AppCtx, meters: LightMeters = partMeters): MixerLights {
  const rows = new Set<LightRow>();
  const byElement = new WeakMap<Element, LightRow>();
  const active = new Map<number, PeakMeter>();
  const reads = new Map<number, SlotRead>();
  const latches = new ClipLatches<PeakMeter | undefined>();
  const wanted = new Set<number>();
  let running = false;
  let changes = 0;
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const row = byElement.get(entry.target);
            if (row) row.onScreen = entry.isIntersecting;
          }
        });

  const meterOf = (slot: number): PeakMeter | undefined => meters(ctx, slot);

  const release = (slot: number): void => {
    active.get(slot)?.setActive(false);
    active.delete(slot);
  };
  const releaseAll = (): void => {
    for (const slot of [...active.keys()]) release(slot);
  };

  /** Drop the rows a re-render took away; forget a slot none of the rows shows. */
  const prune = (): void => {
    let removed = false;
    for (const row of rows) {
      if (row.root.isConnected) continue;
      observer?.unobserve(row.root);
      rows.delete(row);
      removed = true;
    }
    if (!removed) return;
    const slots = new Set([...rows].map((row) => row.slot));
    latches.retain((slot) => slots.has(slot));
    for (const slot of [...reads.keys()]) if (!slots.has(slot)) reads.delete(slot);
  };

  /** Switch the slot's meter on and read it if it reported; true when a light must change. */
  const poll = (slot: number): boolean => {
    const meter = meterOf(slot);
    if (active.get(slot) !== meter) release(slot);
    if (meter) {
      meter.setActive(true);
      active.set(slot, meter);
    }
    const last = reads.get(slot);
    const revision = meter?.revision ?? 0;
    if (last && last.meter === meter && last.revision === revision) return false;
    const report = meter?.read();
    const clippedBefore = latches.lit(slot);
    const clipped = latches.observe(slot, meter, {
      revision,
      overload: report?.overload ?? false,
    });
    const step = lightStep(peakBrightness(Math.max(report?.left ?? 0, report?.right ?? 0)));
    reads.set(slot, { meter, revision, step });
    return step !== last?.step || clipped !== clippedBefore;
  };

  const start = (): void => {
    if (running) return;
    running = true;
    const first = (): LightRow | undefined => rows.values().next().value;
    watchPlayhead({
      attached: () => {
        prune();
        if (rows.size > 0) return true;
        releaseAll();
        running = false;
        return false;
      },
      // Released the first hidden frame only: the map is empty after it.
      shown: () => {
        if (first()?.root.closest('[hidden]') === null) return true;
        releaseAll();
        return false;
      },
      playheadAt: () => {
        wanted.clear();
        for (const row of rows) if (row.onScreen) wanted.add(row.slot);
        for (const slot of active.keys()) if (!wanted.has(slot)) release(slot);
        let changed = false;
        for (const slot of wanted) changed = poll(slot) || changed;
        if (changed) changes++;
        return changes;
      },
      mark: () => {
        for (const row of rows) {
          paintRow(row, reads.get(row.slot)?.step ?? 0, latches.lit(row.slot));
        }
      },
    });
  };

  const clear = (slot: number): void => {
    const meter = active.get(slot) ?? meterOf(slot);
    latches.clear(slot, meter?.revision ?? 0);
    meter?.reset();
    for (const row of rows) if (row.slot === slot) paintRow(row, row.drawnStep, false);
  };

  return {
    lightsFor(slot, name) {
      const root = el('div', 'mix-lights');
      const clip = el('button', 'mix-clip') as HTMLButtonElement;
      clip.type = 'button';
      clip.setAttribute('aria-label', `${name} clip`);
      clip.onclick = () => clear(slot);
      const activity = el('span', 'mix-activity');
      activity.setAttribute('aria-hidden', 'true');
      root.append(clip, activity);
      const row: LightRow = {
        slot,
        root,
        clip,
        activity,
        onScreen: observer === null,
        drawnStep: -1,
        drawnClip: null,
      };
      paintRow(row, reads.get(slot)?.step ?? 0, latches.lit(slot));
      rows.add(row);
      byElement.set(root, row);
      observer?.observe(root);
      start();
      return root;
    },
  };
}
