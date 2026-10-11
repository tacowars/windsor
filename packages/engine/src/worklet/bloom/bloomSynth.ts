/**
 * bloom's synthesis at the host rate: the generator's bands (analysis rate)
 * played at every host sample from the band-limited tables
 * (`bloomTables.ts`), darkened, and summed through Spread's pan into
 * `left`/`right`, one segment of `factor` samples at a time.
 *
 * Each analysis step leaves, per sounding band, a target: its level (the
 * envelope's × the generator's retune dip × the darkening radius |w| × its
 * Shape and Bright level `bandGain`) and its phase arg w (the pitch stage's).
 * Over the next segment the band goes from where it was to that target:
 *
 * - the level linearly;
 * - the phase θ (in turns) by one increment a sample, so its frequency is
 *   uniform within the step. The increment is the step's turn, arg w − θ,
 *   taken to the whole number of cycles nearest the band's own (its centre
 *   × ratio, `centreStep`), over `factor`; the phase then lands on arg w.
 *
 * The waveform is the Shape mix, gain A × table A(θ) + gain B × table B(θ +
 * offset) (`bloomGeneratorMath.ts`), at the band's partial count. The
 * darkening (`BLOOM_GENERATOR` corner*) is a one-pole on each band,
 * y = c·(x + b·x₁) + a·y₁ (`bloomSynthMath.ts`), its corner set each step
 * from the band's amplitude before the ceiling (the envelope's level over the
 * ceiling's `room`) and its fundamental, and its gain made 1 at the
 * fundamental, so the level law is the fundamental's and the corner shapes
 * only the partials above it.
 *
 * A band starting to sound starts one step back along its own frequency at
 * level 0, its filter at rest; a band that stops ramps to 0 at its own
 * frequency and is dropped. So the layer is late by one segment, `factor`
 * host samples (`segmentHz`, 0.17 ms at 48 kHz), on top of the bands'
 * group delay. (`factor` here is the segment, whole analysis steps.)
 *
 * No transcendental `Math`; no double crosses a call; every double field is
 * born NaN. Pinned by `inserts/bloomDsp.test.ts`, `bloomAllocation.test.ts`
 * and `bloomGolden.test.ts`.
 */
import { BLOOM_BANDS } from '../../inserts/bloomBandsConstants';
import { BLOOM_GENERATOR as G } from '../../inserts/bloomGeneratorConstants';
import { bloomSinVersineInPlace } from './bloomBandsMath';
import type { BloomDynamics } from './bloomDynamics';
import type { BloomEnvelope } from './bloomEnvelope';
import type { BloomGenerator } from './bloomGenerator';
import { MIX_GAIN_A, MIX_GAIN_B, MIX_OFFSET, MIX_SAW, MIX_SINE } from './bloomGeneratorMath';
import type { BloomOutput } from './bloomOutput';
import { bloomDarkeningInPlace, bloomTurnInPlace } from './bloomSynthMath';
import type { BloomTableSet } from './bloomTables';

/** `step`'s slots: the turn's (x, y) and result; the darkening's fp, fs, cos ω₀ → a, b, c, g. */
const STEP_TURN = 0;
/** tan(½ the step's turn off the band's own frequency) up to which the turn is atan's short series. */
const BLOOM_SYNTH_SMALL_TURN = 0.2;
const BLOOM_SYNTH_ATAN_TERMS = 6;
const STEP_CORNER = 2;
const STEP_RATE = 3;
const STEP_COS = 4;
const STEP_SIN = 5;
const STEP_POLE = 2;
const STEP_ZERO = 3;
const STEP_SCALE = 4;
const STEP_GAIN = 5;
const STEP_LEAD = 6;
const STEP_SLOTS = 8;

