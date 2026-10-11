/**
 * bloom's dynamics (`BLOOM_DYNAMICS`): one compressor shared by every band,
 * then a ceiling on each band.
 *
 * The shared gain reads the input, not the bands: the mono input through a
 * linear-phase low-pass (a Blackman-windowed sinc at `detectorHz`, which keeps
 * a waveform's peak), rectified, its maximum over the last `holdSeconds`
 * (a monotonic deque), then an attack/release follower e. The static law is
 * (1 + (e/T)²)^(−q/2) · e²/(e² + X²): about 2:1 above the threshold, and an
 * expander that closes it at rest. The power runs through the portable log2
 * and 2^x in place (rule 6).
 *
 * The ceiling (`limit`) runs for the bands that sound: amplitude = the band's
 * darkened magnitude × the shared gain, followed per band with the same
 * attack and release, and held under `ceiling` (E's fundamental near
 * −13 dBFS at Amount 100 %). It leaves `level[b]`, before the selection gate,
 * and `room[b]`, the share of the band's amplitude the ceiling kept, so the
 * darkening can read the amplitude before it (`bloomSynth.ts`).
 *
 * Levers (`configure` runs once a block):
 * - Density (`SLOT_DENSITY`, smoothed, 0..1): the shared compressor's q, so
 *   its ratio is 1/(1 − Density): 0 follows the source's dynamics (only the
 *   expander at rest), 1 levels every note (the gain ∝ T/e). Its default,
 *   1 − 1/1.8, is the fitted q, kept exactly (a Density within float32
 *   rounding of it is it). Off the default a makeup, (1 + (P/T)²)^((q − q₀)/2)
 *   with P = `densityPivot`, keeps a −12 dBFS note where the default puts it,
 *   so Density reshapes the dynamics around the calibrated level instead of
 *   moving the whole layer. The ceiling stays.
 *
 * Per sample: `tick` (the shared gain, from `input`) before the bands, then
 * `limit` after them. No double crosses a call; every double field is born
 * NaN. Pinned by `inserts/bloomDsp.test.ts` and `bloomGolden.test.ts`.
 */
import { BLOOM_BANDS } from '../../inserts/bloomBandsConstants';
import { BLOOM_DYNAMICS as C } from '../../inserts/bloomDynamicsConstants';
import { cosine, sine } from '../../inserts/tapePortableMath';
import type { BloomBands } from './bloomBands';
import { exp2InPlace, log2InPlace } from '../fm/portablePowers';
import { bloomOnePoleStep } from './bloomPortable';
import { SLOT_DENSITY } from './bloomSlots';

class BloomDynamics {
  slots: Float64Array;
  controls: Float64Array;
  bands: BloomBands;
  /** Half the detector's symmetric taps (the centre last), and its doubled ring. */
  taps: Float64Array;
  ring: Float64Array;
  length: number;
  at: number;
  /** The hold's deque: values and the sample each expires at, as a ring. */
  peaks: Float64Array;
  expiry: Float64Array;
  head: number;
  tail: number;
  size: number;
  hold: number;
  clock: number;
  /** The shared follower, its steps, the law's exponent and the gain it gives. */
  envelope: number;
  attackStep: number;
  releaseStep: number;
  q: number;
  gain: number;
  /** The Density the law is set for, and its makeup (exactly 1 at the default). */
  density: number;
  makeup: number;
  /** The per-band ceiling's followers, each sounding band's level after it, and the share it kept (≤ 1). */
  ceilingEnvelope: Float64Array;
  level: Float64Array;
  room: Float64Array;
  /** Where the law's power is computed in place. */
  scratch: Float64Array;
  input: number;

  constructor(rate: number, slots: Float64Array, controls: Float64Array, bands: BloomBands) {
    this.envelope = this.attackStep = this.releaseStep = this.q = this.gain = NaN;
    this.clock = this.input = this.density = this.makeup = NaN;
    this.slots = slots;
    this.controls = controls;
    this.bands = bands;
    const half = Math.max(1, Math.round(((C.detectorTaps - 1) / 2) * (rate / C.detectorTapsRate)));
    this.length = 2 * half + 1;
    this.taps = new Float64Array(half + 1);
    this.detectorTaps(rate, half);
    this.ring = new Float64Array(2 * this.length);
    this.at = 0;
    this.hold = Math.max(1, Math.round(C.holdSeconds * rate));
    this.peaks = new Float64Array(this.hold + 2);
    this.expiry = new Float64Array(this.hold + 2);
    this.head = this.tail = this.size = 0;
    this.attackStep = bloomOnePoleStep(rate, C.attackSeconds);
    this.releaseStep = bloomOnePoleStep(rate, C.releaseSeconds);
    this.q = 1 - 1 / C.ratio;
    this.makeup = 1;
    this.ceilingEnvelope = new Float64Array(BLOOM_BANDS.count);
    this.level = new Float64Array(BLOOM_BANDS.count);
    this.room = new Float64Array(BLOOM_BANDS.count).fill(1);
    this.scratch = new Float64Array(1);
    this.configure();
    this.clear();
  }

