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
  /**
   * A log knob whose `min` is 0: the smallest value above 0 its sweep
   * reaches (default `LOG_FLOOR`). The sweep is logarithmic from here to
   * `max`, and the dial's bottom `ZERO_END_SLICE` runs straight from 0 to it.
   */
  logFloor?: number;
  fmt?: (v: number) => string;
  color?: string;
  /**
   * The compact size (windsor#157): a smaller dial with its value to the
   * right and no label under it, for a 40 px row. The label stays the
   * knob's `title`, `aria-label` and undo step.
   */
  compact?: boolean;
  /**
   * The insert rack's dial (windsor#173): `rack` is the smaller dial two
   * knobs to a column share, `rack-big` the larger one that stands alone.
   * Both keep the value and the label under the dial.
   */
  dial?: 'rack' | 'rack-big';
  get: () => number;
  set: (v: number) => void;
  onChange?: () => void;
  /**
   * Which lane holds the knob (windsor#351): null while none that is on does,
   * else the lane's colour and its value at the playhead. A held knob is
   * locked: drawn in the lane's colour with an AUTO tag, following the lane,
   * deaf to drags, keys and resets (`knobAutomation.ts`, `knobLock.ts`). A
   * knob a macro mapping holds is locked the same way, its tag the macro's
   * name (windsor#561).
   */
  automation?: () => KnobAutomation | null;
}

/**
 * A knob element that can be told to re-read its value. Most knobs own their
 * field outright and never need it; the Coarse / Fine pair (#587) share one,
 * so a commit on either has to move the other's display.
 */
export interface KnobElement extends HTMLElement {
  refresh: () => void;
}

import { escapeHtml } from './dom';
import { dragGesture, isModifierKey, mergedGesture, withGesture } from './gestureHooks';
import type { OpenGesture } from './gestureHooks';
import type { KnobAutomation } from './knobAutomation';
import { automatedValueText, lockNotice } from './knobAutomation';
import { AUTO_TAG_TEXT, followAutomation, paintLock } from './knobLock';
import { notify } from './toast';
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
  KNOB_COMPACT_PAD_PX,
  KNOB_COMPACT_R,
  KNOB_PAD_PX,
  KNOB_R,
  KNOB_RACK_BIG_R,
  KNOB_RACK_PAD_PX,
  KNOB_RACK_R,
  LOG_FLOOR,
  PIN_INSET,
  TWELVE_OCLOCK_DEGREES,
  ZERO_END_SLICE,
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

/** A dial's radius and its SVG's side, in px. */
export interface KnobGeometry {
  readonly r: number;
  readonly size: number;
}

/** The rack dials' radii, by `KnobSpec.dial`. */
const RACK_DIAL_R: Readonly<Record<NonNullable<KnobSpec['dial']>, number>> = {
  rack: KNOB_RACK_R,
  'rack-big': KNOB_RACK_BIG_R,
};

/** The dial's geometry at the spec's size. */
export function knobGeometry(spec: Pick<KnobSpec, 'compact' | 'dial'>): KnobGeometry {
  if (spec.compact) return { r: KNOB_COMPACT_R, size: KNOB_COMPACT_R * 2 + KNOB_COMPACT_PAD_PX };
  if (spec.dial) {
    const r = RACK_DIAL_R[spec.dial];
    return { r, size: r * 2 + KNOB_RACK_PAD_PX };
  }
  return { r: KNOB_R, size: KNOB_R * 2 + KNOB_PAD_PX };
}

/** The knob's classes: `compact`, or the rack's `rack` and `big`. */
function knobClass(spec: Pick<KnobSpec, 'compact' | 'dial'>): string {
  if (spec.compact) return 'knob compact';
  if (spec.dial === 'rack-big') return 'knob rack big';
  return spec.dial === 'rack' ? 'knob rack' : 'knob';
}

/**
 * The knob's inner markup: its dial, readout, AUTO tag and label. The label
 * is text, never markup: a macro's name (windsor#561) comes from whatever
 * patch was imported, so every knob escapes it here, at the sink.
 */
export function knobMarkup(
  spec: Pick<KnobSpec, 'label' | 'compact' | 'dial' | 'automation'>,
): string {
  const { r, size } = knobGeometry(spec);
  const c = size / 2;
  const label = spec.compact ? '' : `<span class="knob-label">${escapeHtml(spec.label)}</span>`;
  const tag = escapeHtml(AUTO_TAG_TEXT);
  const auto = spec.automation ? `<span class="knob-auto">${tag}</span>` : '';
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
    `<circle class="dial-face" cx="${c}" cy="${c}" r="${r - FACE_INSET}"></circle>` +
    `<path class="dial-track" d="${arcPath(c, c, r, ARC_START, ARC_END)}"></path>` +
    `<path class="dial-arc" d=""></path>` +
    `<line class="dial-pin" x1="${c}" y1="${c}" x2="${c}" y2="${c - r + PIN_INSET}"></line>` +
    `</svg>` +
    `<span class="knob-val"></span>${auto}${label}`
  );
}

