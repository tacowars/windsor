/**
 * The Parametric EQ's stereo signal path (windsor#198): eight bands, the
 * output gain and the enable crossfade, zero latency, no oversampling.
 *
 * Owns the block's route. A bypassed EQ (disabled and faded out) copies its
 * input; so does one whose every band is idle with output at unity, which is
 * why a new, flat EQ is bit for bit transparent. Silent input over state
 * already flushed to zero writes zeros without filtering (every glide and
 * fade completes at once, since nothing can be heard). Anything else runs in
 * pieces: one refresh step (`EQ_DSP.refreshFrames`) while a band, the output
 * or the enable moves, so coefficients follow the glides, or the whole block
 * once settled. State below `EQ_DSP.flushThreshold` is flushed after each
 * block.
 *
 * Invariants: nothing allocates after the constructor; the output of the
 * copy paths is the input's own samples. Pinned by `inserts/eqDsp.test.ts`
 * through the shipped bundle.
 */
import { EQ_DSP as D, EQ_MATH as M } from '../../inserts/eqConstants';
import { EqBand } from './eqBand';
import { glideSections, mixFade, runSections } from './eqSections';

export class EqDsp {
  bands: EqBand[];
  /** The stereo work buffers, and a band's input kept for its fade. */
  workL: Float64Array;
  workR: Float64Array;
  dryL: Float64Array;
  dryR: Float64Array;
  /** The block's audio, set by `process` for its pieces. */
  inL: Float32Array;
  inR: Float32Array;
  outL: Float32Array;
  outR: Float32Array;
  /** Written by the processor each block, then applied by `retarget`. */
  nextOutput: number;
  nextEnabled: boolean;
  gain: number;
  gainTarget: number;
  gainMoving: boolean;
  gainStep: number;
  enabled: boolean;
  bypassed: boolean;
  /** The enable crossfade's phase (0 dry, 1 EQ) and direction. */
  mix: number;
  mixDir: number;
  mixStep: number;
  /** Every band's state was zero after the last block. */
  clear: boolean;
  started: boolean;

  constructor(sampleRate: number, bands: number) {
    this.bands = [];
    for (let b = 0; b < bands; b++) this.bands.push(new EqBand(sampleRate));
    this.workL = new Float64Array(D.blockFrames);
    this.workR = new Float64Array(D.blockFrames);
    this.dryL = new Float64Array(D.blockFrames);
    this.dryR = new Float64Array(D.blockFrames);
    this.inL = this.inR = this.outL = this.outR = new Float32Array(0);
    this.nextOutput = 0;
    this.nextEnabled = true;
    this.gain = this.gainTarget = 1;
    this.gainMoving = false;
    this.gainStep = 1 - Math.exp(-1 / (D.smoothSeconds * sampleRate));
    this.enabled = true;
    this.bypassed = false;
    this.mix = 1;
    this.mixDir = 0;
    this.mixStep = 1 / (D.enableFadeSeconds * sampleRate);
    this.clear = true;
    this.started = false;
  }

  /** Apply the processor's `next*` values; the first block, and a bypassed EQ, snap. */
  retarget(): void {
    const snap = !this.started || (this.bypassed && !this.nextEnabled);
    this.started = true;
    for (let b = 0; b < this.bands.length; b++) this.bands[b].retarget(snap || this.bypassed);
    this.gainTarget = Math.pow(M.decimal, this.nextOutput / M.dbPerDecade);
    if (snap) this.gain = this.gainTarget;
    this.gainMoving = Math.abs(this.gainTarget - this.gain) > D.settleGain;
    if (!this.gainMoving) this.gain = this.gainTarget;
    if (snap) {
      this.enabled = this.nextEnabled;
      this.bypassed = !this.enabled;
      this.mix = this.enabled ? 1 : 0;
      this.mixDir = 0;
    } else if (this.nextEnabled !== this.enabled) {
      this.enabled = this.nextEnabled;
      this.mixDir = this.enabled ? 1 : -1;
      this.bypassed = false;
    }
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array): void {
    const frames = outL.length;
    if (this.bypassed || (this.quiet() && this.gain === 1)) {
      for (let i = 0; i < frames; i++) {
        outL[i] = inL[i];
        outR[i] = inR[i];
      }
      return;
    }
    if (this.clear && this.silent(inL, inR, frames)) {
      this.finish();
      outL.fill(0);
      outR.fill(0);
      return;
    }
    this.inL = inL;
    this.inR = inR;
    this.outL = outL;
    this.outR = outR;
    for (let at = 0; at < frames;) {
      const n = Math.min(frames - at, this.busy() ? D.refreshFrames : D.blockFrames);
      this.piece(at, n);
      at += n;
    }
    let clear = true;
    for (let b = 0; b < this.bands.length; b++) if (!this.bands[b].flush()) clear = false;
    this.clear = clear;
    if (this.mix === 0 && this.mixDir === 0) this.bypass();
  }

