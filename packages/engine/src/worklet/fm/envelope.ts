/**
 * The envelope (#644): Init -> attack -> Peak -> decay -> Sustain -> held ->
 * release -> End, a curve per segment, three loop modes, advanced at control
 * rate: `advance` for the filter and pitch envelopes, and `advanceExact` for
 * an operator's, whose segment ends keep their own samples (windsor#301).
 * Invariant: `curveShape` and this state machine are the one curve the
 * console draws with — `envelopeCurve.ts` mirrors them and
 * `envelopeCurve.test.ts` pins the two sample for sample (#620) until #656
 * shares the function. `patchLibraryEnvelope.test.ts` pins release completion.
 * The decay's time and curve are the envelope's own copies, which `configure`
 * takes from the parameter block and a step's offsets may then replace for
 * one note (windsor#17, `voiceStepMod.ts`). A song lane moves them on a
 * ringing voice (windsor#347, `voiceOffsets.ts`), each from the level the
 * envelope is at: a new time keeps the running decay's phase and so runs
 * what is left of it at the new rate, and a new curve starts what is left
 * again from the current level (`reshapeDecay`), over the time that was left,
 * which `decayLeft` carries. Neither moves the level, and with `decayLeft` at
 * 1 the decay is the one it always was, to the bit.
 *
 * No double crosses a call on the envelope's path (windsor#233): V8 inlines a
 * call only where it judges it worth it, and a double passed to or returned
 * from one it does not inline is a new heap number on the audio thread
 * (`synth/fmProcessorAllocation.test.ts`). So `advance` leaves its result in
 * `value`, the curve is `writeSegmentLevel`, which reads a segment from the
 * envelope's fields and writes its level to `value`, and `segmentLevel`, the
 * console's form, runs that same function over a scratch segment. Every
 * double field is first written as NaN (rule 7), and `advanceExact` keeps
 * its samples still to run in one (`rest`), never in a loop-carried local.
 * `envelope.test.ts` pins `curveConstant` and `curveShape` as the curve's two
 * steps, and `advanceExact`'s breaks, and its bits equal to `advance`'s while
 * no segment ends inside the step.
 */

import type { Envelope as EnvelopeParams } from '../../patch/patch';
import {
  ENVELOPE_BREAKS_MAX,
  ENVELOPE_CURVE_STEEPNESS,
  ENVELOPE_PASSES_MAX,
  MIN_SEG_TIME,
} from './fmConstants';
import { LOOP_LOOP, LOOP_TRIGGER } from './modeIds';

/* ------------------------------------------------------------------ *
 * Envelope
 *
 * Operator's shape: Init -> (attack) -> Peak -> (decay) -> Sustain -> held ->
 * (release) -> End, with a curve control per segment and three loop modes.
 * Advanced at control rate; the caller interpolates between control points,
 * and an operator's ramp passes through the breaks `advanceExact` records.
 * ------------------------------------------------------------------ */

const ST_IDLE = 0,
  ST_ATTACK = 1,
  ST_DECAY = 2,
  ST_SUSTAIN = 3,
  ST_RELEASE = 4,
  ST_DONE = 5;

/** Monotonic 0..1 curve. k == 1 is linear, k < 1 bows up, k > 1 bows down. */
function curveShape(p: number, k: number): number {
  return p / (p + (1 - p) * k);
}

/** A segment's curve control of ±1 maps to a shaping constant of `exp(±steepness)`; 0 is linear. */
function curveConstant(curve: number): number {
  return Math.exp(curve * ENVELOPE_CURVE_STEEPNESS);
}

/** A segment in progress: its ends, how far along it is, its curve control, and the level there. */
interface Segment {
  segStart: number;
  segTarget: number;
  phase: number;
  segCurve: number;
  value: number;
}

/**
 * `value` becomes the level `phase` of the way from `segStart` to
 * `segTarget` under `segCurve` — the one envelope curve (#620, #656):
 * `Envelope.advance` runs it over the envelope and the console's display
 * draws with it through `segmentLevel`, so the two cannot disagree. It is
 * `curveConstant`, then `curveShape` unless the constant is 1, written out,
 * so no double crosses a call (windsor#233).
 */
function writeSegmentLevel(seg: Segment): void {
  const k = Math.exp(seg.segCurve * ENVELOPE_CURVE_STEEPNESS);
  const phase = seg.phase;
  const s = k === 1 ? phase : phase / (phase + (1 - phase) * k);
  seg.value = seg.segStart + (seg.segTarget - seg.segStart) * s;
}