  /** The windowed sinc's taps from the centre out, `taps[half]` the centre. Off the sample path. */
  detectorTaps(rate: number, half: number): void {
    const cutoff = (2 * C.detectorHz) / rate,
      span = 2 * half,
      [a0, a1, a2] = C.blackman;
    for (let k = 0; k <= half; k++) {
      const m = k - half;
      const sinc = m === 0 ? cutoff : sine(Math.PI * cutoff * m) / (Math.PI * m);
      const u = (2 * Math.PI * k) / span;
      this.taps[k] = sinc * (a0 - a1 * cosine(u) + a2 * cosine(2 * u));
    }
  }

  /** Once a block: `q` and the makeup from Density, when it moved. */
  configure(): void {
    const density = this.controls[SLOT_DENSITY];
    if (density === this.density) return;
    this.density = density;
    const fitted = 1 - 1 / C.ratio;
    if (Math.fround(density) === Math.fround(fitted)) {
      this.q = fitted;
      this.makeup = 1;
      return;
    }
    this.q = density;
    // makeup = (1 + (P/T)²)^((q − q₀)/2), by the portable log2 and 2^x in place.
    const scratch = this.scratch,
      pivot = C.densityPivot / C.threshold;
    scratch[0] = 1 + pivot * pivot;
    log2InPlace(scratch, 0);
    scratch[0] *= (density - fitted) / 2;
    exp2InPlace(scratch, 0);
    this.makeup = scratch[0];
  }

  clear(): void {
    this.ring.fill(0);
    this.peaks.fill(0);
    this.expiry.fill(0);
    this.ceilingEnvelope.fill(0);
    this.level.fill(0);
    this.room.fill(1);
    this.at = this.head = this.tail = this.size = 0;
    this.clock = 0;
    this.envelope = 0;
    this.gain = 0;
  }

  /** The detector's output for the newest sample: the symmetric FIR over the doubled ring. */
  detect(): void {
    const length = this.length,
      half = this.taps.length - 1,
      ring = this.ring,
      taps = this.taps;
    let at = this.at - 1;
    if (at < 0) at = length - 1;
    this.at = at;
    ring[at] = this.input;
    ring[at + length] = this.input;
    let sum = taps[half] * ring[at + half];
    for (let k = 0; k < half; k++) sum += taps[k] * (ring[at + k] + ring[at + length - 1 - k]);
    this.scratch[0] = sum < 0 ? -sum : sum;
  }

  /** The peak over the hold (a monotonic deque), the follower, and the shared gain from them. */
  tick(): void {
    this.detect();
    const value = this.scratch[0],
      capacity = this.peaks.length,
      clock = this.clock;
    while (this.size > 0) {
      const last = this.tail === 0 ? capacity - 1 : this.tail - 1;
      if (this.peaks[last] > value) break;
      this.tail = last;
      this.size--;
    }
    this.peaks[this.tail] = value;
    this.expiry[this.tail] = clock + this.hold;
    this.tail = this.tail + 1 === capacity ? 0 : this.tail + 1;
    this.size++;
    while (this.expiry[this.head] <= clock) {
      this.head = this.head + 1 === capacity ? 0 : this.head + 1;
      this.size--;
    }
    this.clock = clock + 1;
    const peak = this.peaks[this.head];
    let e = this.envelope;
    e += (peak > e ? this.attackStep : this.releaseStep) * (peak - e);
    this.envelope = e;
    const e2 = e * e,
      scratch = this.scratch;
    scratch[0] = 1 + e2 / (C.threshold * C.threshold);
    log2InPlace(scratch, 0);
    scratch[0] *= -this.q / 2;
    exp2InPlace(scratch, 0);
    this.gain = ((scratch[0] * e2) / (e2 + C.expander * C.expander)) * this.makeup;
  }

  /** Each sounding band's level: its darkened magnitude × the shared gain, under the ceiling. */
  limit(): void {
    const bands = this.bands,
      active = bands.active,
      norm = bands.norm,
      gain = this.gain,
      attack = this.attackStep,
      release = this.releaseStep;
    for (let i = 0; i < bands.activeCount; i++) {
      const b = active[i];
      const amplitude = norm[b] * gain;
      let e = this.ceilingEnvelope[b];
      e += (amplitude > e ? attack : release) * (amplitude - e);
      this.ceilingEnvelope[b] = e;
      const room = C.ceiling / (e + C.ceilingGuard);
      this.level[b] = room < 1 ? amplitude * room : amplitude;
      this.room[b] = room < 1 ? room : 1;
    }
  }
}

export { BloomDynamics };
