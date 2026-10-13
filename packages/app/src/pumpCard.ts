/**
 * The Pump's card (record `2026-10-13-pump-insert` decision 6), on one page:
 * the shape editor with the key's level behind it, then the key source, the
 * length (a division while synced, the Length knob while not), Depth at the
 * rack's big dial and the detector's Sens, Hold and Smooth. The on/off
 * switch is the rack's rail. Every control commits the whole insert through
 * `ctx.change`.
 *
 * The scope runs only while the editor is on screen: the console's frame
 * loop asks the live stage for it, and a hidden or detached card turns it
 * off, as the compressor's meter does (`compressorMeter.ts`).
 */
import { DEFAULT_PUMP, PUMP_DIVISIONS } from '@windsor/engine';
import type { InsertSpec, InsertStage, PumpDivision, PumpSpec } from '@windsor/engine';
import { STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el, seg } from './dom';
import type { InsertCard } from './insertCards';
import { bigInsertKnobs, insertKnob, insertKnobs, insertsOf, pickKnobs } from './insertKnobs';
import { insertPage, insertSelect, wideColumn } from './insertLayout';
import { liveInsert, targetChange } from './insertTarget';
import type { InsertTarget } from './insertTarget';
import { drawPump, pumpCanvasContext, pumpPalette } from './pumpCurve';
import type { PumpPalette } from './pumpCurve';
import { wirePumpCurve } from './pumpCurveInput';
import { PUMP_KNOBS, PUMP_LABELS, PUMP_PLOT, PUMP_TRACE } from './pumpTables';
import { sidechainCell } from './sidechainSelector';
import { watchPlayhead } from './stepStrip';

const SYNC_OPTIONS = [
  { value: 'on', label: 'Sync' },
  { value: 'off', label: 'Free' },
];

/** The card's reads and writes of its insert. */
interface PumpModel {
  current(): PumpSpec;
  commit(next: PumpSpec): void;
}

function pumpModel(ctx: AppCtx, slot: InsertTarget, index: number): PumpModel {
  const current = (): PumpSpec => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === 'pump' ? spec : DEFAULT_PUMP;
  };
  const commit = (next: PumpSpec): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== 'pump') return;
    inserts[index] = next;
    ctx.change(targetChange(ctx, slot, inserts));
  };
  return { current, commit };
}

/** The key's trace as the card shows it: each new cycle over the older ones, fading. */
function heldTrace(): (next: Float32Array) => Float32Array {
  let held: Float32Array | null = null;
  return (next) => {
    if (!held || held.length !== next.length) held = new Float32Array(next.length);
    for (let i = 0; i < next.length; i++)
      held[i] = Math.max(next[i]!, held[i]! * PUMP_TRACE.holdDecay);
    return held;
  };
}

/** The editor: its canvas, wired, and the scope loop that redraws it; `draw` for the knobs. */
function editor(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  model: PumpModel,
): { element: HTMLElement; draw(): void } {
  const canvas = document.createElement('canvas');
  canvas.className = 'pump-plot';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', PUMP_LABELS.plot);
  canvas.title = PUMP_LABELS.plot;
  const g = pumpCanvasContext(canvas);
  let palette: PumpPalette | null = null;
  let trace: Float32Array | null = null;
  let phase = 1;
  const draw = (): void => {
    if (!g || !canvas.isConnected) return;
    palette ??= pumpPalette(canvas);
    const spec = model.current();
    drawPump(g, { points: spec.points, depth: spec.depth, plot: PUMP_PLOT, palette, trace, phase });
  };
  wirePumpCurve({
    canvas,
    points: () => model.current().points,
    plot: () => PUMP_PLOT,
    edit: (points) => {
      model.commit({ ...model.current(), points });
      draw();
    },
  });
  followScope(ctx, slot, index, canvas, (reading) => {
    trace = reading.trace;
    phase = reading.phase;
    draw();
  });
  // The canvas reads the rack's accent once it is in the page.
  requestAnimationFrame(draw);
  const element = el('div', 'pump-plot-wrap');
  element.append(canvas);
  return { element, draw };
}

/** Each frame, the live stage's scope while `canvas` is on screen; off when it is not. */
function followScope(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  canvas: HTMLElement,
  show: (reading: { trace: Float32Array | null; phase: number }) => void,
): void {
  let active: InsertStage<InsertSpec>['pumpScope'];
  let seen = -1;
  const hold = heldTrace();
  let trace: Float32Array | null = null;
  const stop = (): void => {
    active?.setActive(false);
    active = undefined;
  };
  watchPlayhead({
    attached: () => {
      if (canvas.isConnected) return true;
      stop();
      return false;
    },
    shown: () => {
      if (canvas.closest('[hidden]') === null) return true;
      stop();
      return false;
    },
    playheadAt: () => {
      const next = liveInsert(ctx, slot, index)?.pumpScope;
      if (next !== active) {
        stop();
        active = next;
        active?.setActive(true);
      }
      const reading = active?.read();
      if (!reading) return -1;
      if (reading.trace && reading.traces !== seen) {
        seen = reading.traces;
        trace = hold(reading.trace);
      }
      // A new number whenever either the playhead or the trace moved.
      return reading.traces + reading.phase / 2;
    },
    mark: () => show({ trace, phase: active?.read().phase ?? 1 }),
  });
}

/** The source, and the length: Sync with its division, or Free with the Length knob. */
function timing(ctx: AppCtx, slot: InsertTarget, index: number, model: PumpModel): HTMLElement[] {
  const length = insertKnob(ctx, slot, index, pickKnobs(PUMP_KNOBS, ['lengthMs'])[0]!);
  const division = insertSelect({
    label: PUMP_LABELS.division,
    options: PUMP_DIVISIONS.map((d) => [d, d] as const),
    value: model.current().division,
    change: (value) => model.commit({ ...model.current(), division: value as PumpDivision }),
  });
  const shows = (): void => {
    division.hidden = !model.current().sync;
    length.hidden = model.current().sync;
  };
  const sync = seg(
    SYNC_OPTIONS,
    () => (model.current().sync ? 'on' : 'off'),
    (value) => {
      model.commit({ ...model.current(), sync: value === 'on' });
      shows();
    },
    STRIP_COLOR,
  );
  shows();
  return [wideColumn(sidechainCell(ctx, slot, index), division), wideColumn(sync, length)];
}

function page(ctx: AppCtx, slot: InsertTarget, index: number): HTMLElement {
  const model = pumpModel(ctx, slot, index);
  const shape = editor(ctx, slot, index, model);
  const result = insertPage(
    shape.element,
    ...timing(ctx, slot, index, model),
    ...bigInsertKnobs(ctx, slot, index, pickKnobs(PUMP_KNOBS, ['depth']), shape.draw),
    ...insertKnobs(ctx, slot, index, pickKnobs(PUMP_KNOBS, ['sensitivity', 'holdMs', 'smoothMs'])),
  );
  result.classList.add('pump-page');
  return result;
}

export const pumpCard: InsertCard = (ctx, slot, index) => [
  { name: 'Pump', build: () => page(ctx, slot, index) },
];
