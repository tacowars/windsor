/**
 * The Parametric EQ curve's gestures, wired (windsor#199 decision 4): a
 * press on a point selects its band and drags it, the wheel over a point and
 * Alt while dragging change Q, a double-click resets a point's gain or adds
 * a bell, and the keys select and nudge the selected band. What each does is
 * `eqCurveModel.ts`'s; this file only reads the pointer and the keys and
 * brackets the edits in undo steps, the way a knob does (`knob.ts`): a drag
 * from press to release, wheel turns and key presses a moment apart, a
 * double-click on its own.
 *
 * A point stands where the curve draws it (`shown`), at its lanes' values
 * while lanes hold its band (windsor#397), and a press on a point whose
 * frequency or gain a lane holds selects the band but refuses the drag.
 */
import type { EqSpec } from '@windsor/engine';
import type { EqDoubleClick, EqDragStart, EqPlot } from './eqCurveModel';
import {
  doubleClick,
  dragBand,
  hasQ,
  hitBand,
  keyEdit,
  wheelBand,
  wheelContinues,
  wheelPixels,
  withBand,
} from './eqCurveModel';
import type { MergedGesture, OpenGesture } from './gestureHooks';
import { dragGesture, isModifierKey, mergedGesture, withGesture } from './gestureHooks';

/** What the curve's gestures read and call on their card. */
export interface EqCurveHost {
  readonly canvas: HTMLCanvasElement;
  /** The insert's spec now, from the document. */
  spec(): EqSpec;
  plot(): EqPlot;
  sampleRate(): number;
  /** The band the panel edits. */
  selected(): number;
  /** Select `band` (session view state) and repaint the card. */
  select(band: number): void;
  /** Commit `spec` through `ctx.change` and repaint the curve, the band row and the knobs. */
  edit(spec: EqSpec): void;
  /** A double-click found every band on. */
  full(): void;
  /** The spec as drawn, held fields at their lanes' values; `spec` when absent. */
  shown?(): EqSpec;
  /**
   * A press on `band`'s point: true, having said why, when a lane holds the
   * frequency or gain a drag would move (windsor#397). Absent, every drag goes.
   */
  refuseDrag?(band: number): boolean;
}

/** Where the points stand: as drawn. */
const drawnSpec = (host: Pick<EqCurveHost, 'spec' | 'shown'>): EqSpec =>
  host.shown?.() ?? host.spec();

/** The undo step's name for an edit of band `band` (0-based). */
const stepName = (band: number): string => `EQ band ${band + 1}`;

interface Drag {
  readonly band: number;
  start: EqDragStart;
  /** The modifiers the start was taken under: a change starts the drag afresh from where it is. */
  mods: string;
  readonly gesture: OpenGesture;
}

/** What `local` reads of a canvas and an event: a test passes plain objects. */
type Boxed = Pick<HTMLCanvasElement, 'getBoundingClientRect'>;
type Pointed = Pick<MouseEvent, 'clientX' | 'clientY'>;

function local(canvas: Boxed, e: Pointed): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
}

const modsOf = (e: MouseEvent): string => `${e.shiftKey ? 's' : ''}${e.altKey ? 'a' : ''}`;

function wirePointer(host: EqCurveHost): void {
  const { canvas } = host;
  let drag: Drag | null = null;
  const hit = (e: MouseEvent): number =>
    hitBand(drawnSpec(host), local(canvas, e), host.plot(), host.sampleRate());
  const startAt = (band: number, e: MouseEvent): EqDragStart => {
    const spec = host.spec();
    return { band: spec.bands[band]!, scale: spec.scale, ...local(canvas, e) };
  };
  const stop = (e: PointerEvent): void => {
    drag?.gesture.close();
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.focus();
    const band = hit(e);
    if (band < 0) return;
    e.preventDefault();
    drag?.gesture.close();
    if (band !== host.selected()) host.select(band);
    if (host.refuseDrag?.(band)) return;
    drag = { band, start: startAt(band, e), mods: modsOf(e), gesture: dragGesture(stepName(band)) };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag?.gesture.open) {
      canvas.style.cursor = hit(e) >= 0 ? 'grab' : 'crosshair';
      return;
    }
    if ((e.buttons & 1) === 0) return stop(e);
    if (modsOf(e) !== drag.mods) {
      drag.start = startAt(drag.band, e);
      drag.mods = modsOf(e);
    }
    const move = { ...local(canvas, e), fine: e.shiftKey, alt: e.altKey };
    const band = dragBand(drag.start, move, host.plot());
    host.edit(withBand(host.spec(), drag.band, band));
  });
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('lostpointercapture', stop);
}

