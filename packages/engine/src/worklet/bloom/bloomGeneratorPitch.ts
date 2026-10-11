/**
 * The generator's pitch stage (`bloomGenerator.ts`): Octave and Scale as a
 * ratio per band, R = octave · 2^(m/12) (`BLOOM_OCTAVE_RATIOS`; m the
 * semitones to the nearest scale note, ties down), and each sounding band's
 * synthesis phase `wave` with |wave| = |u|, so the low-level darkening is the
 * same per partial at every pitch.
 *
 * - Mode 0 (R = 1): wave = u, the envelope's phase as it is.
 * - Mode 1 (whole R, m = 0: +12, +19 as ×3, +24): wave = |u|·(u/|u|)^R,
 *   exact and phase-locked to the input.
 * - Mode 2 (−12, +7, any Scale shift): a unit phasor per band, the explicit
 *   phase state, advanced each sample by e^{iR(ω_b + ε)}. ε is the input's
 *   turn this sample off the band's centre ω_b, 2·atan(tan(ε/2)) by a short
 *   series; e^{iRω_b} is the target note's phasor to the octave's power
 *   (a half angle by √ for the denominators of 2), built at a retune;
 *   e^{iRε} is a series. One Newton step a sample, × 1 + (1 − |v|²)/2, keeps it on
 *   the unit circle, so it cannot drift. A turn past `deviationGuard` (a
 *   phase jump at an amplitude null) steps at the centre's rate. A band that
 *   did not sound on the previous sample restarts from its own phase.
 *
 * It runs at the analysis rate (`rate`); `bloomSynth.ts` carries `wave` to
 * the host rate. `partials[b]` is capped at the harmonic limit at the band's
 * centre × R, at the host rate (`hostRate`), so nothing aliases; `tuning`
 * counts retunes. No transcendental `Math`; no double crosses a call; every
 * double field is born NaN.
 */
import { BLOOM_LOWEST_NOTE } from '../../inserts/bloomConstants';
import { BLOOM_BANDS } from '../../inserts/bloomBandsConstants';
import { BLOOM_GENERATOR as C, BLOOM_OCTAVE_RATIOS } from '../../inserts/bloomGeneratorConstants';
import { cosine, exp2, sine } from '../../inserts/tapePortableMath';
import type { BloomEnvelope } from './bloomEnvelope';
import {
  BLOOM_GENERATOR_ATAN,
  BLOOM_GENERATOR_COSINE,
  BLOOM_GENERATOR_DEGREES,
  BLOOM_GENERATOR_SINE,
  bloomScaleCorrections,
} from './bloomGeneratorMath';

class BloomGeneratorPitch {
  envelope: BloomEnvelope;
  centre: Float64Array;
  limit: number;
  /** Per band: 0 as is, 1 a whole power (`power`), 2 the phasor; R; e^{iRω_b}; e^{iω_b}. */
  mode: Int32Array;
  power: Int32Array;
  ratio: Float64Array;
  stepRe: Float64Array;
  stepIm: Float64Array;
  centreCos: Float64Array;
  centreSin: Float64Array;
  /** e^{iω} of every note a band can be re-pitched to, from the lowest band − `reach`. */
  noteCos: Float64Array;
  noteSin: Float64Array;
  reach: number;
  semitone: Float64Array;
  corrections: Int32Array;
  scales: number;
  partials: Int32Array;
  /** The phase each band is synthesised at, and mode 2's state. */
  waveRe: Float64Array;
  waveIm: Float64Array;
  phasorRe: Float64Array;
  phasorIm: Float64Array;
  lastRe: Float64Array;
  lastIm: Float64Array;
  stamp: Int32Array;
  clock: number;
  tuning: number;

  constructor(rate: number, hostRate: number, envelope: BloomEnvelope, centre: Float64Array) {
    this.limit = NaN;
    this.envelope = envelope;
    this.centre = centre;
    this.limit = Math.min(C.harmonicLimitHz, C.nyquistShare * hostRate);
    this.tuning = 0;
    const n = BLOOM_BANDS.count;
    this.mode = new Int32Array(n);
    this.power = new Int32Array(n);
    this.partials = new Int32Array(n);
    this.ratio = new Float64Array(n);
    this.stepRe = new Float64Array(n);
    this.stepIm = new Float64Array(n);
    this.waveRe = new Float64Array(n);
    this.waveIm = new Float64Array(n);
    this.phasorRe = new Float64Array(n);
    this.phasorIm = new Float64Array(n);
    this.lastRe = new Float64Array(n);
    this.lastIm = new Float64Array(n);
    this.stamp = new Int32Array(n);
    this.clock = 2;
    this.corrections = bloomScaleCorrections();
    this.scales = this.corrections.length / BLOOM_GENERATOR_DEGREES;
    let reach = 0;
    for (const m of this.corrections) reach = Math.max(reach, Math.abs(m));
    this.reach = reach;
    const perOctave = BLOOM_BANDS.semitonesPerOctave;
    this.semitone = Float64Array.from({ length: 2 * reach + 1 }, (_, i) =>
      exp2((i - reach) / perOctave),
    );
    this.noteCos = new Float64Array(n + 2 * reach);
    this.noteSin = new Float64Array(n + 2 * reach);
    for (let i = 0; i < n + 2 * reach; i++) {
      const note = BLOOM_LOWEST_NOTE - reach + i;
      const hz = BLOOM_BANDS.a4Hz * exp2((note - BLOOM_BANDS.a4Note) / perOctave);
      this.noteCos[i] = cosine((2 * Math.PI * hz) / rate);
      this.noteSin[i] = sine((2 * Math.PI * hz) / rate);
    }
    this.centreCos = this.noteCos.slice(reach, reach + n);
    this.centreSin = this.noteSin.slice(reach, reach + n);
  }

