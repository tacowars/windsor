/**
 * bloom's per-band envelope (`BLOOM_ENVELOPE`): what each band plays, as a
 * level and a unit phase, and which bands play at all.
 *
 * At the defaults it follows instantly (`follow`): a
 * band sounds while the bands module lists it (selected, and not silent), its
 * level is the dynamics' `level[b]` times the selection gate, and its phase is
 * z/√(|z|² + eps²) (so |phase| < 1 at low level, which darkens the upper
 * partials). It leaves `level[b]`, `phaseRe[b]`/`phaseIm[b]` and the list
 * `sounding[0 … soundingCount)`, which the generator and the output read.
 *
 * The levers (`hold`, every band, run only while one is engaged or a band
 * still holds; `configure` once a block switches between the two):
 * - Swell (`SLOT_SWELL`, s): a one-pole attack on each band's level,
 *   90 % of the way in s seconds.
 * - Sustain (`SLOT_SUSTAIN`, s): a one-pole release, 60 dB in s seconds. A
 *   band whose input has left (`bloomEnvelopeMath.ts`'s `BloomPresence`) is
 *   held at its charge (its level, reached over `chargeSeconds` while the
 *   input was present), its phase turning by the band's last captured
 *   per-sample turn (the bands' smoothed z[n]·conj(z[n−1]), normalised), so
 *   the note keeps its pitch instead of drifting to the band's centre. When
 *   its input comes back (present, and selected) it crossfades to the
 *   input's phase over `relockSeconds`. A fleeting band (an onset passing
 *   through it) is held only `closingSeconds`. A held band is listed in
 *   `sounding` though it is not in the bands' `active`.
 * - Freeze (`SLOT_FREEZE`, 0/1): every sounding band is held and its level
 *   kept (release 1); the input to the envelope is gated off linearly over
 *   `freezeSeconds` and back on as it releases; a band it held then falls
 *   60 dB in max(Sustain, `freezeSeconds`) unless its input is back.
 *
 * With Swell and Sustain at 0 and Freeze off, `hold` gives `follow`'s values
 * to the bit, and once no band holds, `configure` returns to `follow`.
 *
 * No double crosses a call; every double field is born NaN; the coefficients
 * are computed in place, only when a control moves. Pinned by
 * `inserts/bloomEnvelope.test.ts`, `bloomDsp.test.ts` and `bloomGolden.test.ts`.
 */
import { BLOOM_BANDS } from '../../inserts/bloomBandsConstants';
import { BLOOM_ENVELOPE as C } from '../../inserts/bloomEnvelopeConstants';
import { cosine, sine } from '../../inserts/tapePortableMath';
import type { BloomBands } from './bloomBands';
import type { BloomDynamics } from './bloomDynamics';
import { BloomPresence } from './bloomEnvelopeMath';
import { exp2InPlace } from '../fm/portablePowers';
import { SLOT_FREEZE, SLOT_SUSTAIN, SLOT_SWELL } from './bloomSlots';

/** log2 10: a decade in octaves. */
const BLOOM_ENVELOPE_DECADE = Math.LN10 / Math.LN2;
/** The portable 2^x's reach; a coefficient beyond it is 0. */
const BLOOM_ENVELOPE_REACH = 64;

class BloomEnvelope {
  rate: number;
  slots: Float64Array;
  controls: Float64Array;
  bands: BloomBands;
  dynamics: BloomDynamics;
  level: Float64Array;
  phaseRe: Float64Array;
  phaseIm: Float64Array;
  sounding: Int32Array;
  soundingCount: number;
  /** True while `hold` runs: a lever is engaged or a band still holds. */
  engaged: boolean;
  /** The controls the coefficients were built from, and the coefficients (per-sample retention). */
  swell: number;
  sustain: number;
  attackKeep: number;
  releaseKeep: number;
  unfreezeKeep: number;
  /** Freeze: on (its slot), and its input gate's ramp 0 … 1 with its step. */
  freezing: boolean;
  freeze: number;
  freezeStep: number;
  lockStep: number;
  /** Bands holding, relocking or frozen after the last sample. */
  holding: number;
  /** Per band: this sample's input level (0 if not listed). */
  instant: Float64Array;
  /** Per band: the charge, the level Sustain and Freeze hold (`envelope`). */
  charge: Float64Array;
  chargeKeep: number;
  closingKeep: number;
  /** Per band: held by Freeze. */
  frozen: Uint8Array;
  /** Whether each band's input is present, the turn it had, and fleeting selections. */
  presence: BloomPresence;
  /** Per band: 1 follows the input's phase, 0 holds its own, between crossfades back. */
  lock: Float64Array;
  /** The held phase, its turn (unit) and 1/|held phase|². */
  heldRe: Float64Array;
  heldIm: Float64Array;
  turnRe: Float64Array;
  turnIm: Float64Array;
  heldInverse: Float64Array;
  /** Each band's centre as a per-sample turn: the held turn when none was ever captured. */
  centreRe: Float64Array;
  centreIm: Float64Array;
  scratch: Float64Array;

