/**
 * The Tape developer override (windsor#276 decisions 3 to 5), on the shipped
 * bundle through the processor's own port and `process`:
 *
 * - the main-thread setter posts only an allowed row, and only to a live Tape;
 * - the processor takes an allowed row, refuses (never clamps) one out of
 *   [0, 1] or not above the susceptibility floor, and hands the model's row
 *   back at `null`; a model switch keeps the override;
 * - one insert's override leaves another insert's render untouched, and
 *   clearing it returns to the shipped render;
 * - under a steady full-scale tone at 48 kHz and 2×, switching from the
 *   centre to every allowed point and back resets no core (decision 5).
 */
import { describe, expect, it } from 'vitest';
import type { ShippedTapeDsp } from '../__fixtures__/tapeDspProbe';
import { loadTape, tapeParams, type TapeProcessorLike } from '../__fixtures__/tapeHarness';
import { TAPE_TYPES } from './tapeConstants';
import { TAPE_MAGNETIC_CANDIDATES, type TapeMagneticRow } from './tapeMagneticCandidateTables';
import { isTapeMagneticCandidate, setTapeMagneticOverride } from './tapeMagneticOverride';
import { TAPE_MAGNETIC_OVERRIDE } from './tapeMagneticOverrideMessage';
import { sine } from './tapePortableMath';
import type { TapeSpec } from './tapeSpec';

const RATE = 48000;
const QUANTUM = 128;
const CENTRE: TapeMagneticRow = [0.5, 0.5, 0.5];
const TONE_HZ = 220;

interface Controls {
  drive: number;
  width: number;
  saturation: number;
}
interface OverrideDsp extends ShippedTapeDsp {
  magnetic: ShippedTapeDsp['magnetic'] & {
    overridden: boolean;
    target: Controls;
    controls: Controls;
  };
}
interface Rig {
  processor: TapeProcessorLike;
  dsp: OverrideDsp;
  params: Record<string, Float32Array>;
  at: number;
}

function rig(spec: Partial<TapeSpec> = {}): Rig {
  const params = tapeParams(spec);
  const processor = loadTape(RATE, params);
  const dsp = (processor as unknown as { dsp: OverrideDsp }).dsp;
  return { processor, dsp, params, at: 0 };
}

const post = (r: Rig, row: unknown): void =>
  r.processor.port.onmessage({ data: { type: TAPE_MAGNETIC_OVERRIDE, row } });

/** `quanta` quanta of a full-scale tone through `process`; the left output. */
function play(r: Rig, quanta: number, amplitude = 1): Float32Array {
  const left = new Float32Array(QUANTUM),
    right = new Float32Array(QUANTUM);
  const out = new Float32Array(quanta * QUANTUM);
  for (let q = 0; q < quanta; q++) {
    for (let i = 0; i < QUANTUM; i++)
      left[i] = right[i] = amplitude * sine((2 * Math.PI * TONE_HZ * (r.at + i)) / RATE);
    const outputs = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
    r.processor.process([[left, right]], outputs, r.params);
    out.set(outputs[0]![0]!, q * QUANTUM);
    r.at += QUANTUM;
  }
  return out;
}

const resets = (r: Rig): number =>
  r.dsp.magnetic.oversamplers.reduce((sum, o) => sum + o.core.resets, 0);
const target = (r: Rig): number[] => {
  const t = r.dsp.magnetic.target;
  return [t.drive, t.width, t.saturation];
};
/**
 * The smoothed controls have reached `row`. To within a few ulps: the glide's
 * snap is an absolute `Number.EPSILON`, and a step smaller than half an ulp
 * stops it up to two ulps short (as it would a model switch).
 */
function expectSettled(r: Rig, row: readonly number[]): void {
  const c = r.dsp.magnetic.controls;
  [c.drive, c.width, c.saturation].forEach((v, i) => expect(v).toBeCloseTo(row[i]!, 14));
}