/** The knob's tooltip: its label and how to turn it. */
export const knobTitle = (label: string): string =>
  `${label} - drag, shift-drag for fine, double-click to reset`;

/** Each relabelled knob's label now: what a press on it while locked names. */
const currentLabels = new WeakMap<HTMLElement, string>();

/**
 * Give a built knob a new label: its `aria-label`, its title, the label
 * under its dial and the name its lock notice gives. Its undo steps keep the
 * label it was built with.
 */
export function relabelKnob(node: HTMLElement, label: string): void {
  currentLabels.set(node, label);
  node.setAttribute('aria-label', label);
  node.title = knobTitle(label);
  const shown = node.querySelector('.knob-label');
  if (shown) shown.textContent = label;
}

function knobDom(spec: KnobSpec): HTMLElement {
  const node = document.createElement('div');
  node.className = knobClass(spec);
  node.tabIndex = 0;
  node.setAttribute('role', 'slider');
  if (spec.color) node.style.setProperty('--knob-color', spec.color);
  node.innerHTML = knobMarkup(spec);
  relabelKnob(node, spec.label);
  return node;
}

export interface Scale {
  toNorm: (v: number) => number;
  fromNorm: (n: number) => number;
  /**
   * A zero-end knob's slice (`ZERO_END_SLICE`): the normalised position its
   * log sweep starts at, its floor. Below it the dial runs straight from 0 to
   * the floor. Absent on a knob without a zero end.
   */
  readonly zeroTop?: number;
}

/** The part of a spec that decides where a value or a key press lands. */
export type KnobScaleSpec = Pick<KnobSpec, 'min' | 'max' | 'step' | 'curve' | 'logFloor'>;

const clampNorm = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * A log sweep from `floor` to `max`; every value up to the floor sits at its
 * bottom. Its two ends are the floor and `max` exactly, not `exp(log(…))`'s
 * neighbour of them, so a knob at either end reads back what it was set to.
 */
function logSweep(floor: number, max: number): Scale {
  const lo = Math.log(floor);
  const hi = Math.log(max);
  return {
    toNorm: (v) => (Math.log(Math.max(floor, v)) - lo) / (hi - lo),
    fromNorm: (n) => {
      if (n <= 0) return floor;
      return n >= 1 ? max : Math.exp(lo + n * (hi - lo));
    },
  };
}

/**
 * A log knob whose `min` is 0 (windsor#324 fix round 2): the bottom
 * `ZERO_END_SLICE` of the dial runs straight from exact 0 to its `logFloor`,
 * and the log sweep from the floor to `max` fills the rest. The floor keeps a
 * position of its own above 0, and a value under it (the refitted kicks ship
 * some) one of its own inside the slice, so `fromNorm(toNorm(v))` is `v`
 * across the whole range and a touch moves nothing.
 */
function zeroEndLogScale(floor: number, max: number): Scale {
  const sweep = logSweep(floor, max);
  const top = ZERO_END_SLICE;
  return {
    zeroTop: top,
    toNorm: (v) => {
      if (v <= 0) return 0;
      return v < floor ? (v / floor) * top : top + (1 - top) * sweep.toNorm(v);
    },
    fromNorm: (n) => {
      if (n <= 0) return 0;
      return n < top ? floor * (n / top) : sweep.fromNorm((n - top) / (1 - top));
    },
  };
}

/**
 * The knob's value ↔ sweep mapping. A log knob whose `min` is 0 ends its
 * dial on exact 0 (`zeroEndLogScale`), so a 0 that means
 * something (an envelope stage that ends on its own sample, windsor#316) can
 * be dialled, shown and committed.
 */
export function scaleFor(spec: KnobScaleSpec): Scale {
  if (spec.curve === 'log') {
    if (spec.min <= 0) return zeroEndLogScale(spec.logFloor ?? LOG_FLOOR, spec.max);
    return logSweep(Math.max(LOG_FLOOR, spec.min), spec.max);
  }
  return {
    toNorm: (v) => (v - spec.min) / (spec.max - spec.min),
    fromNorm: (n) => spec.min + clampNorm(n) * (spec.max - spec.min),
  };
}

/**
 * Where an arrow key lands, before `commit` rounds and clamps it: the key's
 * share of the sweep, or exactly one `step` when that share is finer than the
 * knob's own grid. Without the fallback a coarsely stepped knob rounds
 * straight back to where it stood and the keyboard cannot move it at all —
 * Coarse (0..24 by 1) falls 2% of its range short, and so does shift on
 * Detune (#587). Inside a zero end's slice a press lands on the fine key
 * grid, so a press up from 0 and one back down return to exact 0, not to a
 * rounding error's neighbour of it.
 */
