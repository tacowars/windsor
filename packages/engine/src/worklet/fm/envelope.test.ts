import { describe, expect, it } from 'vitest';

import type { Envelope as EnvelopeParams } from '../../patch/patch';
import {
  curveConstant,
  curveShape,
  Envelope,
  LOOP_NONE,
  LOOP_TRIGGER,
  ST_ATTACK,
  ST_DECAY,
  ST_DONE,
  ST_IDLE,
  ST_RELEASE,
  ST_SUSTAIN,
  segmentLevel,
} from './envelope';
import { MIN_SEG_TIME } from './fmConstants';

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

describe('the envelope', () => {
  it('walks attack, decay, sustain, release and done at the configured times', () => {
    const e = make();
    expect(e.state).toBe(ST_IDLE);
    e.noteOn();
    expect(e.state).toBe(ST_ATTACK);
    expect(e.advance(0.5 * SR)).toBe(1);
    expect(e.state).toBe(ST_DECAY);
    expect(e.advance(0.25 * SR)).toBe(0.5);
    expect(e.state).toBe(ST_SUSTAIN);
    expect(e.advance(1000)).toBe(0.5);
    e.noteOff();
    expect(e.state).toBe(ST_RELEASE);
    expect(e.advance(0.125 * SR)).toBe(0);
    expect(e.state).toBe(ST_DONE);
    expect(e.finished).toBe(true);
  });

  it('floors a segment at MIN_SEG_TIME and scales it by timeScale', () => {
    const e = make({ attackTime: 0 });
    e.noteOn();
    expect(e.advance(MIN_SEG_TIME * SR)).toBe(1);
    const slow = make();
    slow.timeScale = 2;
    slow.noteOn();
    slow.advance(0.5 * SR);
    expect(slow.state).toBe(ST_ATTACK);
    expect(slow.value).toBeCloseTo(0.5, 6);
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
