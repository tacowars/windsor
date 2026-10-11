/**
 * bloom's analysis: 48 complex band-pass filters on the mono input (at the
 * analysis rate, after `bloomDecimator.ts`, whose droop each band's input
 * gain makes up), one per equal-tempered semitone F2…E6, fixed in Hz at
 * every rate, and the
 * selection that lets a band sound only while the input's frequency is
 * inside its semitone (`BLOOM_BANDS`).
 *
 * Each band is a 2-pole complex Butterworth band-pass: two complex one-poles
 * in cascade, poles at f_b ± the half-bandwidth's ±π/4 axis (matched z), its
 * input gain set so the analytic output z is 2 at f_b with zero phase, so |z|
 * is a real sine's amplitude and arg z its phase. The selection smooths
 * z[n]·conj(z[n−1]) (whose angle is the instantaneous frequency) with a
 * one-pole and tests its angle against the band's two edges by cross
 * products, so no arctangent runs; the gate fades towards in (1) or out (0).
 *
 * Per sample `tick` reads `input` and leaves, for every band, `re`/`im` (z),
 * `gate`, and for the bands that sound (gate and |z| over their floors) the
 * list `active[0 … activeCount)` with `norm` = √(|z|² + eps²), the low-level
 * darkening's amplitude.
 *
 * Levers (`configure` runs once a block):
 * - Low, High (`SLOT_LOW`, `SLOT_HIGH`, raw MIDI notes, rounded; either
 *   order): `enabled[b]` is 1 for the bands in [low, high], set only when a
 *   slot changes. A band outside never selects: its gate fades out (the
 *   selection's own `gateSeconds` fade, so no click), and once the gate is
 *   under `gateFloor` its state is cleared and it is `idle`, skipped by `tick`
 *   at no cost. Re-enabled, it starts from rest. The range's edges are the
 *   chosen notes' own semitone edges: no band takes over a masked band's
 *   notes, so those notes generate nothing.
 * - Focus (`SLOT_FOCUS`, smoothed, ×0.5…×2): every band's half-bandwidth
 *   × focus, so its poles and input gain, and with them the selection's
 *   discrimination and the group delay (∝ 1/focus). The poles are
 *   e^{jw} e^{−δ ± jδ}, δ = focus·δ₁ (`delta`), and the input gain that keeps
 *   z at 2 on the band's note is the real 2((1 − e^{−δ})² + 2e^{−δ}(1 − cos δ));
 *   `retune` builds them in place by small-argument series
 *   (`bloomBandsMath.ts`), once a block while Focus glides. At focus 1
 *   exactly it restores the constructor's `tune` (bit-exact default).
 *
 * No double crosses a call; every double field is born NaN. Pinned by
 * `inserts/bloomDsp.test.ts` and `bloomGolden.test.ts`.
 */
import { BLOOM_LOWEST_NOTE } from '../../inserts/bloomConstants';
import { BLOOM_BANDS as C } from '../../inserts/bloomBandsConstants';
import { cosine, exp2, sine } from '../../inserts/tapePortableMath';
import { bloomExpm1InPlace, bloomSinVersineInPlace } from './bloomBandsMath';
import type { BloomDecimator } from './bloomDecimator';
import { bloomExp, bloomOnePoleStep } from './bloomPortable';
import { SLOT_FOCUS, SLOT_HIGH, SLOT_LOW } from './bloomSlots';