export function keyTarget(
  spec: KnobScaleSpec,
  current: number,
  dir: 1 | -1,
  fine: boolean,
): number {
  const scale = scaleFor(spec);
  let n = scale.toNorm(current) + dir * (fine ? KEY_STEP_FINE : KEY_STEP);
  if (scale.zeroTop !== undefined && n < scale.zeroTop) {
    n = Math.round(n / KEY_STEP_FINE) * KEY_STEP_FINE;
  }
  const raw = scale.fromNorm(n);
  const step = spec.step ?? 0;
  return step > 0 && Math.abs(raw - current) < step ? current + dir * step : raw;
}

/** A knob's slider attributes at a value. */
export interface KnobAria {
  /** The raw stored value, rounded to `ARIA_VALUE_PRECISION`. */
  readonly valuenow: string;
  /** The visible readout, so a screen reader announces what the knob shows. */
  readonly valuetext: string;
}

/**
 * The knob's `aria-valuenow` and `aria-valuetext` at `v`. The text is the
 * readout itself, so a formatted knob (Tape's Drive in dB over a stored
 * 0..32) is announced as it reads, not as its raw value.
 */
export function knobAria(spec: Pick<KnobSpec, 'fmt'>, v: number): KnobAria {
  return {
    valuenow: String(Math.round(v * ARIA_VALUE_PRECISION) / ARIA_VALUE_PRECISION),
    valuetext: spec.fmt ? spec.fmt(v) : v.toFixed(2),
  };
}

/** Build one knob. The element re-renders itself after every commit. */
export function makeKnob(spec: KnobSpec): KnobElement {
  const node = knobDom(spec) as KnobElement;
  const arc = node.querySelector('.dial-arc') as SVGPathElement;
  const pin = node.querySelector('.dial-pin') as SVGLineElement;
  const out = node.querySelector('.knob-val') as HTMLElement;
  const { r, size } = knobGeometry(spec);
  const c = size / 2;
  const { toNorm, fromNorm } = scaleFor(spec);

  const render = (): void => {
    const lock = spec.automation?.() ?? null;
    const v = lock ? lock.value : spec.get();
    const n = Math.min(1, Math.max(0, toNorm(v)));
    const ang = ARC_START + n * (ARC_END - ARC_START);
    const zeroN = spec.min < 0 && spec.max > 0 ? toNorm(0) : 0;
    const zeroAng = ARC_START + zeroN * (ARC_END - ARC_START);
    const a0 = Math.min(zeroAng, ang);
    const a1 = Math.max(zeroAng, ang);
    arc.setAttribute('d', Math.abs(a1 - a0) < ARC_MIN_DEGREES ? '' : arcPath(c, c, r, a0, a1));
    pin.setAttribute('transform', `rotate(${ang} ${c} ${c})`);
    const aria = knobAria(spec, v);
    out.textContent = aria.valuetext;
    node.setAttribute('aria-valuenow', aria.valuenow);
    node.setAttribute('aria-valuetext', lock ? automatedValueText(aria.valuetext) : aria.valuetext);
    if (spec.automation) paintLock(node, lock);
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
  if (spec.automation) followAutomation(node, spec.automation, render);
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
  let startV = 0;
  const locked = (): boolean => (spec.automation?.() ?? null) !== null;
  node.addEventListener('pointerdown', (e) => {
    drag?.close();
    drag = null;
    const lock = spec.automation?.() ?? null;
    // The label now, not at build: a macro's knob is relabelled in place on a rename.
    if (lock) return notify(lockNotice(currentLabels.get(node) ?? spec.label, lock));
    drag = dragGesture(spec.label);
    startY = e.clientY;
    startV = spec.get();
    startN = scale.toNorm(startV);
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
    // No travel along the axis (a press, horizontal jitter) commits the value
    // the drag started from, not its round trip through the sweep.
    const dy = e.clientY - startY;
    const range = e.shiftKey ? DRAG_RANGE_FINE_PX : DRAG_RANGE_PX;
    commit(dy === 0 ? startV : scale.fromNorm(startN - dy / range));
  });
  node.addEventListener('pointerup', stop);
  node.addEventListener('pointercancel', stop);
  node.addEventListener('lostpointercapture', stop);
  // Each click's release has already closed its own (empty) drag step, so the
  // reset opens a step of its own under the knob's label.
  node.addEventListener('dblclick', () => {
    if (!locked()) withGesture(spec.label, () => commit(spec.def));
  });
  const keys = mergedGesture({
    label: spec.label,
    continues: (e) => continuesKeySteps(e, node),
  });
  node.addEventListener('blur', () => keys.close());
  node.addEventListener('keydown', (e) => {
    const dir = Object.hasOwn(ARROW_KEYS, e.key) ? ARROW_KEYS[e.key] : undefined;
    if (dir === undefined) return;
    // A locked knob still takes the arrows it would turn by, so they never scroll the page.
    e.preventDefault();
    if (locked()) return;
    keys.touch();
    commit(keyTarget(spec, spec.get(), dir, e.shiftKey));
  });
}