class BloomSynth {
  rate: number;
  factor: number;
  envelope: BloomEnvelope;
  dynamics: BloomDynamics;
  generator: BloomGenerator;
  output: BloomOutput;
  tables: BloomTableSet;
  /** Each band's centre in Hz. */
  centre: Float64Array;
  /** Per band at its ratio: its own frequency in turns a host sample, cos of it in radians, and e^{−i·2π·factor·own}. */
  centreStep: Float64Array;
  centreCos: Float64Array;
  centreSin: Float64Array;
  backRe: Float64Array;
  backIm: Float64Array;
  /** atan's series terms, for the step's small turn. */
  atan: Float64Array;
  /** The pitch stage's retune count `centreStep` was built for. */
  tuning: number;
  /** Per band, where the last segment left it: phase in turns and as a unit vector, level; whether it sounded. */
  phase: Float64Array;
  unitRe: Float64Array;
  unitIm: Float64Array;
  amp: Float64Array;
  live: Uint8Array;
  liveList: Int32Array;
  liveCount: number;
  /** Per band: the darkening's coefficients and state. */
  pole: Float64Array;
  zero: Float64Array;
  scale: Float64Array;
  /** Per band: the darkening's gain at the fundamental and its lag there (turns), as last set; where the table read left off (phase + lag). */
  fundamental: Float64Array;
  lead: Float64Array;
  /** Per band: the corner the darkening was last set for (`cornerTolerance`). */
  corner: Float64Array;
  read: Float64Array;
  heldIn: Float64Array;
  heldOut: Float64Array;
  /** This segment's bands (sounding first, then those fading out) and its stamp. */
  list: Int32Array;
  stamp: Int32Array;
  clock: number;
  /** The segment: one sum per host sample, each side. */
  left: Float64Array;
  right: Float64Array;
  step: Float64Array;

  constructor(
    rate: number,
    factor: number,
    envelope: BloomEnvelope,
    generator: BloomGenerator,
    output: BloomOutput,
  ) {
    this.rate = rate;
    this.factor = factor;
    this.envelope = envelope;
    this.dynamics = envelope.dynamics;
    this.generator = generator;
    this.output = output;
    this.tables = generator.tables;
    const n = BLOOM_BANDS.count;
    this.centre = envelope.bands.centre;
    this.centreStep = new Float64Array(n);
    this.centreCos = new Float64Array(n);
    this.centreSin = new Float64Array(n);
    this.backRe = new Float64Array(n);
    this.backIm = new Float64Array(n);
    this.atan = new Float64Array(BLOOM_SYNTH_ATAN_TERMS);
    for (let j = 0; j < BLOOM_SYNTH_ATAN_TERMS; j++)
      this.atan[j] = (j % 2 === 0 ? 1 : -1) / (2 * j + 1);
    this.phase = new Float64Array(n);
    this.unitRe = new Float64Array(n);
    this.unitIm = new Float64Array(n);
    this.amp = new Float64Array(n);
    this.live = new Uint8Array(n);
    this.liveList = new Int32Array(n);
    this.pole = new Float64Array(n);
    this.zero = new Float64Array(n);
    this.scale = new Float64Array(n);
    this.fundamental = new Float64Array(n);
    this.lead = new Float64Array(n);
    this.corner = new Float64Array(n);
    this.read = new Float64Array(n);
    this.heldIn = new Float64Array(n);
    this.heldOut = new Float64Array(n);
    this.list = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.left = new Float64Array(factor);
    this.right = new Float64Array(factor);
    this.step = new Float64Array(STEP_SLOTS);
    this.liveCount = this.clock = 0;
    this.tuning = -1;
    this.clear();
  }

  /** Every band's own frequency at its ratio; every band starts afresh. */
  retune(): void {
    const pitch = this.generator.pitch,
      step = this.step;
    this.tuning = pitch.tuning;
    for (let b = 0; b < BLOOM_BANDS.count; b++) {
      const turns = (this.centre[b] * pitch.ratio[b]) / this.rate;
      this.centreStep[b] = turns;
      step[0] = 2 * Math.PI * turns;
      bloomSinVersineInPlace(step, 0);
      this.centreCos[b] = 1 - step[1];
      this.centreSin[b] = step[0];
      step[0] = -(2 * Math.PI * this.factor * turns);
      bloomSinVersineInPlace(step, 0);
      this.backRe[b] = 1 - step[1];
      this.backIm[b] = step[0];
    }
    this.drop();
  }

  /** Every band silent, starting afresh when it next sounds. */
  drop(): void {
    this.live.fill(0);
    this.amp.fill(0);
    this.heldIn.fill(0);
    this.heldOut.fill(0);
    this.liveCount = 0;
  }

  clear(): void {
    this.drop();
    this.phase.fill(0);
    this.unitRe.fill(0);
    this.unitIm.fill(0);
    this.fundamental.fill(0);
    this.lead.fill(0);
    this.corner.fill(0);
    this.read.fill(0);
    this.pole.fill(0);
    this.zero.fill(0);
    this.scale.fill(0);
    this.left.fill(0);
    this.right.fill(0);
  }