class BloomBands {
  rate: number;
  slots: Float64Array;
  controls: Float64Array;
  /** Each band's centre in Hz, and its MIDI note. */
  centre: Float64Array;
  note: Int32Array;
  /** The two poles and the complex input gain, per band. */
  pole1Re: Float64Array;
  pole1Im: Float64Array;
  pole2Re: Float64Array;
  pole2Im: Float64Array;
  gainRe: Float64Array;
  gainIm: Float64Array;
  /** The same at focus 1 (`tune`'s own), restored when Focus returns to 1. */
  unitPole1Re: Float64Array;
  unitPole1Im: Float64Array;
  unitPole2Re: Float64Array;
  unitPole2Im: Float64Array;
  unitGainRe: Float64Array;
  unitGainIm: Float64Array;
  /** 1 / the decimator's gain at each band's centre, in the input gain. */
  makeup: Float64Array;
  /** e^{jw} of each band's centre, and its pole offset δ₁ at focus 1 (radians a sample). */
  rotationRe: Float64Array;
  rotationIm: Float64Array;
  delta: Float64Array;
  /** Low/High: 1 for a band in range; 1 for a band out of range, faded out and cleared (skipped). */
  enabled: Uint8Array;
  idle: Uint8Array;
  /** The Low/High slots and the Focus the bands are set for. */
  lowSlot: number;
  highSlot: number;
  focus: number;
  /** Where `retune`'s series run in place. */
  scratch: Float64Array;
  /** The first section's state; the second's is the output `re`/`im`. */
  stageRe: Float64Array;
  stageIm: Float64Array;
  re: Float64Array;
  im: Float64Array;
  /** The smoothed z[n]·conj(z[n−1]), and the selection's edges as unit vectors. */
  turnRe: Float64Array;
  turnIm: Float64Array;
  lowCos: Float64Array;
  lowSin: Float64Array;
  highCos: Float64Array;
  highSin: Float64Array;
  gate: Float64Array;
  norm: Float64Array;
  active: Int32Array;
  activeCount: number;
  selectStep: number;
  gateStep: number;
  input: number;