  constructor(
    rate: number,
    slots: Float64Array,
    controls: Float64Array,
    bands: BloomBands,
    dynamics: BloomDynamics,
  ) {
    this.rate = this.soundingCount = this.swell = this.sustain = NaN;
    this.attackKeep = this.releaseKeep = this.unfreezeKeep = NaN;
    this.freeze = this.freezeStep = this.lockStep = this.holding = this.chargeKeep = NaN;
    this.closingKeep = NaN;
    this.rate = rate;
    this.slots = slots;
    this.controls = controls;
    this.bands = bands;
    this.dynamics = dynamics;
    const n = BLOOM_BANDS.count;
    this.level = new Float64Array(n);
    this.phaseRe = new Float64Array(n);
    this.phaseIm = new Float64Array(n);
    this.sounding = new Int32Array(n);
    this.instant = new Float64Array(n);
    this.charge = new Float64Array(n);
    this.frozen = new Uint8Array(n);
    this.lock = new Float64Array(n);
    this.heldRe = new Float64Array(n);
    this.heldIm = new Float64Array(n);
    this.turnRe = new Float64Array(n);
    this.turnIm = new Float64Array(n);
    this.heldInverse = new Float64Array(n);
    this.centreRe = new Float64Array(n);
    this.centreIm = new Float64Array(n);
    this.scratch = new Float64Array(1);
    this.presence = new BloomPresence(bands, this.instant, this.level, this.lock);
    for (let b = 0; b < n; b++) {
      const w = (2 * Math.PI * bands.centre[b]) / rate;
      this.centreRe[b] = cosine(w);
      this.centreIm[b] = sine(w);
    }
    this.freezeStep = 1 / (C.freezeSeconds * rate);
    this.lockStep = 1 / (C.relockSeconds * rate);
    this.retention(C.freezeSeconds, C.sustainDecades);
    this.unfreezeKeep = this.scratch[0];
    this.retention(C.chargeSeconds, C.swellDecades);
    this.chargeKeep = this.scratch[0];
    this.retention(C.closingSeconds, C.sustainDecades);
    this.closingKeep = this.scratch[0];
    this.engaged = this.freezing = false;
    this.swell = this.sustain = 0;
    this.attackKeep = this.releaseKeep = 0;
    this.clear();
  }

  /** Into `scratch[0]`: the per-sample factor that falls `decades` in `seconds` (0 if beyond reach). */
  retention(seconds: number, decades: number): void {
    const octaves = (-decades * BLOOM_ENVELOPE_DECADE) / (seconds * this.rate);
    this.scratch[0] = octaves;
    if (octaves < -BLOOM_ENVELOPE_REACH) this.scratch[0] = 0;
    else exp2InPlace(this.scratch, 0);
  }

  /** Once a block: Swell's and Sustain's coefficients when they move, Freeze, and which path runs. */
  configure(): void {
    const controls = this.controls;
    if (controls[SLOT_SWELL] !== this.swell) {
      this.swell = controls[SLOT_SWELL];
      if (this.swell > 0) this.retention(this.swell, C.swellDecades);
      this.attackKeep = this.swell > 0 ? this.scratch[0] : 0;
    }
    if (controls[SLOT_SUSTAIN] !== this.sustain) {
      this.sustain = controls[SLOT_SUSTAIN];
      if (this.sustain > 0) this.retention(this.sustain, C.sustainDecades);
      this.releaseKeep = this.sustain > 0 ? this.scratch[0] : 0;
    }
    this.freezing = this.slots[SLOT_FREEZE] > 0;
    const levers = this.swell > 0 || this.sustain > 0 || this.freezing;
    if (!this.engaged && levers) this.engage();
    else if (this.engaged && !levers && this.freeze === 0 && this.holding === 0)
      this.engaged = false;
    if (this.engaged) this.presence.factors();
  }

