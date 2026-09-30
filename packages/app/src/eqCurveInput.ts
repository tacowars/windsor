/**
 * The Parametric EQ curve's gestures, wired (windsor#199 decision 4): a
 * press on a point selects its band and drags it, the wheel over a point and
 * Alt while dragging change Q, a double-click resets a point's gain or adds
 * a bell, and the keys select and nudge the selected band. What each does is
 * `eqCurveModel.ts`'s; this file only reads the pointer and the keys and
 * brackets the edits in undo steps, the way a knob does (`knob.ts`): a drag
 * from press to release, wheel turns and key presses a moment apart, a
 * double-click on its own.
 */
import type { EqSpec } from '@windsor/engine';
import type { EqDragStart, EqPlot } from './eqCurveModel';
import {
  doubleClick,
  dragBand,
  hitBand,
  keyEdit,
  wheelBand,
  wheelContinues,
  withBand,
} from './eqCurveModel';
import type { OpenGesture } from './gestureHooks';
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
}

/** The undo step's name for an edit of band `band` (0-based). */
const stepName = (band: number): string => `EQ band ${band + 1}`;

interface Drag {
  readonly band: number;
  start: EqDragStart;
  /** The modifiers the start was taken under: a change starts the drag afresh from where it is. */
  mods: string;
  readonly gesture: OpenGesture;
}

function local(canvas: HTMLCanvasElement, e: MouseEvent): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
}

const modsOf = (e: MouseEvent): string => `${e.shiftKey ? 's' : ''}${e.altKey ? 'a' : ''}`;

function wirePointer(host: EqCurveHost): void {
  const { canvas } = host;
  let drag: Drag | null = null;
  const hit = (e: MouseEvent): number =>
    hitBand(host.spec(), local(canvas, e), host.plot(), host.sampleRate());
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

function wireDoubleClick(host: EqCurveHost): void {
  host.canvas.addEventListener('dblclick', (e) => {
    const done = doubleClick(host.spec(), local(host.canvas, e), host.plot(), host.sampleRate());
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
 * Wheel ticks a moment apart on one band are one step, as a knob's turns are;
 * a tick on another band closes that step and opens its own (`wheelContinues`).
 */
export function bandWheelGesture(win: EventTarget = window): BandWheelGesture {
  const turns = mergedGesture({ label: 'EQ band Q', continues: isModifierKey, win });
  let last = -1;
  return {
    touch(band) {
      if (!wheelContinues(last, band)) turns.close();
      last = band;
      turns.touch();
    },
  };
}

function wireWheel(host: EqCurveHost): void {
  const { canvas } = host;
  const turns = bandWheelGesture();
  canvas.addEventListener(
    'wheel',
    (e) => {
      const spec = host.spec();
      const band = hitBand(spec, local(canvas, e), host.plot(), host.sampleRate());
      if (band < 0) return;
      e.preventDefault();
      if (band !== host.selected()) host.select(band);
      turns.touch(band);
      // Shift turns a vertical wheel sideways in some browsers, so either axis counts.
      const delta = e.deltaY || e.deltaX;
      host.edit(withBand(spec, band, wheelBand(spec.bands[band]!, delta, e.shiftKey)));
    },
    { passive: false },
  );
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
    const done = keyEdit(spec, selected, { key: e.key, alt: e.altKey, shift: e.shiftKey });
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