/** The scratch segment `segmentLevel` runs the curve over: the console's, never the audio thread's. */
const SCRATCH_SEGMENT: Segment = {
  segStart: NaN,
  segTarget: NaN,
  phase: NaN,
  segCurve: NaN,
  value: NaN,
};

/** The level `phase` of the way from `from` to `to` under `curve`: `writeSegmentLevel`, for the console. */
function segmentLevel(from: number, to: number, phase: number, curve: number): number {
  const seg = SCRATCH_SEGMENT;
  seg.segStart = from;
  seg.segTarget = to;
  seg.phase = phase;
  seg.segCurve = curve;
  writeSegmentLevel(seg);
  return seg.value;
}

class Envelope {
  state: number;
  value: number;
  phase: number;
  segStart: number;
  /** The running segment's time, target and curve control, for `writeSegmentLevel`. */
  segTime: number;
  segTarget: number;
  segCurve: number;
  p: EnvelopeParams | null;
  sr: number;
  timeScale: number;
  decayTime: number;
  decayCurve: number;
  /**
   * The share of `decayTime` the running decay segment spans: 1 from its
   * start, and what was left of it each time `reshapeDecay` started it again
   * from its current level (windsor#347).
   */
  decayLeft: number;
  /** `advanceExact`'s samples still to run, and its segment ends in its last step (windsor#301): how many, where and at what level. */
  rest: number;
  breaks: number;
  breakAt: Float64Array;
  breakLevel: Float64Array;

  constructor() {
    // Rule 7: each double field is born a double (NaN), before its start value.
    this.value = this.phase = this.segStart = this.segTarget = this.segCurve = this.segTime = NaN;
    this.timeScale = this.decayTime = this.decayCurve = this.decayLeft = this.rest = NaN;
    this.state = ST_IDLE;
    this.value = 0;
    this.phase = 0;
    this.segStart = 0;
    this.segTarget = 0;
    this.segCurve = 0;
    this.segTime = 0;
    this.p = null; // parameter block, owned by the voice's patch
    this.sr = 48000;
    this.timeScale = 1; // key tracking: >1 slower, <1 faster
    // The decay segment's, from `configure`; a step's offsets replace them per note (windsor#17).
    this.decayTime = 0;
    this.decayCurve = 0;
    this.decayLeft = 1;
    this.rest = 0;
    this.breaks = 0;
    this.breakAt = new Float64Array(ENVELOPE_BREAKS_MAX);
    this.breakLevel = new Float64Array(ENVELOPE_BREAKS_MAX);
  }

  configure(params: EnvelopeParams, sampleRate: number): void {
    this.p = params;
    this.sr = sampleRate;
    this.decayTime = params.decayTime;
    this.decayCurve = params.decayCurve;
  }

  noteOn(): void {
    const p = this.p!;
    this.state = ST_ATTACK;
    this.phase = 0;
    this.value = p.initLevel;
    this.segStart = p.initLevel;
    this.decayLeft = 1;
  }

  noteOff(): void {
    if (this.state === ST_DONE || this.state === ST_IDLE) return;
    if (this.p!.loopMode === LOOP_TRIGGER) return; // runs its full course
    this.state = ST_RELEASE;
    this.phase = 0;
    this.segStart = this.value;
  }

  /** True once the envelope has finished releasing. */
  get finished(): boolean {
    return this.state === ST_DONE || this.state === ST_IDLE;
  }

  /**
   * Advance by `n` samples at control rate; the new value is `value`. A
   * segment that ends inside the `n` lands on its target at the end of them
   * and the next starts there, so a segment shorter than the step takes the
   * whole step: the filter's and the pitch envelope's timing, which
   * windsor#301 leaves at control rate.
   */
  advance(n: number): void {
    if (this.state === ST_IDLE || this.state === ST_DONE) return;
    if (this.state === ST_SUSTAIN) {
      this.value = this.p!.sustainLevel;
      return;
    }
    this.loadSegment();
    let time = this.segTime * this.timeScale;
    if (time < MIN_SEG_TIME) time = MIN_SEG_TIME;

    this.phase += n / (time * this.sr);

    if (this.phase >= 1) {
      this.endSegment();
      return;
    }
    writeSegmentLevel(this);
  }