  /** The next segment from the last analysis step's targets, into `left`/`right`. */
  render(): void {
    if (this.generator.pitch.tuning !== this.tuning) this.retune();
    this.left.fill(0);
    this.right.fill(0);
    const envelope = this.envelope,
      sounding = envelope.sounding,
      count = envelope.soundingCount,
      list = this.list,
      stamp = this.stamp,
      liveList = this.liveList;
    const clock = (this.clock = (this.clock + 1) | 0);
    let n = 0;
    for (let i = 0; i < count; i++) {
      const b = sounding[i];
      stamp[b] = clock;
      list[n++] = b;
    }
    for (let i = 0; i < this.liveCount; i++) {
      const b = liveList[i];
      if (stamp[b] !== clock) list[n++] = b;
    }
    for (let i = 0; i < n; i++) this.band(list[i], i < count);
    for (let i = 0; i < count; i++) liveList[i] = list[i];
    this.liveCount = count | 0;
    if (this.output.spread === 0) this.right.set(this.left);
  }

  /** Band `b`'s darkening from its amplitude before the ceiling, kept while live within `cornerTolerance`. */
  darken(b: number): void {
    const step = this.step,
      level = this.envelope.level[b] / this.dynamics.room[b];
    const f0 = this.centreStep[b] * this.rate;
    const swell = level / G.cornerSwell;
    const broad = G.cornerScaleHz * Math.sqrt(level * (level + G.cornerKnee)) * (1 + swell * swell),
      note = G.cornerNoteShare * f0;
    let corner = Math.sqrt(broad * broad + note * note);
    const top =
      G.cornerShare * this.rate < G.cornerMaxHz ? G.cornerShare * this.rate : G.cornerMaxHz;
    if (corner > top) corner = top;
    if (!(corner >= 1)) corner = 1;
    const moved = corner - this.corner[b],
      room = G.cornerTolerance * this.corner[b];
    if (this.live[b] !== 0 && moved <= room && moved >= -room) return;
    this.corner[b] = corner;
    step[STEP_CORNER] = corner;
    step[STEP_RATE] = this.rate;
    step[STEP_COS] = this.centreCos[b];
    step[STEP_SIN] = this.centreSin[b];
    bloomDarkeningInPlace(step, STEP_CORNER);
    this.pole[b] = step[STEP_POLE];
    this.zero[b] = step[STEP_ZERO];
    this.scale[b] = step[STEP_SCALE];
    this.fundamental[b] = step[STEP_GAIN];
    this.lead[b] = step[STEP_LEAD];
  }

  /**
   * Band `b`'s phase at this step's target, unit vector (ur, ui) in `step`'s
   * turn slots, into `step[STEP_TURN]`: one step on from where it landed
   * (`phase`), at its own frequency plus the step's turn off it, taken
   * against the last target's unit vector. Past a small turn (a phase jump
   * at a beat's null), and for a band starting, the angle itself.
   */
  aim(b: number): void {
    const step = this.step,
      ur = step[STEP_TURN],
      ui = step[STEP_TURN + 1];
    if (this.live[b] === 0) {
      bloomTurnInPlace(step, STEP_TURN);
    } else {
      // t = u·conj(p)·e^{−i·2π·factor·own}: the turn off the band's own frequency.
      const pr = this.unitRe[b],
        pi = this.unitIm[b],
        br = this.backRe[b],
        bi = this.backIm[b];
      const dr = ur * pr + ui * pi,
        di = ui * pr - ur * pi;
      const tr = dr * br - di * bi,
        ti = dr * bi + di * br;
      const x = ti / (1 + tr);
      let turn: number;
      if (x <= BLOOM_SYNTH_SMALL_TURN && x >= -BLOOM_SYNTH_SMALL_TURN) {
        // 2·atan x, the turn in radians, by the series.
        const x2 = x * x,
          atan = this.atan;
        let sum = atan[BLOOM_SYNTH_ATAN_TERMS - 1];
        for (let j = BLOOM_SYNTH_ATAN_TERMS - 2; j >= 0; j--) sum = sum * x2 + atan[j];
        turn = (x * sum) / Math.PI;
      } else {
        step[STEP_TURN] = tr;
        step[STEP_TURN + 1] = ti;
        bloomTurnInPlace(step, STEP_TURN);
        turn = step[STEP_TURN];
        if (turn > 1 / 2) turn -= 1;
      }
      let landing = this.phase[b] + this.factor * this.centreStep[b] + turn;
      landing -= Math.floor(landing);
      step[STEP_TURN] = landing;
    }
    this.unitRe[b] = ur;
    this.unitIm[b] = ui;
  }

