/**
 * How long the Echo's loop takes to empty after its switch's fade out ends
 * (windsor#629, fix rounds 1 and 2 for PR #635), which the wet, the dry and
 * the feedback wait for before a switch on reopens them.
 *
 * Off closes the send and the feedback by the fade out's end, `offEnd`. A
 * native `DelayNode` cannot be cleared, but what it holds then leaves it
 * within one delay time: a sample written at `offEnd` is read at the `t`
 * where `t − delayTime(t) = offEnd`. So the wet, which carries nothing but
 * the loop's output, stays shut until then, and the feedback too, or it
 * would write the old repeats back in. Nothing new is lost to that: the send
 * opens at the switch on, and what it writes is read a delay time later, no
 * earlier.
 *
 * With Delay Time on a lane, the hold is the largest delay time the line
 * holds from `offEnd` until the hold has passed (grown until the window
 * reaches no longer one), not the line's 5 s maximum, which would mute a
 * quick switch on for seconds.
 *
 * A known limitation, accepted by tacowars on 2026-10-06 (record
 * `2026-10-06-insert-switch-lanes`, decision 8): the native line keeps the
 * last `DELAY_MAX_SECONDS` (5 s) of what it was fed and cannot be cleared,
 * so a Delay Time lane that lengthens the delay, past the time since the
 * off, within 5 s of the off reads audio from before the switch. The hold
 * does not cover that, and the line plays what it reads. From 5 s after the
 * off, nothing from before it is left to read.
 *
 * The line's output runs through the damp filter, a resonant lowpass, before
 * both the wet and the feedback (`mixer/returnEffects.ts`'s `attachDelay`),
 * and a native `BiquadFilterNode` cannot be cleared either (fix round 2). It
 * is fed the old repeats until the delay window ends and only then rings on
 * alone, so the wait is the window and then the ring, one after the other.
 * The ring is read off the filter's digital poles at the context's sample
 * rate (fix round 3): the RBJ lowpass's `a1` and `a2`, which Web Audio's
 * node uses, give the pole radius `r`, and the ring falls by
 * `ECHO_RING_FLOOR_DB` in `ln(10^(dB/20)) / −ln r` samples. A continuous
 * estimate undershoots near Nyquist, where the bilinear warp pulls the poles
 * to the unit circle: at 48 kHz, 20 kHz and 12 dB the poles need about
 * 3.4 ms, not 0.66.
 *
 * Over cutoff the ring falls to its shortest at a quarter of the sample rate
 * and grows on either side, and it grows with Resonance. So with Damp or
 * Resonance on a lane, the longest ring over the window is the highest
 * Resonance there at the lowest or the highest Damp there, whichever rings
 * longer.
 *
 * At the defaults (3200 Hz, 1 dB, 48 kHz) the ring is about 1.2 ms beside
 * the 280 ms delay; at the extremes (10 Hz or 20 kHz, 12 dB) about 1.3 s and
 * 3.4 ms. The cost: the wet and the feedback stay shut for the ring too, so
 * what the send takes in within the ring time of the fade out's end loses its
 * first repeat, and so every later one (at the defaults, the first 1.2 ms of
 * it). A switch on later than that loses nothing.
 *
 * `echoSwitchSettle.test.ts` pins the times, and `insertSwitchFadeNative.test.ts`
 * the sound.
 */
import { DELAY_MAX_SECONDS } from '../audioConstants';
import { dbToGain } from '../mixer/outputStageDsp';
import {
  ECHO_BOUNDS,
  ECHO_POLE_DISCRIMINANT_FACTOR,
  ECHO_RING_FLOOR_DB,
  ECHO_RING_MAX_STEPS,
} from './echoConstants';
import type { FieldReader } from './switchTimeline';

/** The value `field` takes over `[from, to]` that `pick` prefers: at either end or at a point between. */
function extremeOver(
  field: FieldReader,
  from: number,
  to: number,
  pick: (...values: number[]) => number,
): number {
  let found = pick(field.at(from), field.approaching(to), field.at(to));
  for (const t of field.times()) {
    if (t > from && t <= to) found = pick(found, field.approaching(t), field.at(t));
  }
  return found;
}