  /**
   * Advance by `n` samples with every segment end at its own sample
   * (windsor#301): an operator's amplitude envelope. A segment that ends
   * inside the `n` hands what is left of them to the next, and each end is
   * recorded as a break: `breakAt` its offset in samples from the start of
   * the `n`, `breakLevel` the level it lands on, `breaks` how many (at most
   * ENVELOPE_BREAKS_MAX; a later end is still timed). A segment time of 0
   * ends on the sample it starts on. With no end inside the `n` this is
   * `advance`'s arithmetic for a segment past MIN_SEG_TIME, to the bit: one
   * phase step of `n / (time * sr)`, then the curve.
   */
  advanceExact(n: number): void {
    this.breaks = 0;
    // The samples still to run, a field: a loop-carried local born of the
    // integer `n` was a tagged phi, and each pass boxed it (windsor#233).
    this.rest = n;
    for (let pass = 0; pass < ENVELOPE_PASSES_MAX; pass++) {
      if (this.state === ST_IDLE || this.state === ST_DONE) return;
      if (this.state === ST_SUSTAIN) {
        this.value = this.p!.sustainLevel;
        return;
      }
      this.loadSegment();
      let time = this.segTime * this.timeScale;
      if (!(time > 0)) time = 0;
      const span = time * this.sr;
      const phase = this.phase + this.rest / span;
      if (phase < 1) {
        this.phase = phase;
        writeSegmentLevel(this);
        return;
      }
      // The segment ends `(1 - phase) * span` samples into what is left.
      this.rest -= (1 - this.phase) * span;
      if (this.rest < 0) this.rest = 0;
      const b = this.breaks;
      if (b < ENVELOPE_BREAKS_MAX) {
        this.breakAt[b] = n - this.rest;
        this.breakLevel[b] = this.segTarget;
        this.breaks = b + 1;
      }
      this.endSegment();
      if (this.rest === 0) return;
    }
  }

  /**
   * `decayCurve` has just changed (windsor#347): a decay segment under way
   * under another curve starts again from the level it is at, toward the
   * same sustain, under the new curve and over the time it had left, so the
   * level does not move and the segment still ends when it would have. A
   * decay not yet begun (attack, or phase 0) takes the curve when it runs,
   * and sustain and release do not read it. The caller writes the new curve
   * to `decayCurve` first, so no double crosses the call.
   */
  reshapeDecay(): void {
    if (this.state !== ST_DECAY || !(this.phase > 0)) return;
    if (this.decayCurve === this.segCurve) return;
    this.decayLeft *= 1 - this.phase;
    this.segStart = this.value;
    this.phase = 0;
    this.segCurve = this.decayCurve;
  }

  /** The running segment's time (before key scaling), target and curve, into their fields. */
  loadSegment(): void {
    const p = this.p!;
    switch (this.state) {
      case ST_ATTACK:
        this.segTime = p.attackTime;
        this.segTarget = p.peakLevel;
        this.segCurve = p.attackCurve;
        break;
      case ST_DECAY:
        // `decayLeft` is 1 unless a lane reshaped the segment (windsor#347): × 1 is exact.
        this.segTime = this.decayTime * this.decayLeft;
        this.segTarget = p.sustainLevel;
        this.segCurve = this.decayCurve;
        break;
      default:
        this.segTime = p.releaseTime;
        this.segTarget = p.endLevel;
        this.segCurve = p.releaseCurve;
        break;
    }
  }

  /** The running segment has reached its target: land there and take the next stage. */
  endSegment(): void {
    const p = this.p!;
    const target = this.segTarget;
    this.value = target;
    this.phase = 0;
    this.segStart = target;
    switch (this.state) {
      case ST_ATTACK:
        this.state = ST_DECAY;
        this.decayLeft = 1;
        break;
      case ST_DECAY:
        if (p.loopMode === LOOP_LOOP) {
          this.state = ST_ATTACK;
          this.segStart = this.value;
        } else if (p.loopMode === LOOP_TRIGGER) {
          this.state = ST_RELEASE;
        } else this.state = ST_SUSTAIN;
        break;
      default:
        this.state = ST_DONE;
        break;
    }
  }
}

export {
  ST_IDLE,
  ST_ATTACK,
  ST_DECAY,
  ST_SUSTAIN,
  ST_RELEASE,
  ST_DONE,
  curveShape,
  curveConstant,
  segmentLevel,
  Envelope,
};