/**
 * A double-click's edit, found on the points as drawn and made on the stored
 * spec: only the band it touched changes, so a lane's value on another band
 * never lands in the song. An added bell takes an off band, which no lane
 * holds, so it is drawn where it is stored.
 */
export function doubleClickEdit(
  host: Pick<EqCurveHost, 'spec' | 'shown' | 'plot' | 'sampleRate'>,
  at: { readonly x: number; readonly y: number },
): EqDoubleClick {
  const done = doubleClick(drawnSpec(host), at, host.plot(), host.sampleRate());
  if (done.kind === 'full') return done;
  const spec = host.spec();
  const band =
    done.kind === 'reset' ? { ...spec.bands[done.band]!, gain: 0 } : done.spec.bands[done.band]!;
  return { ...done, spec: withBand(spec, done.band, band) };
}

function wireDoubleClick(host: EqCurveHost): void {
  host.canvas.addEventListener('dblclick', (e) => {
    const done = doubleClickEdit(host, local(host.canvas, e));
    if (done.kind === 'full') return host.full();
    withGesture(stepName(done.band), () => host.edit(done.spec));
    host.select(done.band);
  });
}

/** The wheel's Q steps: `touch(band)` before each tick's edit. */
export interface BandWheelGesture {
  touch(band: number): void;
}

/**
 * Wheel ticks a moment apart on one band are one step, as a knob's turns are,
 * named for its band as a drag's is; a tick on another band closes that step
 * and opens its own (`wheelContinues`).
 */
export function bandWheelGesture(win: EventTarget = window): BandWheelGesture {
  let turns: MergedGesture | null = null;
  let last = -1;
  return {
    touch(band) {
      if (!turns || !wheelContinues(last, band)) {
        turns?.close();
        turns = mergedGesture({ label: stepName(band), continues: isModifierKey, win });
      }
      last = band;
      turns.touch();
    },
  };
}

/** What the wheel handler reads of a `WheelEvent`: a test passes a plain object. */
export type EqWheel = Pointed &
  Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey' | 'preventDefault'>;

/** What the wheel handler reads of its host: the canvas only for its box. */
export type EqWheelHost = Omit<EqCurveHost, 'canvas'> & { readonly canvas: Boxed };

/**
 * One wheel event over the curve: over a point it selects that band and turns
 * its Q by the event's delta in px (`wheelPixels`), whatever unit it reports.
 * A 6 dB cut has no Q, so its wheel edits nothing and opens no step.
 */
export function wheelCurve(host: EqWheelHost, turns: BandWheelGesture, e: EqWheel): void {
  const spec = host.spec();
  const plot = host.plot();
  const band = hitBand(drawnSpec(host), local(host.canvas, e), plot, host.sampleRate());
  if (band < 0) return;
  e.preventDefault();
  if (band !== host.selected()) host.select(band);
  if (!hasQ(spec.bands[band]!)) return;
  turns.touch(band);
  // Shift turns a vertical wheel sideways in some browsers, so either axis counts.
  const delta = wheelPixels(e.deltaY || e.deltaX, e.deltaMode, plot.height);
  host.edit(withBand(spec, band, wheelBand(spec.bands[band]!, delta, e.shiftKey)));
}

function wireWheel(host: EqCurveHost): void {
  const turns = bandWheelGesture();
  host.canvas.addEventListener('wheel', (e) => wheelCurve(host, turns, e), { passive: false });
}

function wireKeys(host: EqCurveHost): void {
  const { canvas } = host;
  const keys = mergedGesture({
    label: 'EQ band',
    continues: (e) =>
      isModifierKey(e) ||
      (e.type === 'keydown' && e.target === canvas && (e as KeyboardEvent).key.startsWith('Arrow')),
  });
  canvas.addEventListener('blur', () => keys.close());
  canvas.addEventListener('keydown', (e) => {
    const spec = host.spec();
    const selected = host.selected();
    const key = { key: e.key, alt: e.altKey, shift: e.shiftKey };
    const done = keyEdit(spec, selected, key, host.plot());
    if (!done) return;
    e.preventDefault();
    if ('select' in done) return host.select(done.select);
    keys.touch();
    host.edit(withBand(spec, selected, done.band));
  });
}

/** Wire every gesture of the curve on `host.canvas`. */
export function wireEqCurve(host: EqCurveHost): void {
  wirePointer(host);
  wireDoubleClick(host);
  wireWheel(host);
  wireKeys(host);
}