  /** Faded out: the bands stop, their state cleared for the fade back in. */
  bypass(): void {
    this.bypassed = true;
    for (let b = 0; b < this.bands.length; b++) this.bands[b].clear();
    this.clear = true;
  }

  /** Every band idle and steady, the output settled and the EQ fully in. */
  quiet(): boolean {
    if (this.gainMoving || this.mixDir !== 0 || this.mix !== 1) return false;
    for (let b = 0; b < this.bands.length; b++) {
      const band = this.bands[b];
      if (band.fadeDir !== 0 || !band.idle()) return false;
    }
    return true;
  }

  /** Something moves, so coefficients and fades advance a refresh step at a time. */
  busy(): boolean {
    if (this.gainMoving || this.mixDir !== 0) return true;
    for (let b = 0; b < this.bands.length; b++)
      if (this.bands[b].moving || this.bands[b].fadeDir !== 0) return true;
    return false;
  }

  silent(inL: Float32Array, inR: Float32Array, frames: number): boolean {
    for (let i = 0; i < frames; i++) if (inL[i] !== 0 || inR[i] !== 0) return false;
    return true;
  }

  /** Complete every glide and fade now (nothing is heard while input and state are silent). */
  finish(): void {
    for (let b = 0; b < this.bands.length; b++) this.bands[b].finish();
    this.gain = this.gainTarget;
    this.gainMoving = false;
    this.mix = this.enabled ? 1 : 0;
    this.mixDir = 0;
    if (!this.enabled) this.bypass();
  }

  /** Render `frames` samples from `at`: the bands, the output gain, the enable crossfade. */
  piece(at: number, frames: number): void {
    const wL = this.workL;
    const wR = this.workR;
    for (let i = 0; i < frames; i++) {
      wL[i] = this.inL[at + i];
      wR[i] = this.inR[at + i];
    }
    for (let b = 0; b < this.bands.length; b++) this.band(this.bands[b], frames);
    this.output(frames);
    const outL = this.outL;
    const outR = this.outR;
    if (this.mixDir === 0 && this.mix === 1) {
      for (let i = 0; i < frames; i++) {
        outL[at + i] = wL[i];
        outR[at + i] = wR[i];
      }
      return;
    }
    const step = this.mixDir * this.mixStep;
    for (let i = 0; i < frames; i++) {
      // The smoothstep of the phase, as a band's fade (`mixFade`).
      const phase = this.mix + step * (i + 1);
      const t = phase < 0 ? 0 : phase > 1 ? 1 : phase;
      const g = t * t * (M.three - 2 * t);
      outL[at + i] = this.inL[at + i] + g * (wL[i] - this.inL[at + i]);
      outR[at + i] = this.inR[at + i] + g * (wR[i] - this.inR[at + i]);
    }
    this.mix = Math.min(1, Math.max(0, this.mix + step * frames));
    if (this.mix === 0 || this.mix === 1) this.mixDir = 0;
  }

  band(band: EqBand, frames: number): void {
    if (band.moving) band.glide();
    if (band.idle()) band.clear();
    else if (band.fadeDir === 0 && band.fade === 1) this.run(band, frames);
    else {
      for (let i = 0; i < frames; i++) {
        this.dryL[i] = this.workL[i];
        this.dryR[i] = this.workR[i];
      }
      this.run(band, frames);
      mixFade(band, this.workL, this.dryL, frames);
      mixFade(band, this.workR, this.dryR, frames);
    }
    band.ramp = false;
    band.step(frames);
  }

  run(band: EqBand, frames: number): void {
    if (band.ramp) glideSections(band, this.workL, this.workR, frames);
    else runSections(band, this.workL, this.workR, frames);
  }

  /** The output gain, gliding per sample while it moves. */
  output(frames: number): void {
    const wL = this.workL;
    const wR = this.workR;
    if (!this.gainMoving) {
      if (this.gain === 1) return;
      for (let i = 0; i < frames; i++) {
        wL[i] *= this.gain;
        wR[i] *= this.gain;
      }
      return;
    }
    let g = this.gain;
    for (let i = 0; i < frames; i++) {
      g += this.gainStep * (this.gainTarget - g);
      wL[i] *= g;
      wR[i] *= g;
    }
    this.gain = g;
    if (Math.abs(this.gainTarget - g) <= D.settleGain) {
      this.gain = this.gainTarget;
      this.gainMoving = false;
    }
  }
}