describe('setTapeMagneticOverride (the main thread)', () => {
  const stage = (kind: string) => {
    const posted: unknown[] = [];
    const processor = { port: { postMessage: (m: unknown) => posted.push(m) } };
    return { posted, stage: { kind, processor: processor as unknown as AudioWorkletNode } };
  };

  it('posts an allowed row, or null, to a live Tape only', () => {
    const tape = stage('tape');
    const row = TAPE_MAGNETIC_CANDIDATES[5]!;
    expect(setTapeMagneticOverride(tape.stage, row)).toBe(true);
    expect(setTapeMagneticOverride(tape.stage, null)).toBe(true);
    expect(tape.posted).toEqual([
      { type: TAPE_MAGNETIC_OVERRIDE, row: [...row] },
      { type: TAPE_MAGNETIC_OVERRIDE, row: null },
    ]);
    const drive = stage('drive');
    expect(setTapeMagneticOverride(drive.stage, row)).toBe(false);
    expect(setTapeMagneticOverride(undefined, row)).toBe(false);
    expect(setTapeMagneticOverride({ kind: 'tape' }, row)).toBe(false);
    expect(drive.posted).toEqual([]);
  });

  it('refuses a row that is not an allowed point', () => {
    const tape = stage('tape');
    for (const row of [
      [0.5, 1, 0.5],
      [0.25, 0.25, 0.25],
      [0.5, 0.5, 0.51],
    ] as TapeMagneticRow[]) {
      expect(isTapeMagneticCandidate(row)).toBe(false);
      expect(setTapeMagneticOverride(tape.stage, row)).toBe(false);
    }
    expect(tape.posted).toEqual([]);
  });
});

describe('the processor override', () => {
  it('takes an allowed row and hands the model row back at null, through a model switch', () => {
    const r = rig();
    const row = TAPE_MAGNETIC_CANDIDATES[4]!;
    post(r, [...row]);
    expect(r.dsp.magnetic.overridden).toBe(true);
    play(r, 200);
    expect(target(r)).toEqual([...row]);
    expectSettled(r, row);
    r.params.model![0] = TAPE_TYPES.indexOf('vhs');
    play(r, 4);
    expect(target(r)).toEqual([...row]);
    post(r, null);
    play(r, 4);
    expect(r.dsp.magnetic.overridden).toBe(false);
    expect(target(r)).toEqual([...CENTRE]);
  });

  it('refuses, never clamps, a row out of [0, 1], below the floor or malformed', () => {
    const r = rig();
    const row = TAPE_MAGNETIC_CANDIDATES[6]!;
    post(r, [...row]);
    for (const bad of [
      [0.5, 1, 0.5],
      [1, 1, 1],
      [0.5, 1.5, 0.5],
      [-0.1, 0.5, 0.5],
      [NaN, 0.5, 0.5],
      [0.5, 0.5],
      [0.5, 0.5, 0.5, 0.5],
      ['0.5', 0.5, 0.5],
      'centre',
      undefined,
    ]) {
      post(r, bad);
      expect(r.dsp.magnetic.overridden).toBe(true);
      expect(target(r)).toEqual([...row]);
    }
  });

  it('changes one insert only, and null returns it to the shipped render', () => {
    const shipped = play(rig({ drive: 12 }), 30);
    const a = rig({ drive: 12 }),
      b = rig({ drive: 12 });
    post(a, [1, 0, 1]);
    const overridden = play(a, 30);
    expect(play(b, 30)).toEqual(shipped);
    expect(overridden).not.toEqual(shipped);
    // Back at the model's row the controls glide home with the state kept, then settle.
    post(a, null);
    play(a, 200);
    expectSettled(a, CENTRE);
  });

  it('switches the centre to every allowed point and back with no reset (decision 5)', () => {
    const r = rig({ oversampling: 2 });
    expect(r.dsp.magnetic.factor).toBe(2);
    post(r, [...CENTRE]);
    play(r, 20);
    for (const row of TAPE_MAGNETIC_CANDIDATES) {
      post(r, [...row]);
      const there = play(r, 20);
      post(r, [...CENTRE]);
      const back = play(r, 20);
      expect(there.every(Number.isFinite) && back.every(Number.isFinite)).toBe(true);
      expect(target(r)).toEqual([...CENTRE]);
    }
    expect(resets(r)).toBe(0);
  });
});
