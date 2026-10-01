import { describe, expect, it } from 'vitest';

import type { Envelope as EnvelopeParams } from '../../patch/patch';
import {
  curveConstant,
  curveShape,
  Envelope,
  ST_ATTACK,
  ST_DECAY,
  ST_DONE,
  ST_IDLE,
  ST_RELEASE,
  ST_SUSTAIN,
  segmentLevel,
} from './envelope';
import { ENVELOPE_BREAKS_MAX, ENVELOPE_PASSES_MAX, MIN_SEG_TIME } from './fmConstants';
import { LOOP_LOOP, LOOP_NONE, LOOP_TRIGGER } from './modeIds';

const SR = 48000;
/** Times that are exact binary fractions, so a segment ends on the sample it is meant to. */
const params = (o: Partial<EnvelopeParams> = {}): EnvelopeParams => ({
  initLevel: 0,
  attackTime: 0.5,
  attackCurve: 0,
  peakLevel: 1,
  decayTime: 0.25,
  decayCurve: 0,
  sustainLevel: 0.5,
  releaseTime: 0.125,
  releaseCurve: 0,
  endLevel: 0,
  loopMode: LOOP_NONE,
  keyScale: 0,
  ...o,
});
function make(o?: Partial<EnvelopeParams>): Envelope {
  const e = new Envelope();
  e.configure(params(o), SR);
  return e;
}

/** Advance `e` by `n` samples and read its value, which `advance` leaves in `value` (windsor#233). */
function advanced(e: Envelope, n: number): number {
  e.advance(n);
  return e.value;
}

