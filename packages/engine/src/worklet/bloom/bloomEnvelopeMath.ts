/**
 * The envelope's per-band presence detector (`BloomPresence`), for Sustain
 * and Freeze (`bloomEnvelope.ts`): whether each band's input is still there,
 * the pitch it had, and whether its selection was only fleeting.
 *
 * - Present: the power of the band's first filter stage (a one-pole, whose
 *   ring-down falls from its first sample; the band's two-pole output starts
 *   falling only slowly) against a peak of that power decaying at a quarter
 *   of the stage's ring-down rate (|pole|^½ a sample). The input has left once
 *   the stage's amplitude is under `leaveRatio` × the peak's, and is back at
 *   `returnRatio` ×.
 * - The turn: while present, the bands' smoothed z[n]·conj(z[n−1]) is
 *   captured two deep every `captureRings`/(1 − |pole|) samples, so
 *   `capture` predates the ring-down presence takes to notice (whose pitch
 *   drifts towards the band's centre).
 * - Fleeting: a selection (gate at least `closingGate`) that closes before
 *   `selectRings`/(1 − |pole|) samples, judged only while the band's input
 *   drives it (its level at least `selectShare` × the envelope's, while it
 *   follows or within that span of starting to hold), was an
 *   onset passing through the band or a glide; Sustain holds it only briefly.
 *   So is a band that starts holding while not selected (an onset's leak
 *   that never reached the gate); one selected as it starts holding (a note
 *   that stopped) is not.
 *   A held band relocks to its input only once present and selected for
 *   `relockRings`/(1 − |pole|) samples, so a neighbour's leak passing through
 *   its selection on the way out does not take it.
 *
 * Reads the bands' stage, turn and gate and the envelope's `instant` and
 * `level`; per band, by index, so no double crosses a call.
 */
import { BLOOM_BANDS } from '../../inserts/bloomBandsConstants';
import { BLOOM_ENVELOPE as C } from '../../inserts/bloomEnvelopeConstants';
import type { BloomBands } from './bloomBands';

class BloomPresence {
  bands: BloomBands;
  /** The envelope's: this sample's input level per band (0 if not listed), and its level. */
  instant: Float64Array;
  level: Float64Array;
  /** The envelope's lock (1 follows the input), and samples since band `b` last started holding. */
  lock: Float64Array;
  heldFor: Int32Array;
  /** The first stage's decaying peak power and its factor a sample. */
  peak: Float64Array;
  peakKeep: Float64Array;
  present: Uint8Array;
  /** The captured turn, two deep, its clock and interval. */
  captureRe: Float64Array;
  captureIm: Float64Array;
  recentRe: Float64Array;
  recentIm: Float64Array;
  captureClock: Int32Array;
  captureEvery: Int32Array;
  /** Samples selected so far (up to `selectSpan`), and whether the last selection was fleeting. */
  selected: Int32Array;
  selectSpan: Int32Array;
  /** Samples present and selected so far (up to `relockSpan`): a held band relocks at the span. */
  returning: Int32Array;
  relockSpan: Int32Array;
  fleeting: Uint8Array;

  constructor(bands: BloomBands, instant: Float64Array, level: Float64Array, lock: Float64Array) {
    const n = BLOOM_BANDS.count;
    this.bands = bands;
    this.instant = instant;
    this.level = level;
    this.lock = lock;
    this.heldFor = new Int32Array(n);
    this.peak = new Float64Array(n);
    this.peakKeep = new Float64Array(n);
    this.present = new Uint8Array(n);
    this.captureRe = new Float64Array(n);
    this.captureIm = new Float64Array(n);
    this.recentRe = new Float64Array(n);
    this.recentIm = new Float64Array(n);
    this.captureClock = new Int32Array(n);
    this.captureEvery = new Int32Array(n);
    this.selected = new Int32Array(n);
    this.selectSpan = new Int32Array(n);
    this.returning = new Int32Array(n);
    this.relockSpan = new Int32Array(n);
    this.fleeting = new Uint8Array(n);
    this.factors();
  }

