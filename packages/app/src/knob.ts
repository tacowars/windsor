/**
 * The console's one control: a drag/keyboard knob bound to a getter/setter.
 * Ported from the patch editor's original inline script (#70); the widget is
 * pure UI — every value lands wherever `set` points it.
 */

export interface KnobSpec {
  label: string;
  min: number;
  max: number;
  def: number;
  step?: number;
  curve?: 'log';
  fmt?: (v: number) => string;
  color?: string;
  get: () => number;
  set: (v: number) => void;
  onChange?: () => void;
}

/**
 * A knob element that can be told to re-read its value. Most knobs own their
 * field outright and never need it; the Coarse / Fine pair (#587) share one,
 * so a commit on either has to move the other's display.
 */
export interface KnobElement extends HTMLElement {
  refresh: () => void;
}

import { dragGesture, isModifierKey, mergedGesture } from './gestureHooks';
import type { OpenGesture } from './gestureHooks';
import {
  ARC_END,
  ARC_MIN_DEGREES,
  ARC_START,
  ARIA_VALUE_PRECISION,
  DRAG_RANGE_FINE_PX,
  DRAG_RANGE_PX,
  FACE_INSET,
  HALF_TURN_DEGREES,
  KEY_STEP,
  KEY_STEP_FINE,
  KNOB_PAD_PX,
  KNOB_R,
  LOG_FLOOR,
  PIN_INSET,
  TWELVE_OCLOCK_DEGREES,
} from './knobConstants';

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - TWELVE_OCLOCK_DEGREES) * Math.PI) / HALF_TURN_DEGREES;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > HALF_TURN_DEGREES ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function knobDom(spec: KnobSpec): HTMLElement {
  const node = document.createElement('div');
  node.className = 'knob';
  node.tabIndex = 0;
  node.setAttribute('role', 'slider');
  node.setAttribute('aria-label', spec.label);
  if (spec.color) node.style.setProperty('--knob-color', spec.color);
  const size = KNOB_R * 2 + KNOB_PAD_PX;
  const c = size / 2;
  node.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
    `<circle class="dial-face" cx="${c}" cy="${c}" r="${KNOB_R - FACE_INSET}"></circle>` +
    `<path class="dial-track" d="${arcPath(c, c, KNOB_R, ARC_START, ARC_END)}"></path>` +
    `<path class="dial-arc" d=""></path>` +
    `<line class="dial-pin" x1="${c}" y1="${c}" x2="${c}" y2="${c - KNOB_R + PIN_INSET}"></line>` +
    `</svg>` +
    `<span class="knob-val"></span><span class="knob-label">${spec.label}</span>`;
  node.title = `${spec.label} - drag, shift-drag for fine, double-click to reset`;
  return node;
}

export interface Scale {
  toNorm: (v: number) => number;
  fromNorm: (n: number) => number;
}

/** The part of a spec that decides where a value or a key press lands. */
export type KnobScaleSpec = Pick<KnobSpec, 'min' | 'max' | 'step' | 'curve'>;

function scaleFor(spec: KnobScaleSpec): Scale {
  if (spec.curve === 'log') {
    const lo = Math.log(Math.max(LOG_FLOOR, spec.min));
    const hi = Math.log(spec.max);
    return {
      toNorm: (v) => (Math.log(Math.max(LOG_FLOOR, v)) - lo) / (hi - lo),
      fromNorm: (n) => Math.exp(lo + Math.min(1, Math.max(0, n)) * (hi - lo)),
    };
  }
  return {
    toNorm: (v) => (v - spec.min) / (spec.max - spec.min),
    fromNorm: (n) => spec.min + Math.min(1, Math.max(0, n)) * (spec.max - spec.min),
  };
}

/**
 * Where an arrow key lands, before `commit` rounds and clamps it: the key's
 * share of the sweep, or exactly one `step` when that share is finer than the
 * knob's own grid. Without the fallback a coarsely stepped knob rounds
 * straight back to where it stood and the keyboard cannot move it at all —
 * Coarse (0..24 by 1) falls 2% of its range short, and so does shift on
 * Detune (#587).
 */
export function keyTarget(
  spec: KnobScaleSpec,
  current: number,
  dir: 1 | -1,
  fine: boolean,
): number {
  const scale = scaleFor(spec);
  const raw = scale.fromNorm(scale.toNorm(current) + dir * (fine ? KEY_STEP_FINE : KEY_STEP));
  const step = spec.step ?? 0;
  return step > 0 && Math.abs(raw - current) < step ? current + dir * step : raw;
}

