/**
 * A knob's dial geometry and its second ring (windsor#725, windsor#785): the
 * polar maths and arcs the dial draws with, and the env ring outside its
 * track. The ring runs from the knob's centre to the value playing, with a
 * dot on it: a clip envelope's, or a MIDI CC's value with any envelope over
 * it, while the pin stays on the knob's own value. A knob a CC mapping
 * drives also has a hollow marker on the ring's radius, at the hardware's
 * position while pickup waits (record `2026-10-13-midi-cc-mapping`
 * decisions 2 and 7). `knob.ts` builds the dial; the stylesheet shows the
 * ring on `.env` and the marker on `.cc-waiting` (`knobLock.ts` sets both).
 */
import type { KnobAutomation } from './knobAutomation';
import type { KnobCc } from './knobCc';
import {
  ARC_END,
  ARC_MIN_DEGREES,
  ARC_START,
  ENV_RING_GAP,
  HALF_TURN_DEGREES,
  TWELVE_OCLOCK_DEGREES,
} from './knobConstants';
import { type KnobEnvelope, emptyKnobEnvelope } from './knobEnvelope';
import { paintEnvelope } from './knobLock';

/** The point at `deg` (0 at twelve o'clock, clockwise) on the circle round (`cx`, `cy`). */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - TWELVE_OCLOCK_DEGREES) * Math.PI) / HALF_TURN_DEGREES;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** The SVG path of the arc from `a0` to `a1` degrees, clockwise. */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > HALF_TURN_DEGREES ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** The dial angle, in degrees, of `v` on `toNorm`'s sweep. */
export const angleOf = (toNorm: (v: number) => number, v: number): number =>
  ARC_START + Math.min(1, Math.max(0, toNorm(v))) * (ARC_END - ARC_START);

/**
 * The ring a knob shows, or null: the envelope's (which rides on a held CC
 * itself, `knobEnvelope.ts`), else, under no lock, the run from the pin at
 * `pin` to the CC's value playing, written into `out`.
 */
export function knobRing(
  env: KnobEnvelope | null,
  lock: KnobAutomation | null,
  cc: Pick<KnobCc, 'held'> | null,
  pin: number,
  out: KnobEnvelope,
): KnobEnvelope | null {
  if (env) return env;
  if (lock !== null || cc === null || cc.held === null) return null;
  out.base = pin;
  out.playing = cc.held;
  return out;
}

/** What the knob hands its ring on each redraw. */
export interface KnobRingReads {
  readonly env: KnobEnvelope | null;
  readonly lock: KnobAutomation | null;
  readonly cc: KnobCc | null;
  /** The value the pin shows. */
  readonly pin: number;
}

/**
 * The ring's painter on `node`, a dial of radius `dialR` centred at `c`, or
 * null on a knob with no ring. Each call lights or clears the look
 * (`paintEnvelope`), draws the arc between the centre's and the playing
 * value's angles with the dot on the playing one, and places the hollow
 * marker.
 */
export function knobRingPainter(
  node: HTMLElement,
  c: number,
  dialR: number,
  toNorm: (v: number) => number,
): ((reads: KnobRingReads) => void) | null {
  const ring = node.querySelector('.dial-env');
  const dot = node.querySelector('.dial-env-dot');
  const hw = node.querySelector('.dial-cc-hw');
  if (!ring || !dot) return null;
  const r = dialR + ENV_RING_GAP;
  const out = emptyKnobEnvelope();
  const place = (point: Element, angle: number): void => {
    const [x, y] = polar(c, c, r, angle);
    point.setAttribute('cx', x.toFixed(2));
    point.setAttribute('cy', y.toFixed(2));
  };
  return ({ env, lock, cc, pin }) => {
    const shown = knobRing(env, lock, cc, pin, out);
    paintEnvelope(node, shown, lock, cc);
    if (shown) {
      const base = angleOf(toNorm, shown.base);
      const playing = angleOf(toNorm, shown.playing);
      const a0 = Math.min(base, playing);
      const a1 = Math.max(base, playing);
      ring.setAttribute('d', a1 - a0 < ARC_MIN_DEGREES ? '' : arcPath(c, c, r, a0, a1));
      place(dot, playing);
    }
    if (!hw) return;
    // No position heard since the song opened: no marker (decision 7).
    const marker = cc?.marker ?? null;
    (hw as SVGElement).style.display = marker === null ? 'none' : '';
    if (marker !== null) place(hw, angleOf(toNorm, marker));
  };
}