  constructor(
    rate: number,
    slots: Float64Array,
    controls: Float64Array,
    decimator: BloomDecimator,
  ) {
    this.rate = this.selectStep = this.gateStep = this.input = NaN;
    this.lowSlot = this.highSlot = this.focus = NaN;
    this.rate = rate;
    this.slots = slots;
    this.controls = controls;
    const n = C.count;
    this.centre = new Float64Array(n);
    this.note = new Int32Array(n);
    this.pole1Re = new Float64Array(n);
    this.pole1Im = new Float64Array(n);
    this.pole2Re = new Float64Array(n);
    this.pole2Im = new Float64Array(n);
    this.gainRe = new Float64Array(n);
    this.gainIm = new Float64Array(n);
    this.stageRe = new Float64Array(n);
    this.stageIm = new Float64Array(n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.turnRe = new Float64Array(n);
    this.turnIm = new Float64Array(n);
    this.lowCos = new Float64Array(n);
    this.lowSin = new Float64Array(n);
    this.highCos = new Float64Array(n);
    this.highSin = new Float64Array(n);
    this.gate = new Float64Array(n);
    this.norm = new Float64Array(n);
    this.active = new Int32Array(n);
    this.unitPole1Re = new Float64Array(n);
    this.unitPole1Im = new Float64Array(n);
    this.unitPole2Re = new Float64Array(n);
    this.unitPole2Im = new Float64Array(n);
    this.unitGainRe = new Float64Array(n);
    this.unitGainIm = new Float64Array(n);
    this.rotationRe = new Float64Array(n);
    this.rotationIm = new Float64Array(n);
    this.delta = new Float64Array(n);
    this.makeup = new Float64Array(n);
    this.enabled = new Uint8Array(n).fill(1);
    this.idle = new Uint8Array(n);
    this.scratch = new Float64Array(2);
    this.activeCount = 0;
    this.selectStep = bloomOnePoleStep(rate, C.selectSeconds);
    this.gateStep = bloomOnePoleStep(rate, C.gateSeconds);
    for (let b = 0; b < n; b++) this.place(b, decimator);
    this.focus = 1;
    this.range();
    this.configure();
  }

  /** Band `b`'s note, centre, makeup, focus-1 coefficients and edges. Constructor only. */
  place(b: number, decimator: BloomDecimator): void {
    this.note[b] = BLOOM_LOWEST_NOTE + b;
    this.centre[b] = C.a4Hz * exp2((this.note[b] - C.a4Note) / C.semitonesPerOctave);
    this.makeup[b] = 1 / decimator.gainAt(this.centre[b]);
    this.tune(b, 1);
    this.edges(b);
    this.unit(b);
  }

  /** Band `b`'s focus-1 coefficients kept, and what `retune` builds from. Off the sample path. */
  unit(b: number): void {
    this.unitPole1Re[b] = this.pole1Re[b];
    this.unitPole1Im[b] = this.pole1Im[b];
    this.unitPole2Re[b] = this.pole2Re[b];
    this.unitPole2Im[b] = this.pole2Im[b];
    this.unitGainRe[b] = this.gainRe[b];
    this.unitGainIm[b] = this.gainIm[b];
    const f = this.centre[b],
      w = (2 * Math.PI * f) / this.rate;
    this.rotationRe[b] = cosine(w);
    this.rotationIm[b] = sine(w);
    const halfWidth = 2 * Math.PI * (C.halfBandwidthFraction * f + C.halfBandwidthHz);
    this.delta[b] = (halfWidth * C.poleAxis) / this.rate;
  }

  /** Band `b`'s poles and input gain at `focus` × its half-bandwidth. Off the sample path. */
  tune(b: number, focus: number): void {
    const f = this.centre[b],
      rate = this.rate;
    const halfWidth = 2 * Math.PI * focus * (C.halfBandwidthFraction * f + C.halfBandwidthHz);
    const radius = bloomExp((-halfWidth * C.poleAxis) / rate);
    const w = (2 * Math.PI * f) / rate;
    const angle1 = w + (halfWidth * C.poleAxis) / rate,
      angle2 = w - (halfWidth * C.poleAxis) / rate;
    const p1r = radius * cosine(angle1),
      p1i = radius * sine(angle1);
    const p2r = radius * cosine(angle2),
      p2i = radius * sine(angle2);
    this.pole1Re[b] = p1r;
    this.pole1Im[b] = p1i;
    this.pole2Re[b] = p2r;
    this.pole2Im[b] = p2i;
    // H(f_b) = Π 1/(1 − p e^{−jw}); the input gain is 2/H(f_b) = 2 Π (1 − p e^{−jw}), over the decimator's.
    const er = cosine(w),
      ei = -sine(w);
    const d1r = 1 - (p1r * er - p1i * ei),
      d1i = -(p1r * ei + p1i * er);
    const d2r = 1 - (p2r * er - p2i * ei),
      d2i = -(p2r * ei + p2i * er);
    const makeup = 2 * this.makeup[b];
    this.gainRe[b] = makeup * (d1r * d2r - d1i * d2i);
    this.gainIm[b] = makeup * (d1r * d2i + d1i * d2r);
  }

  /** Band `b`'s selection edges: its semitone (biased up), the outer bands out to the gate's limits. */
  edges(b: number): void {
    const f = this.centre[b],
      half = exp2(1 / (2 * C.semitonesPerOctave)),
      bias = exp2(C.selectBiasCents / C.centsPerOctave);
    const low = b === 0 ? C.gateLowHz : (f / half) * bias;
    const high = b === C.count - 1 ? C.gateHighHz : f * half * bias;
    const toAngle = (2 * Math.PI) / this.rate;
    this.lowCos[b] = cosine(low * toAngle);
    this.lowSin[b] = sine(low * toAngle);
    this.highCos[b] = cosine(high * toAngle);
    this.highSin[b] = sine(high * toAngle);
  }

  /** Once a block: the range when Low or High moved, the poles while Focus moves. */
  configure(): void {
    const slots = this.slots;
    if (slots[SLOT_LOW] !== this.lowSlot || slots[SLOT_HIGH] !== this.highSlot) this.range();
    if (this.controls[SLOT_FOCUS] !== this.focus) this.retune();
  }

  /** `enabled` from Low and High (rounded, either order); a band coming back starts from rest. */
  range(): void {
    const low = this.slots[SLOT_LOW],
      high = this.slots[SLOT_HIGH];
    this.lowSlot = low;
    this.highSlot = high;
    const bottom = Math.round(low < high ? low : high),
      top = Math.round(low < high ? high : low);
    for (let b = 0; b < C.count; b++) {
      const note = this.note[b];
      const on = note >= bottom && note <= top ? 1 : 0;
      if (on === 1 && this.enabled[b] === 0) this.idle[b] = 0;
      this.enabled[b] = on;
    }
  }

  /** Every band's poles and input gain at this block's Focus, in place; focus 1 is `tune`'s own. */
  retune(): void {
    const focus = this.controls[SLOT_FOCUS];
    this.focus = focus;
    if (focus === 1) {
      this.pole1Re.set(this.unitPole1Re);
      this.pole1Im.set(this.unitPole1Im);
      this.pole2Re.set(this.unitPole2Re);
      this.pole2Im.set(this.unitPole2Im);
      this.gainRe.set(this.unitGainRe);
      this.gainIm.set(this.unitGainIm);
      return;
    }
    const scratch = this.scratch;
    for (let b = 0; b < C.count; b++) {
      const delta = focus * this.delta[b];
      scratch[0] = -delta;
      bloomExpm1InPlace(scratch, 0);
      const fall = scratch[0],
        radius = 1 + fall;
      scratch[0] = delta;
      bloomSinVersineInPlace(scratch, 0);
      const re = radius * (1 - scratch[1]),
        im = radius * scratch[0];
      const cr = this.rotationRe[b],
        ci = this.rotationIm[b];
      // p = e^{jw} · e^{−δ}(cos δ ± j sin δ); the gain 2|1 − e^{−δ}e^{jδ}|², real.
      this.pole1Re[b] = re * cr - im * ci;
      this.pole1Im[b] = re * ci + im * cr;
      this.pole2Re[b] = re * cr + im * ci;
      this.pole2Im[b] = re * ci - im * cr;
      this.gainRe[b] = 2 * this.makeup[b] * (fall * fall + 2 * radius * scratch[1]);
      this.gainIm[b] = 0;
    }
  }

  /** Band `b` out of range and silent: its state cleared, skipped from now on. */
  silence(b: number): void {
    this.stageRe[b] = this.stageIm[b] = this.re[b] = this.im[b] = 0;
    this.turnRe[b] = this.turnIm[b] = this.gate[b] = this.norm[b] = 0;
    this.idle[b] = 1;
  }

  clear(): void {
    this.stageRe.fill(0);
    this.stageIm.fill(0);
    this.re.fill(0);
    this.im.fill(0);
    this.turnRe.fill(0);
    this.turnIm.fill(0);
    this.gate.fill(0);
    this.norm.fill(0);
    for (let b = 0; b < C.count; b++) this.idle[b] = this.enabled[b] === 1 ? 0 : 1;
    this.activeCount = 0;
  }

  /** One sample of `input` through every band; the bands that sound into `active`. */
  // eslint-disable-next-line max-lines-per-function -- one hot loop, its arrays in locals
  tick(): void {
    const x = this.input,
      n = C.count,
      selectStep = this.selectStep,
      gateStep = this.gateStep,
      eps2 = C.darkening * C.darkening;
    // Every per-band array in a local: one load each, not one through `this` per band.
    const idle = this.idle,
      enabled = this.enabled,
      pole1Re = this.pole1Re,
      pole1Im = this.pole1Im,
      pole2Re = this.pole2Re,
      pole2Im = this.pole2Im,
      gainRe = this.gainRe,
      gainIm = this.gainIm,
      stageRe = this.stageRe,
      stageIm = this.stageIm,
      re = this.re,
      im = this.im,
      turnRe = this.turnRe,
      turnIm = this.turnIm,
      lowCos = this.lowCos,
      lowSin = this.lowSin,
      highCos = this.highCos,
      highSin = this.highSin,
      gate = this.gate,
      norm = this.norm,
      active = this.active;
    let count = 0;
    for (let b = 0; b < n; b++) {
      if (idle[b] === 1) continue;
      const p1r = pole1Re[b],
        p1i = pole1Im[b],
        p2r = pole2Re[b],
        p2i = pole2Im[b];
      const sr = stageRe[b],
        si = stageIm[b];
      const s1r = p1r * sr - p1i * si + gainRe[b] * x,
        s1i = p1r * si + p1i * sr + gainIm[b] * x;
      stageRe[b] = s1r;
      stageIm[b] = s1i;
      const zr0 = re[b],
        zi0 = im[b];
      const zr = p2r * zr0 - p2i * zi0 + s1r,
        zi = p2r * zi0 + p2i * zr0 + s1i;
      re[b] = zr;
      im[b] = zi;
      // The instantaneous frequency's phasor, z[n]·conj(z[n−1]), smoothed.
      let tr = turnRe[b],
        ti = turnIm[b];
      tr += selectStep * (zr * zr0 + zi * zi0 - tr);
      ti += selectStep * (zi * zr0 - zr * zi0 - ti);
      turnRe[b] = tr;
      turnIm[b] = ti;
      const above = lowCos[b] * ti - lowSin[b] * tr >= 0;
      const below = highCos[b] * ti - highSin[b] * tr < 0;
      const on = enabled[b] === 1;
      const g = gate[b] + gateStep * ((above && below && on ? 1 : 0) - gate[b]);
      gate[b] = g;
      if (!on && g < C.gateFloor) {
        this.silence(b);
        continue;
      }
      const power = zr * zr + zi * zi;
      if (g < C.gateFloor || power < C.magnitudeFloor * C.magnitudeFloor) continue;
      norm[b] = Math.sqrt(power + eps2);
      active[count++] = b;
    }
    this.activeCount = count;
  }
}

export { BloomBands };