  /** From `follow` to `hold`: every listed band follows, at its level; turns captured now. */
  engage(): void {
    const level = this.level;
    this.presence.seed(this.sounding, this.soundingCount);
    this.frozen.fill(0);
    this.lock.fill(1);
    for (let b = 0; b < BLOOM_BANDS.count; b++) this.instant[b] = level[b];
    level.fill(0);
    this.charge.fill(0);
    for (let i = 0; i < this.soundingCount; i++) {
      const b = this.sounding[i];
      level[b] = this.charge[b] = this.instant[b];
    }
    this.instant.fill(0);
    this.holding = 0;
    this.engaged = true;
  }

  clear(): void {
    this.level.fill(0);
    this.phaseRe.fill(0);
    this.phaseIm.fill(0);
    this.instant.fill(0);
    this.charge.fill(0);
    this.frozen.fill(0);
    this.lock.fill(1);
    this.presence.clear();
    this.soundingCount = 0;
    this.engaged = false;
    this.freeze = 0;
    this.holding = 0;
  }

  tick(): void {
    if (this.engaged) this.hold();
    else this.follow();
  }

  /** The defaults: each listed band's level and phase this sample, the instant follow. */
  follow(): void {
    const bands = this.bands,
      active = bands.active,
      count = bands.activeCount,
      limited = this.dynamics.level;
    for (let i = 0; i < count; i++) {
      const b = active[i];
      const inverse = 1 / bands.norm[b];
      this.level[b] = limited[b] * bands.gate[b];
      this.phaseRe[b] = bands.re[b] * inverse;
      this.phaseIm[b] = bands.im[b] * inverse;
      this.sounding[i] = b;
    }
    this.soundingCount = count;
  }

  /** The levers: every band's level and phase, held ones included. */
  hold(): void {
    const bands = this.bands,
      active = bands.active,
      limited = this.dynamics.level,
      instant = this.instant;
    if (this.freezing) this.freeze = Math.min(1, this.freeze + this.freezeStep);
    else if (this.freeze > 0) this.freeze = Math.max(0, this.freeze - this.freezeStep);
    instant.fill(0);
    for (let i = 0; i < bands.activeCount; i++) {
      const b = active[i];
      instant[b] = limited[b] * bands.gate[b];
    }
    let count = 0,
      holding = 0;
    for (let b = 0; b < BLOOM_BANDS.count; b++) {
      this.presence.track(b);
      this.mode(b);
      this.envelope(b);
      if (this.level[b] === 0) continue;
      this.phase(b);
      this.sounding[count++] = b;
      if (this.lock[b] < 1 || this.frozen[b] === 1) holding++;
    }
    this.soundingCount = count;
    this.holding = holding;
  }

  /** Band `b` follows its input, holds (from the phase it last played), or crossfades back. */
  mode(b: number): void {
    const listed = this.instant[b] > 0,
      keeps = this.sustain > 0 || this.frozen[b] === 1;
    // A held band comes back only to its own pitch: present, and selected for `relockRings` (not a leak).
    const presence = this.presence,
      back =
        presence.present[b] === 1 &&
        (this.lock[b] === 1 || presence.returning[b] >= presence.relockSpan[b]);
    const follows = listed && !this.freezing && (back || !keeps);
    if (follows) {
      if (this.lock[b] < 1) this.lock[b] = Math.min(1, this.lock[b] + this.lockStep);
      if (this.lock[b] === 1) this.frozen[b] = 0;
      return;
    }
    if (this.freezing && this.level[b] > 0 && this.frozen[b] === 0) {
      this.frozen[b] = 1;
      this.charge[b] = this.level[b];
    }
    // Only what the input charged is held; a band only ringing follows its ring-down, as at 0.
    if (this.lock[b] > 0 && this.level[b] > 0 && (keeps || this.freezing) && this.charge[b] > 0)
      this.release(b);
  }