describe('the envelope', () => {
  it('walks attack, decay, sustain, release and done at the configured times', () => {
    const e = make();
    expect(e.state).toBe(ST_IDLE);
    e.noteOn();
    expect(e.state).toBe(ST_ATTACK);
    expect(advanced(e, 0.5 * SR)).toBe(1);
    expect(e.state).toBe(ST_DECAY);
    expect(advanced(e, 0.25 * SR)).toBe(0.5);
    expect(e.state).toBe(ST_SUSTAIN);
    expect(advanced(e, 1000)).toBe(0.5);
    e.noteOff();
    expect(e.state).toBe(ST_RELEASE);
    expect(advanced(e, 0.125 * SR)).toBe(0);
    expect(e.state).toBe(ST_DONE);
    expect(e.finished).toBe(true);
  });

  it('floors a segment at MIN_SEG_TIME and scales it by timeScale', () => {
    const e = make({ attackTime: 0 });
    e.noteOn();
    expect(advanced(e, MIN_SEG_TIME * SR)).toBe(1);
    const slow = make();
    slow.timeScale = 2;
    slow.noteOn();
    slow.advance(0.5 * SR);
    expect(slow.state).toBe(ST_ATTACK);
    expect(slow.value).toBeCloseTo(0.5, 6);
  });

  it('times an attack of 0 as an end at the first sample, and runs the decay from there (windsor#301)', () => {
    const e = make({ attackTime: 0, decayTime: 64 / SR });
    e.noteOn();
    e.advanceExact(32);
    expect(e.breaks).toBe(1);
    expect(e.breakAt[0]).toBe(0);
    expect(e.breakLevel[0]).toBe(1);
    expect(e.state).toBe(ST_DECAY);
    // Half the 64-sample decay from 1 to 0.5.
    expect(e.value).toBeCloseTo(0.75, 12);
  });

  it('ends a 0.1 ms attack 4.8 samples in, and a decay that ends inside a later step on its own sample', () => {
    const e = make({ attackTime: 0.0001, decayTime: 40 / SR });
    e.noteOn();
    e.advanceExact(32);
    expect(e.breaks).toBe(1);
    expect(e.breakAt[0]).toBeCloseTo(4.8, 9);
    e.advanceExact(32);
    // The decay began at 4.8 and lasts 40 samples: it ends 12.8 into the second step.
    expect(e.breaks).toBe(1);
    expect(e.breakAt[0]).toBeCloseTo(12.8, 9);
    expect(e.breakLevel[0]).toBe(0.5);
    expect(e.state).toBe(ST_SUSTAIN);
    expect(e.value).toBe(0.5);
  });

  it('records each end when several fall inside one step, and lands on the last', () => {
    const e = make({ attackTime: 6 / SR, decayTime: 10 / SR, releaseTime: 8 / SR });
    e.noteOn();
    e.advanceExact(32);
    expect(e.breaks).toBe(2);
    expect(e.breakAt[0]).toBeCloseTo(6, 9);
    expect(e.breakAt[1]).toBeCloseTo(16, 9);
    expect([e.breakLevel[0], e.breakLevel[1]]).toEqual([1, 0.5]);
    e.noteOff();
    e.advanceExact(32);
    expect(e.breaks).toBe(1);
    expect(e.breakAt[0]).toBeCloseTo(8, 9);
    expect(e.state).toBe(ST_DONE);
    expect(e.value).toBe(0);
  });

  it('is `advance` to the bit while no segment ends inside the step', () => {
    const exact = make({ attackTime: 0.25, attackCurve: 0.4 });
    const block = make({ attackTime: 0.25, attackCurve: 0.4 });
    exact.noteOn();
    block.noteOn();
    // 0.25 s is 375 steps of 32: every step before the last ends nowhere inside.
    for (let k = 0; k < 374; k++) {
      exact.advanceExact(32);
      block.advance(32);
      expect(exact.breaks).toBe(0);
      expect(exact.value).toBe(block.value);
      expect(exact.phase).toBe(block.phase);
    }
  });

  it('carries a segment end into the next segment, where `advance` starts it at the next step', () => {
    const exact = make({ attackTime: 40 / SR, decayTime: 40 / SR });
    const block = make({ attackTime: 40 / SR, decayTime: 40 / SR });
    exact.noteOn();
    block.noteOn();
    for (let k = 0; k < 3; k++) {
      exact.advanceExact(32);
      block.advance(32);
    }
    // 96 samples: the exact envelope ended its decay at 80; the other is 32 into it.
    expect(exact.state).toBe(ST_SUSTAIN);
    expect(block.state).toBe(ST_DECAY);
  });

  it('stops a looping envelope whose segments are all 0 after its passes, with at most its breaks', () => {
    const e = make({ attackTime: 0, decayTime: 0, loopMode: LOOP_LOOP });
    e.noteOn();
    e.advanceExact(32);
    expect(e.breaks).toBe(ENVELOPE_BREAKS_MAX);
    expect(e.state === ST_ATTACK || e.state === ST_DECAY).toBe(true);
    expect(ENVELOPE_PASSES_MAX).toBeGreaterThan(ENVELOPE_BREAKS_MAX);
  });

  it('runs a triggered envelope to its end regardless of note-off', () => {
    const e = make({ loopMode: LOOP_TRIGGER });
    e.noteOn();
    e.noteOff();
    expect(e.state).toBe(ST_ATTACK);
  });

  it('draws the one curve the console draws with: 0 is linear, positive bows down, negative up', () => {
    expect(curveConstant(0)).toBe(1);
    expect(segmentLevel(0, 1, 0.5, 0)).toBe(0.5);
    expect(segmentLevel(0, 1, 0.5, 1)).toBeLessThan(0.5);
    expect(segmentLevel(0, 1, 0.5, -1)).toBeGreaterThan(0.5);
    expect(segmentLevel(0.2, 0.8, 1, 0.3)).toBe(0.8);
  });

  it('is its two steps: the curve constant, then the shape unless the constant is 1', () => {
    for (const curve of [-1, -0.3, 0, 0.5, 1]) {
      for (const phase of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
        const k = curveConstant(curve);
        const s = k === 1 ? phase : curveShape(phase, k);
        expect(segmentLevel(0.2, 0.9, phase, curve)).toBe(0.2 + (0.9 - 0.2) * s);
      }
    }
  });

  it('bows the segment curve: 1 is linear, above bows down, below bows up', () => {
    expect(curveShape(0.5, 1)).toBe(0.5);
    expect(curveShape(0.5, 3)).toBeLessThan(0.5);
    expect(curveShape(0.5, 1 / 3)).toBeGreaterThan(0.5);
    let last = 0;
    for (let p = 0.05; p <= 1; p += 0.05) {
      const s = curveShape(p, 3);
      expect(s).toBeGreaterThan(last);
      last = s;
    }
  });
});
