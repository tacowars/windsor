/**
 * The Transient insert's detector (record `2026-10-18-transient-insert`
 * decision 3): the envelope difference of three followers of one peak,
 * which gives a hit's two shapes as ratios, so a hit at −40 dBFS is shaped
 * as one at 0 dBFS is.
 *
 * - **In:** `level`, the larger of the two channels' magnitudes this sample
 *   (stereo-linked, so both channels take one gain).
 * - **P**, `peak`: the true maximum of `level` over the last `hold` (a
 *   monotonic queue in two preallocated rings), so a steady tone at or
 *   above `1/(2·hold)` holds it flat rather than rippling.
 * - **F**, `follower`: P with an instant rise and a one-pole `fRelease`.
 * - **A**, `attackRef`: F with a one-pole rise `aAttack` and an instant fall.
 * - **S**, `sustainRef`: F with an instant rise and a one-pole fall `sRelease`.
 * - **Out:** `shapeA = 1 − A/F` and `shapeS = 1 − F/S`, each 0 to 1 and 0
 *   while its denominator is under `TRANSIENT_SLEEP.floor`. On a steady
 *   tone both are 0.
 *
 * The poles come from the rate through `exp2InPlace`, never `Math.exp`, so
 * a golden holds on every platform. Invariants: `step` allocates nothing and
 * takes and gives its values through fields (worklet rule 2); every double
 * field is born NaN (rule 7). Pinned by `inserts/transientDsp.test.ts`
 * (level independence, low-note ripple, rates) and `transientGolden.test.ts`.
 */
import { TRANSIENT_DSP as C, TRANSIENT_SLEEP } from '../../inserts/transientConstants';
import type { TransientTiming } from '../../inserts/transientTables';
import { exp2InPlace } from '../fm/portablePowers';

class TransientDetector {
  /** In: this sample's level. */
  level: number;
  /** Out: the onset shape and the decay shape, 0 to 1. */
  shapeA: number;
  shapeS: number;
  peak: number;
  follower: number;
  attackRef: number;
  sustainRef: number;
  /** The queue's levels, falling from the front, and the sample each arrived on. */
  readonly levels: Float64Array;
  readonly born: Float64Array;
  /** The queue's front slot and its length, in the rings of `capacity`. */
  head: number;
  count: number;
  readonly capacity: number;
  /** The window's length in samples, and this sample's number. */
  readonly span: number;
  now: number;
  readonly fPole: number;
  readonly aPole: number;
  readonly sPole: number;
  readonly floor: number;

  constructor(rate: number, timing: TransientTiming, scratch: Float64Array) {
    this.level = this.shapeA = this.shapeS = NaN;
    this.peak = this.follower = this.attackRef = this.sustainRef = this.now = NaN;
    this.fPole = this.aPole = this.sPole = this.floor = NaN;
    this.span = Math.max(1, Math.round(timing.holdMs * C.msToSeconds * rate));
    this.capacity = this.span + 1;
    this.levels = new Float64Array(this.capacity);
    this.born = new Float64Array(this.capacity);
    this.head = this.count = 0;
    this.fPole = poleOf(timing.fReleaseMs, rate, scratch);
    this.aPole = poleOf(timing.aAttackMs, rate, scratch);
    this.sPole = poleOf(timing.sReleaseMs, rate, scratch);
    this.floor = TRANSIENT_SLEEP.floor;
    this.reset();
  }

  /** At rest: nothing heard, every follower at 0, the window empty. */
  reset(): void {
    this.level = this.shapeA = this.shapeS = 0;
    this.peak = this.follower = this.attackRef = this.sustainRef = 0;
    this.now = 0;
    this.head = this.count = 0;
  }

  /** Every follower, and the window's peak, under the floor: what the sleep waits for. */
  settled(): boolean {
    const floor = this.floor;
    return (
      this.peak < floor &&
      this.follower < floor &&
      this.attackRef < floor &&
      this.sustainRef < floor
    );
  }

  /** One sample: `level` in, the window's peak, the three followers and the two shapes out. */
  step(): void {
    const level = this.level,
      capacity = this.capacity,
      levels = this.levels,
      born = this.born;
    const now = this.now + 1;
    this.now = now;
    // The back of the queue gives way to a level at least as high: the front is the maximum.
    let count = this.count;
    while (count > 0) {
      let back = this.head + count - 1;
      if (back >= capacity) back -= capacity;
      if (levels[back] > level) break;
      count--;
    }
    let tail = this.head + count;
    if (tail >= capacity) tail -= capacity;
    levels[tail] = level;
    born[tail] = now;
    count++;
    // The front leaves once it is older than the window.
    while (born[this.head] <= now - this.span) {
      this.head = this.head + 1 === capacity ? 0 : this.head + 1;
      count--;
    }
    this.count = count;
    const peak = levels[this.head];
    this.peak = peak;
    const f = peak > this.follower ? peak : this.follower + this.fPole * (peak - this.follower);
    this.follower = f;
    const a = f > this.attackRef ? this.attackRef + this.aPole * (f - this.attackRef) : f;
    this.attackRef = a;
    const s = f > this.sustainRef ? f : this.sustainRef + this.sPole * (f - this.sustainRef);
    this.sustainRef = s;
    const floor = this.floor;
    this.shapeA = f > floor ? 1 - a / f : 0;
    this.shapeS = s > floor ? 1 - f / s : 0;
  }
}

/** A one-pole's coefficient for `ms` at `rate`: `1 − 2^(−log2(e)/n)`, n the samples in `ms`. */
function poleOf(ms: number, rate: number, scratch: Float64Array): number {
  scratch[0] = -C.log2E / (ms * C.msToSeconds * rate);
  exp2InPlace(scratch, 0);
  return 1 - scratch[0];
}

export { TransientDetector, poleOf };