  /** Band `b` starts holding: its phase as last played, turning by its captured turn. */
  release(b: number): void {
    const presence = this.presence;
    presence.release(b);
    let wr = presence.captureRe[b],
      wi = presence.captureIm[b];
    let w2 = wr * wr + wi * wi;
    if (!(w2 > 0)) {
      wr = presence.recentRe[b];
      wi = presence.recentIm[b];
      w2 = wr * wr + wi * wi;
    }
    // A relock cut short before anything was captured keeps the turn it held.
    if (w2 > 0 || this.lock[b] === 1) this.turn(b, wr, wi, w2);
    let ur = this.phaseRe[b],
      ui = this.phaseIm[b];
    if (!(ur * ur + ui * ui >= C.phaseFloor * C.phaseFloor)) {
      ur = C.phaseFloor;
      ui = 0;
    }
    this.heldRe[b] = ur;
    this.heldIm[b] = ui;
    this.heldInverse[b] = 1 / (ur * ur + ui * ui);
    this.lock[b] = 0;
    // What it held is what it played, so the hold starts where the level is.
    if (this.charge[b] < this.level[b]) this.charge[b] = this.level[b];
  }

  /** Band `b`'s held turn: (wr, wi) normalised, else the bands' turn now, else its centre. */
  turn(b: number, wr: number, wi: number, w2: number): void {
    if (!(w2 > 0)) {
      wr = this.bands.turnRe[b];
      wi = this.bands.turnIm[b];
      w2 = wr * wr + wi * wi;
    }
    if (!(w2 > 0)) {
      wr = this.centreRe[b];
      wi = this.centreIm[b];
      w2 = 1;
    }
    const unit = 1 / Math.sqrt(w2);
    this.turnRe[b] = wr * unit;
    this.turnIm[b] = wi * unit;
  }

  /**
   * Band `b`'s level. Its charge h rises towards the gated input x over
   * `chargeSeconds` while the input is present (not on the band's own
   * ring-down) and falls by Sustain (or Freeze), within `closingSeconds` if
   * the band is fleeting (`selection`) or outside Low…High; the level follows max(x, h), by
   * Swell's attack when that rises.
   */
  envelope(b: number): void {
    const x = this.instant[b] * (1 - this.freeze);
    // Outside Low…High (`bands.enabled`), nothing is held: a held or frozen band fades out.
    const off = this.bands.enabled[b] === 0;
    // A held band plays its own phase, so the input's level means nothing to it: it falls to 0.
    const held = this.lock[b] === 0,
      floor = held ? 0 : x;
    let h = this.charge[b];
    if (x > h && this.presence.present[b] === 1) h = x + this.chargeKeep * (h - x);
    else if (h >= floor && (off || !this.freezing || this.frozen[b] === 0)) {
      let keep = this.releaseKeep;
      if (this.frozen[b] === 1 && this.unfreezeKeep > keep) keep = this.unfreezeKeep;
      if ((off || this.presence.fleeting[b] === 1) && keep > this.closingKeep)
        keep = this.closingKeep;
      h = keep > 0 ? floor + keep * (h - floor) : floor;
    }
    const target = held || h > x ? h : x;
    const e = this.level[b];
    const next = this.swell > 0 && target > e ? target + this.attackKeep * (e - target) : target;
    if (this.lock[b] < 1 && next < C.levelFloor) {
      this.level[b] = this.charge[b] = 0;
      this.lock[b] = 1;
      this.frozen[b] = 0;
      return;
    }
    this.charge[b] = h;
    this.level[b] = next;
  }

  /** Band `b`'s phase: the input's, its own held one turning on, or a crossfade between them. */
  phase(b: number): void {
    const lock = this.lock[b];
    if (lock < 1) {
      const tr = this.turnRe[b],
        ti = this.turnIm[b];
      let ur = this.heldRe[b],
        ui = this.heldIm[b];
      const nr = ur * tr - ui * ti;
      ui = ur * ti + ui * tr;
      ur = nr;
      // One Newton step towards the held magnitude, so it never drifts.
      const k = 1 + (1 - (ur * ur + ui * ui) * this.heldInverse[b]) / 2;
      this.heldRe[b] = ur * k;
      this.heldIm[b] = ui * k;
      if (lock === 0) {
        this.phaseRe[b] = this.heldRe[b];
        this.phaseIm[b] = this.heldIm[b];
        return;
      }
    }
    const bands = this.bands;
    const inverse = 1 / bands.norm[b];
    const ir = bands.re[b] * inverse,
      ii = bands.im[b] * inverse;
    if (lock === 1) {
      this.phaseRe[b] = ir;
      this.phaseIm[b] = ii;
      return;
    }
    this.phaseRe[b] = this.heldRe[b] + lock * (ir - this.heldRe[b]);
    this.phaseIm[b] = this.heldIm[b] + lock * (ii - this.heldIm[b]);
  }
}

export { BloomEnvelope };