  /** Every band's mode, ratio, step and partial count for Octave step `octave`, `key` and `scale`. */
  retune(octave: number, key: number, scale: number): void {
    const ratio = BLOOM_OCTAVE_RATIOS[octave],
      num = ratio[0],
      den = ratio[1],
      row = scale * BLOOM_GENERATOR_DEGREES,
      reach = this.reach,
      degrees = BLOOM_GENERATOR_DEGREES;
    for (let b = 0; b < BLOOM_BANDS.count; b++) {
      const degree = (((BLOOM_LOWEST_NOTE + b - key) % degrees) + degrees) % degrees;
      const m = this.corrections[row + degree];
      const r = (num / den) * this.semitone[m + reach];
      this.ratio[b] = r;
      this.power[b] = num;
      this.mode[b] = m === 0 && den === 1 ? (num === 1 ? 0 : 1) : 2;
      this.partials[b] = Math.floor(this.limit / (this.centre[b] * r));
      let cr = this.noteCos[b + m + reach],
        ci = this.noteSin[b + m + reach];
      if (den === 2) {
        const half = Math.sqrt((1 + cr) / 2);
        ci = ci / (2 * half);
        cr = half;
      }
      let sr = cr,
        si = ci;
      for (let j = 1; j < num; j++) {
        const next = sr * cr - si * ci;
        si = sr * ci + si * cr;
        sr = next;
      }
      this.stepRe[b] = sr;
      this.stepIm[b] = si;
    }
    this.tuning = (this.tuning + 1) | 0;
    this.restart();
  }

  /** Every phasor starts afresh from its band's own phase. */
  restart(): void {
    this.clock = (this.clock + 2) | 0;
  }

  /** Each sounding band's synthesis phase `wave`, by its mode. */
  tick(): void {
    const envelope = this.envelope,
      sounding = envelope.sounding,
      last = this.clock;
    this.clock = (last + 1) | 0;
    for (let i = 0; i < envelope.soundingCount; i++) {
      const b = sounding[i],
        mode = this.mode[b];
      if (mode === 0) {
        this.waveRe[b] = envelope.phaseRe[b];
        this.waveIm[b] = envelope.phaseIm[b];
      } else if (mode === 1) this.raise(b);
      else this.follow(b, last);
    }
  }

  /** Mode 1: wave = |u|·(u/|u|)^n, n whole. */
  raise(b: number): void {
    const ur = this.envelope.phaseRe[b],
      ui = this.envelope.phaseIm[b];
    const r = Math.sqrt(ur * ur + ui * ui),
      cr = ur / r,
      ci = ui / r;
    let wr = cr,
      wi = ci;
    for (let j = 1; j < this.power[b]; j++) {
      const next = wr * cr - wi * ci;
      wi = wr * ci + wi * cr;
      wr = next;
    }
    this.waveRe[b] = wr * r;
    this.waveIm[b] = wi * r;
  }

  /** Mode 2: the phasor advanced by e^{iR(ω_b + ε)} and renormalised; wave = |u|·phasor. */
  follow(b: number, last: number): void {
    const ur = this.envelope.phaseRe[b],
      ui = this.envelope.phaseIm[b];
    const r = Math.sqrt(ur * ur + ui * ui),
      cr = ur / r,
      ci = ui / r;
    let vr = cr,
      vi = ci;
    if (this.stamp[b] === last) {
      // e = u·conj(u′)·e^{−iω_b}: this sample's turn off the centre; x = tan(ε/2).
      const pr = this.lastRe[b],
        pi = this.lastIm[b];
      const tr = cr * pr + ci * pi,
        ti = ci * pr - cr * pi;
      const wc = this.centreCos[b],
        ws = this.centreSin[b];
      const x = (ti * wc - tr * ws) / (1 + tr * wc + ti * ws);
      let theta = 0;
      if (x <= C.deviationGuard && x >= -C.deviationGuard) {
        const x2 = x * x,
          atan = BLOOM_GENERATOR_ATAN;
        let sum = atan[atan.length - 1];
        for (let j = atan.length - 2; j >= 0; j--) sum = sum * x2 + atan[j];
        theta = this.ratio[b] * 2 * x * sum;
      }
      const t2 = theta * theta,
        sines = BLOOM_GENERATOR_SINE,
        cosines = BLOOM_GENERATOR_COSINE;
      let s = sines[sines.length - 1],
        c = cosines[cosines.length - 1];
      for (let j = sines.length - 2; j >= 0; j--) {
        s = s * t2 + sines[j];
        c = c * t2 + cosines[j];
      }
      s *= theta;
      const sr = this.stepRe[b],
        si = this.stepIm[b];
      const qr = sr * c - si * s,
        qi = sr * s + si * c;
      const or = this.phasorRe[b],
        oi = this.phasorIm[b];
      vr = or * qr - oi * qi;
      vi = or * qi + oi * qr;
      const fix = 1 + (1 - (vr * vr + vi * vi)) / 2;
      vr *= fix;
      vi *= fix;
    }
    this.phasorRe[b] = vr;
    this.phasorIm[b] = vi;
    this.lastRe[b] = cr;
    this.lastIm[b] = ci;
    this.stamp[b] = this.clock;
    this.waveRe[b] = vr * r;
    this.waveIm[b] = vi * r;
  }
}

export { BloomGeneratorPitch };
