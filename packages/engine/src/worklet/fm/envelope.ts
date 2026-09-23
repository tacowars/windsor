/* eslint-disable no-magic-numbers -- DSP: the curve's exponent scale and the state ids are the envelope's shape, not tunables; the tunables are fmConstants.ts (#654) */
/**
 * The envelope (#644): Init -> attack -> Peak -> decay -> Sustain -> held ->
 * release -> End, a curve per segment, three loop modes, advanced at control
 * rate. Invariant: `curveShape` and this state machine are the one curve the
 * console draws with — `envelopeCurve.ts` mirrors them and
 * `envelopeCurve.test.ts` pins the two sample for sample (#620) until #656
 * shares the function. `patchLibraryEnvelope.test.ts` pins release completion.
 */

import type { Envelope as EnvelopeParams } from '../../patch';
import { MIN_SEG_TIME } from './fmConstants';

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
const LOOP_NONE = 0,
  LOOP_LOOP = 1,
  LOOP_TRIGGER = 2;

/** Monotonic 0..1 curve. k == 1 is linear, k < 1 bows up, k > 1 bows down. */
function curveShape(p: number, k: number): number {
  return p / (p + (1 - p) * k);
}

class Envelope {
  state: number;
  value: number;
  phase: number;
  segStart: number;
  p: EnvelopeParams | null;
  sr: number;
  timeScale: number;

  constructor() {
    this.state = ST_IDLE;
    this.value = 0;
    this.phase = 0;
    this.segStart = 0;
    this.p = null; // parameter block, owned by the voice's patch
    this.sr = 48000;
    this.timeScale = 1; // key tracking: >1 slower, <1 faster
  }

  configure(params: EnvelopeParams, sampleRate: number): void {
    this.p = params;
    this.sr = sampleRate;
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

  /** Advance by `n` samples and return the new value. */
  advance(n: number): number {
    const p = this.p!;
    if (this.state === ST_IDLE || this.state === ST_DONE) return this.value;
    if (this.state === ST_SUSTAIN) {
      this.value = p.sustainLevel;
      return this.value;
    }

    let time: number, target: number, curve: number;
    switch (this.state) {
      case ST_ATTACK:
        time = p.attackTime;
        target = p.peakLevel;
        curve = p.attackCurve;
        break;
      case ST_DECAY:
        time = p.decayTime;
        target = p.sustainLevel;
        curve = p.decayCurve;
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
      return this.value;
    }

    const k = Math.exp(curve * 3);
    const s = k === 1 ? this.phase : curveShape(this.phase, k);
    this.value = this.segStart + (target - this.segStart) * s;
    return this.value;
  }
}

export {
  ST_IDLE,
  ST_ATTACK,
  ST_DECAY,
  ST_SUSTAIN,
  ST_RELEASE,
  ST_DONE,
  LOOP_NONE,
  LOOP_LOOP,
  LOOP_TRIGGER,
  curveShape,
  Envelope,
};
