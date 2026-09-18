/**
 * The envelope curve is one function (#620 decision 4): the worklet's
 * `Envelope` and `envelopeCurve.ts` agree sample for sample. The worklet is
 * evaluated through the harness, one envelope is driven through attack, decay,
 * sustain and release at the control rate, and every value it produces is
 * compared with a walk of the same segments through `segmentLevel` — the
 * function the console's display draws with. A change to the worklet's curve
 * (its `Math.exp(curve * 3)` or `curveShape`) fails here before it can make the
 * drawing lie; so does a change to the TS side alone.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor } from './__fixtures__/workletHarness';
import { curveConstant, curveShape, segmentLevel } from './envelopeCurve';
import { makePatch, type Envelope } from './patch';

/** Every curve sign, and the linear special case (`k === 1`), in one envelope. */
const ENVELOPE: Envelope = {
  ...makePatch().ops[0]!.env,
  initLevel: 0.1,
  attackTime: 0.02,
  attackCurve: 0.6,
  peakLevel: 1,
  decayTime: 0.03,
  decayCurve: 0,
  sustainLevel: 0.5,
  releaseTime: 0.05,
  releaseCurve: -0.7,
  endLevel: 0.05,
  loopMode: 0,
  keyScale: 0,
};

interface Segment {
  time: number;
  target: number;
  curve: number;
}

/**
 * The worklet's state machine over `segmentLevel`, in the order the worklet
 * performs its arithmetic (phase accumulated as `n / (time * sr)`, the
 * segment floor applied first), so the comparison is exact rather than close.
 */
interface Walk {
  env: Envelope;
  sr: number;
  /** Samples per control step. */
  n: number;
  minSegmentTime: number;
  /** The step the gate closes on, and the steps to walk. */
  gateSteps: number;
  steps: number;
}

function modelWalk({ env, sr, n, minSegmentTime, gateSteps, steps }: Walk): number[] {
  const attack: Segment = { time: env.attackTime, target: env.peakLevel, curve: env.attackCurve };
  const decay: Segment = { time: env.decayTime, target: env.sustainLevel, curve: env.decayCurve };
  const release: Segment = { time: env.releaseTime, target: env.endLevel, curve: env.releaseCurve };
  let stage: 'attack' | 'decay' | 'sustain' | 'release' | 'done' = 'attack';
  let phase = 0;
  let from = env.initLevel;
  let value = env.initLevel;
  const out: number[] = [];
  for (let step = 0; step < steps; step++) {
    if (step === gateSteps && stage !== 'done') {
      stage = 'release';
      phase = 0;
      from = value;
    }
    if (stage === 'done') {
      out.push(value);
      continue;
    }
    if (stage === 'sustain') {
      value = env.sustainLevel;
      out.push(value);
      continue;
    }
    const segment = stage === 'attack' ? attack : stage === 'decay' ? decay : release;
    const time = Math.max(segment.time, minSegmentTime);
    phase += n / (time * sr);
    if (phase >= 1) {
      value = segment.target;
      phase = 0;
      from = segment.target;
      stage = stage === 'attack' ? 'decay' : stage === 'decay' ? 'sustain' : 'done';
    } else {
      value = segmentLevel(from, segment.target, phase, segment.curve);
    }
    out.push(value);
  }
  return out;
}

describe('envelopeCurve against the worklet', () => {
  it('renders one envelope through the processor and through segmentLevel to the same samples', () => {
    const dsp = loadProcessor();
    const n = dsp.ctrlInterval;
    const gateSteps =
      Math.ceil(((ENVELOPE.attackTime + ENVELOPE.decayTime) * dsp.sampleRate) / n) + 8;
    const steps = gateSteps + Math.ceil((ENVELOPE.releaseTime * dsp.sampleRate) / n) + 8;

    const envelope = dsp.envelope(ENVELOPE);
    envelope.noteOn();
    const rendered: number[] = [];
    for (let step = 0; step < steps; step++) {
      if (step === gateSteps) envelope.noteOff();
      rendered.push(envelope.advance(n));
    }
    expect(envelope.finished).toBe(true);

    const modelled = modelWalk({
      env: ENVELOPE,
      sr: dsp.sampleRate,
      n,
      minSegmentTime: dsp.minSegmentTime,
      gateSteps,
      steps,
    });
    expect(rendered).toEqual(modelled);
    // The walk really crossed every stage: a peak, a sustain plateau and an end.
    expect(rendered).toContain(ENVELOPE.peakLevel);
    expect(rendered.filter((v) => v === ENVELOPE.sustainLevel).length).toBeGreaterThan(1);
    expect(rendered.at(-1)).toBe(ENVELOPE.endLevel);
  });

  it('bows the way the worklet documents: 0 is linear, positive down, negative up', () => {
    expect(curveConstant(0)).toBe(1);
    expect(segmentLevel(0, 1, 0.5, 0)).toBe(0.5);
    expect(segmentLevel(0, 1, 0.5, 1)).toBeLessThan(0.5);
    expect(segmentLevel(0, 1, 0.5, -1)).toBeGreaterThan(0.5);
    expect(curveShape(0, 4)).toBe(0);
    expect(curveShape(1, 4)).toBe(1);
  });
});