/** The largest value `field` takes over `[from, to]`: at either end or at a point between. */
export const largestOver = (field: FieldReader, from: number, to: number): number =>
  extremeOver(field, from, to, Math.max);

/** Seconds after `offEnd` until the line holds nothing written by then, from Delay Time's reader. */
export function loopEmptiesIn(offEnd: number, delayTime: FieldReader): number {
  let hold = Math.min(DELAY_MAX_SECONDS, largestOver(delayTime, offEnd, offEnd));
  for (;;) {
    const grown = Math.min(DELAY_MAX_SECONDS, largestOver(delayTime, offEnd, offEnd + hold));
    if (grown <= hold) return hold;
    hold = grown;
  }
}

/** The radius of the RBJ lowpass's poles at `cutoff` Hz and `resonance` dB: the larger, if they are real. */
export function lowpassPoleRadius(cutoff: number, resonance: number, sampleRate: number): number {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * dbToGain(resonance));
  const a0 = 1 + alpha;
  const a1 = -(2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  // Poles are the roots of z² + a1·z + a2.
  const discriminant = a1 * a1 - ECHO_POLE_DISCRIMINANT_FACTOR * a2;
  if (discriminant < 0) return Math.sqrt(a2);
  const root = Math.sqrt(discriminant);
  return Math.max(Math.abs(-a1 + root), Math.abs(-a1 - root)) / 2;
}

/**
 * Seconds for the damp filter at `cutoff` Hz and `resonance` dB to ring down
 * by `ECHO_RING_FLOOR_DB` at `sampleRate`. At or past Nyquist the node passes
 * its input through and holds nothing.
 */
export function ringTime(cutoff: number, resonance: number, sampleRate: number): number {
  if (cutoff >= sampleRate / 2) return 0;
  const radius = lowpassPoleRadius(cutoff, resonance, sampleRate);
  return Math.log(dbToGain(ECHO_RING_FLOOR_DB)) / -Math.log(radius) / sampleRate;
}

/** What the loop's emptying reads: the readers of Delay Time, Damp and Resonance. */
export interface EchoLoopReaders {
  readonly delayTime: FieldReader;
  readonly damp: FieldReader;
  readonly resonance: FieldReader;
  /** The context's, which places the damp filter's poles. */
  readonly sampleRate: number;
}

/** The longest ring over `[from, to]`: the highest resonance at the lowest or the highest cutoff. */
function longestRing(line: EchoLoopReaders, from: number, to: number): number {
  const resonance = largestOver(line.resonance, from, to);
  return Math.max(
    ringTime(extremeOver(line.damp, from, to, Math.min), resonance, line.sampleRate),
    ringTime(largestOver(line.damp, from, to), resonance, line.sampleRate),
  );
}

/** The longest ring Damp and Resonance's bounds allow. */
function boundRing(sampleRate: number): number {
  const [low, high] = ECHO_BOUNDS.damp;
  const resonance = ECHO_BOUNDS.resonance[1];
  return Math.max(ringTime(low, resonance, sampleRate), ringTime(high, resonance, sampleRate));
}

/**
 * Seconds after `offEnd` until the loop holds nothing from before it: the
 * line's window, then the damp filter's ring over it.
 */
export function loopSettlesIn(offEnd: number, line: EchoLoopReaders): number {
  const emptied = loopEmptiesIn(offEnd, line.delayTime);
  let ring = longestRing(line, offEnd, offEnd + emptied);
  for (let step = 0; step < ECHO_RING_MAX_STEPS; step++) {
    const grown = longestRing(line, offEnd, offEnd + emptied + ring);
    if (grown <= ring) return emptied + ring;
    ring = grown;
  }
  return emptied + Math.max(ring, boundRing(line.sampleRate));
}
