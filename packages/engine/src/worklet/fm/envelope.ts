/**
 * The envelope (#644): Init -> attack -> Peak -> decay -> Sustain -> held ->
 * release -> End, a curve per segment, three loop modes, advanced at control
 * rate. Invariant: `curveShape` and this state machine are the one curve the
 * console draws with — `envelopeCurve.ts` mirrors them and
 * `envelopeCurve.test.ts` pins the two sample for sample (#620) until #656
 * shares the function. `patchLibraryEnvelope.test.ts` pins release completion.
 * The decay's time and curve are the envelope's own copies, which `configure`
 * takes from the parameter block and a step's offsets may then replace for
 * one note (windsor#17, `voiceStepMod.ts`).
 *
 * No double crosses a call on the envelope's path (windsor#233): V8 inlines a
 * call only where it judges it worth it, and a double passed to or returned
 * from one it does not inline is a new heap number on the audio thread
 * (`synth/fmProcessorAllocation.test.ts`). So `advance` leaves its result in
 * `value`, the curve is `writeSegmentLevel`, which reads a segment from the
 * envelope's fields and writes its level to `value`, and `segmentLevel`, the
 * console's form, runs that same function over a scratch segment. Every
 * double field is first written as NaN (rule 7). `envelope.test.ts` pins
 * `curveConstant` and `curveShape` as the curve's two steps.
 */

import type { Envelope as EnvelopeParams } from '../../patch/patch';
import { ENVELOPE_CURVE_STEEPNESS, MIN_SEG_TIME } from './fmConstants';
import { LOOP_LOOP, LOOP_TRIGGER } from './modeIds';

/* ------------------------------------------------------------------ *
 * Envelope
 *
 * Operator's shape: Init -> (attack) -> Peak -> (decay) -> Sustain -> held ->
 * (release) -> End, with a curve control per segment and three loop modes.
 * Advanced at control rate; the caller interpolates between control points.
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
  /** The running segment's target and curve control, for `writeSegmentLevel`. */
  segTarget: number;
  segCurve: number;
  p: EnvelopeParams | null;
  sr: number;
  timeScale: number;
  decayTime: number;
  decayCurve: number;

  constructor() {
    // Rule 7: each double field is born a double (NaN), before its start value.
    this.value = this.phase = this.segStart = this.segTarget = this.segCurve = NaN;
    this.timeScale = this.decayTime = this.decayCurve = NaN;
    this.state = ST_IDLE;
    this.value = 0;
    this.phase = 0;
    this.segStart = 0;
    this.segTarget = 0;
    this.segCurve = 0;
    this.p = null; // parameter block, owned by the voice's patch
    this.sr = 48000;
    this.timeScale = 1; // key tracking: >1 slower, <1 faster
    // The decay segment's, from `configure`; a step's offsets replace them per note (windsor#17).
    this.decayTime = 0;
    this.decayCurve = 0;
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

  /** Advance by `n` samples; the new value is `value`. */
  advance(n: number): void {
    const p = this.p!;
    if (this.state === ST_IDLE || this.state === ST_DONE) return;
    if (this.state === ST_SUSTAIN) {
      this.value = p.sustainLevel;
      return;
    }

    let time: number, target: number, curve: number;
    switch (this.state) {
      case ST_ATTACK:
        time = p.attackTime;
        target = p.peakLevel;
        curve = p.attackCurve;
        break;
      case ST_DECAY:
        time = this.decayTime;
        target = p.sustainLevel;
        curve = this.decayCurve;
        break;
      default:
        time = p.releaseTime;
        target = p.endLevel;
        curve = p.releaseCurve;
        break;
    }
    time *= this.timeScale;
    if (time < MIN_SEG_TIME) time = MIN_SEG_TIME;

    this.phase += n / (time * this.sr);

    if (this.phase >= 1) {
      this.value = target;
      this.phase = 0;
      this.segStart = target;
      switch (this.state) {
        case ST_ATTACK:
          this.state = ST_DECAY;
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
      return;
    }

    this.segTarget = target;
    this.segCurve = curve;
    writeSegmentLevel(this);
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