  /** The peak's factor and the two intervals, from the bands' poles (which Focus may move). */
  factors(): void {
    const bands = this.bands;
    for (let b = 0; b < BLOOM_BANDS.count; b++) {
      const r2 = bands.pole1Re[b] * bands.pole1Re[b] + bands.pole1Im[b] * bands.pole1Im[b];
      const r = Math.sqrt(r2);
      this.peakKeep[b] = Math.sqrt(r);
      this.captureEvery[b] = Math.max(1, Math.round(C.captureRings / (1 - r)));
      this.selectSpan[b] = Math.max(1, Math.round(C.selectRings / (1 - r)));
      this.relockSpan[b] = Math.min(this.selectSpan[b], Math.round(C.relockRings / (1 - r)));
    }
  }

  clear(): void {
    this.peak.fill(0);
    this.present.fill(0);
    this.captureRe.fill(0);
    this.captureIm.fill(0);
    this.recentRe.fill(0);
    this.recentIm.fill(0);
    this.captureClock.fill(0);
    this.selected.fill(0);
    this.heldFor.fill(0);
    this.returning.fill(0);
    this.fleeting.fill(0);
  }

  /** From the instant follow: every band's peak and turn as they are now; `sounding` bands present. */
  seed(sounding: Int32Array, count: number): void {
    const bands = this.bands;
    this.clear();
    for (let b = 0; b < BLOOM_BANDS.count; b++) {
      this.peak[b] = bands.stageRe[b] * bands.stageRe[b] + bands.stageIm[b] * bands.stageIm[b];
      this.captureRe[b] = this.recentRe[b] = bands.turnRe[b];
      this.captureIm[b] = this.recentIm[b] = bands.turnIm[b];
    }
    for (let i = 0; i < count; i++) this.present[sounding[i]] = 1;
  }

  /** Band `b` this sample: its peak, presence (and turn), and selection. */
  track(b: number): void {
    const bands = this.bands;
    const sr = bands.stageRe[b],
      si = bands.stageIm[b];
    const power = sr * sr + si * si;
    let p = this.peak[b] * this.peakKeep[b];
    if (p < C.powerFloor) p = 0;
    if (power > p) p = power;
    this.peak[b] = p;
    const since = this.heldFor[b];
    if (since < this.selectSpan[b]) this.heldFor[b] = since + 1;
    const x = this.instant[b];
    if (x === 0) {
      this.present[b] = 0;
      this.returning[b] = 0;
      return;
    }
    // Judged while the input drives the band: it follows it, or let go of it only just now.
    const judged = this.lock[b] === 1 || since < this.selectSpan[b];
    if (judged && x >= C.selectShare * this.level[b]) this.selection(b);
    const was = this.present[b] === 1;
    const ratio = was ? C.leaveRatio : C.returnRatio;
    const present = power >= p * ratio * ratio;
    this.present[b] = present ? 1 : 0;
    const returning = this.returning[b];
    if (!present || bands.gate[b] < C.closingGate) this.returning[b] = 0;
    else if (returning < this.relockSpan[b]) this.returning[b] = returning + 1;
    if (!present) return;
    if (!was) {
      this.captureRe[b] = this.captureIm[b] = this.recentRe[b] = this.recentIm[b] = 0;
      this.captureClock[b] = 0;
    }
    if (++this.captureClock[b] < this.captureEvery[b]) return;
    this.captureClock[b] = 0;
    this.captureRe[b] = this.recentRe[b];
    this.captureIm[b] = this.recentIm[b];
    this.recentRe[b] = bands.turnRe[b];
    this.recentIm[b] = bands.turnIm[b];
  }

  /** Band `b` starts holding: fleeting unless selected now (a note that stopped) or long enough already. */
  release(b: number): void {
    const short = this.selected[b] < this.selectSpan[b];
    this.heldFor[b] = 0;
    this.fleeting[b] = this.bands.gate[b] < C.closingGate && short ? 1 : 0;
  }

  /** How long band `b` has been selected: closing early makes it fleeting, lasting clears that. */
  selection(b: number): void {
    const span = this.selected[b];
    if (this.bands.gate[b] >= C.closingGate) {
      if (span < this.selectSpan[b]) this.selected[b] = span + 1;
      else this.fleeting[b] = 0;
      return;
    }
    if (span > 0 && span < this.selectSpan[b]) this.fleeting[b] = 1;
    this.selected[b] = 0;
  }
}

export { BloomPresence };