/** Build one knob. The element re-renders itself after every commit. */
export function makeKnob(spec: KnobSpec): KnobElement {
  const node = knobDom(spec) as KnobElement;
  const arc = node.querySelector('.dial-arc') as SVGPathElement;
  const pin = node.querySelector('.dial-pin') as SVGLineElement;
  const out = node.querySelector('.knob-val') as HTMLElement;
  const size = KNOB_R * 2 + KNOB_PAD_PX;
  const c = size / 2;
  const { toNorm, fromNorm } = scaleFor(spec);

  const render = (): void => {
    const v = spec.get();
    const n = Math.min(1, Math.max(0, toNorm(v)));
    const ang = ARC_START + n * (ARC_END - ARC_START);
    const zeroN = spec.min < 0 && spec.max > 0 ? toNorm(0) : 0;
    const zeroAng = ARC_START + zeroN * (ARC_END - ARC_START);
    const a0 = Math.min(zeroAng, ang);
    const a1 = Math.max(zeroAng, ang);
    arc.setAttribute('d', Math.abs(a1 - a0) < ARC_MIN_DEGREES ? '' : arcPath(c, c, KNOB_R, a0, a1));
    pin.setAttribute('transform', `rotate(${ang} ${c} ${c})`);
    out.textContent = spec.fmt ? spec.fmt(v) : v.toFixed(2);
    node.setAttribute(
      'aria-valuenow',
      String(Math.round(v * ARIA_VALUE_PRECISION) / ARIA_VALUE_PRECISION),
    );
  };

  const commit = (raw: number): void => {
    let v = raw;
    if (spec.step) v = Math.round(v / spec.step) * spec.step;
    v = Math.min(spec.max, Math.max(spec.min, v));
    spec.set(v);
    render();
    spec.onChange?.();
  };

  attachKnobInput(node, spec, { toNorm, fromNorm }, commit);
  node.refresh = render;
  render();
  return node;
}

/** The arrow keys a knob steps on, and which way; any other key ends its merged step. */
const ARROW_KEYS: Readonly<Record<string, 1 | -1>> = {
  ArrowUp: 1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowLeft: -1,
};

/** Whether an input continues a knob's arrow-key step: another arrow on the knob, or a modifier alone. */
export function continuesKeySteps(e: Event, node: EventTarget): boolean {
  if (isModifierKey(e)) return true;
  return (
    e.type === 'keydown' && e.target === node && Object.hasOwn(ARROW_KEYS, (e as KeyboardEvent).key)
  );
}

/**
 * The knob's pointer and keys, each gesture one undo step named after the
 * knob (windsor#130 decisions 2 and 4): a drag from press to release, arrow
 * presses less than `UNDO_MERGE_MS` apart, a double-click's reset. Exported
 * for its test, which drives it over a stand-in element.
 */
export function attachKnobInput(
  node: HTMLElement,
  spec: KnobSpec,
  scale: Scale,
  commit: (v: number) => void,
): void {
  let drag: OpenGesture | null = null;
  let startY = 0;
  let startN = 0;
  node.addEventListener('pointerdown', (e) => {
    drag?.close();
    drag = dragGesture(spec.label);
    startY = e.clientY;
    startN = scale.toNorm(spec.get());
    node.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  const stop = (e: PointerEvent): void => {
    drag?.close();
    drag = null;
    if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
  };
  node.addEventListener('pointermove', (e) => {
    // A drag the window ended (a release outside the browser, a blur) moves nothing more.
    if (!drag?.open) return;
    // A release the knob never saw (capture lost to a window blur, a release
    // outside the browser, a re-render) would otherwise leave the drag live,
    // and the knob would follow the cursor whenever it hovers back.
    if ((e.buttons & 1) === 0) {
      stop(e);
      return;
    }
    const range = e.shiftKey ? DRAG_RANGE_FINE_PX : DRAG_RANGE_PX;
    commit(scale.fromNorm(startN - (e.clientY - startY) / range));
  });
  node.addEventListener('pointerup', stop);
  node.addEventListener('pointercancel', stop);
  node.addEventListener('lostpointercapture', stop);
  node.addEventListener('dblclick', () => commit(spec.def));
  const keys = mergedGesture({
    label: spec.label,
    continues: (e) => continuesKeySteps(e, node),
  });
  node.addEventListener('blur', () => keys.close());
  node.addEventListener('keydown', (e) => {
    const dir = Object.hasOwn(ARROW_KEYS, e.key) ? ARROW_KEYS[e.key] : undefined;
    if (dir === undefined) return;
    keys.touch();
    commit(keyTarget(spec, spec.get(), dir, e.shiftKey));
    e.preventDefault();
  });
}