  /** Band `b` over the segment: towards its target if `on`, else down to 0 and dropped. */
  // eslint-disable-next-line max-lines-per-function -- one hot loop, its state in locals
  band(b: number, on: boolean): void {
    const factor = this.factor,
      generator = this.generator,
      pitch = generator.pitch,
      step = this.step,
      own = this.centreStep[b];
    let theta = this.read[b],
      amp = this.amp[b],
      target = 0,
      landing = 0,
      increment = own;
    if (on) {
      const wr = pitch.waveRe[b],
        wi = pitch.waveIm[b];
      const radius = Math.sqrt(wr * wr + wi * wi);
      const inverse = radius > 0 ? 1 / radius : 0;
      step[STEP_TURN] = radius > 0 ? wr * inverse : 1;
      step[STEP_TURN + 1] = wi * inverse;
      this.aim(b);
      landing = step[STEP_TURN];
      this.darken(b);
      // The table is read ahead by the darkening's lag at the fundamental.
      let ahead = landing + this.lead[b];
      if (ahead >= 1) ahead -= 1;
      target =
        this.envelope.level[b] *
        generator.gain *
        radius *
        generator.bandGain[b] *
        this.fundamental[b];
      if (this.live[b] === 0) {
        theta = ahead - factor * own;
        theta -= Math.floor(theta);
        amp = 0;
        this.heldIn[b] = this.heldOut[b] = 0;
      }
      // The step's turn, to the whole cycles nearest the band's own frequency.
      const turn = ahead - theta,
        cycles = Math.round(factor * own - turn);
      increment = (turn + cycles) / factor;
      landing = ahead;
    }
    const count = generator.partials[b];
    if (count > 0 && (amp !== 0 || target !== 0)) {
      const tables = this.tables,
        level = tables.levelOf[count < tables.maxPartials ? count : tables.maxPartials],
        mix = generator.mix,
        gainA = mix[MIX_GAIN_A],
        gainB = mix[MIX_GAIN_B],
        offset = mix[MIX_OFFSET];
      const tableA =
        generator.familyA === MIX_SAW
          ? tables.saw[level]
          : generator.familyA === MIX_SINE
            ? tables.triangle[0]
            : tables.triangle[level];
      const tableB = generator.familyB === MIX_SAW ? tables.saw[level] : tables.triangle[level];
      const sizeA = tableA.length - 1,
        sizeB = tableB.length - 1;
      const pole = this.pole[b],
        zero = this.zero[b],
        scale = this.scale[b],
        slope = (target - amp) / factor;
      let heldIn = this.heldIn[b],
        heldOut = this.heldOut[b];
      const left = this.left,
        right = this.right,
        mono = this.output.spread === 0,
        panLeft = this.output.panLeft[b],
        panRight = this.output.panRight[b];
      for (let s = 0; s < factor; s++) {
        theta += increment;
        if (theta >= 1) theta -= 1;
        else if (theta < 0) theta += 1;
        let at = theta * sizeA;
        let i = at | 0,
          frac = at - i;
        let v = gainA * (tableA[i] + frac * (tableA[i + 1] - tableA[i]));
        if (gainB !== 0) {
          let shifted = theta + offset;
          if (shifted >= 1) shifted -= 1;
          at = shifted * sizeB;
          i = at | 0;
          frac = at - i;
          v += gainB * (tableB[i] + frac * (tableB[i + 1] - tableB[i]));
        }
        amp += slope;
        const x = amp * v;
        const y = scale * (x + zero * heldIn) + pole * heldOut;
        heldIn = x;
        heldOut = y;
        if (mono) left[s] += y;
        else {
          left[s] += panLeft * y;
          right[s] += panRight * y;
        }
      }
      this.heldIn[b] = on ? heldIn : 0;
      this.heldOut[b] = on ? heldOut : 0;
    } else {
      theta += factor * increment;
      theta -= Math.floor(theta);
    }
    // It lands on its target; the next step's turn is taken from there.
    if (on) this.phase[b] = step[STEP_TURN];
    this.read[b] = on ? landing : theta;
    this.amp[b] = target;
    this.live[b] = on ? 1 : 0;
  }
}

export { BloomSynth };
