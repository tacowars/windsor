/**
 * Per-note mod (#602): a note-on's `mod` is added to the part's `modWheel`
 * wherever a voice reads it, so an accent reaches `lfo.modWheelDepth` and
 * `filter.modWheelDepth` exactly as the wheel would — and a note without it
 * renders exactly as before.
 */
import { describe, expect, it } from 'vitest';

import type { LoadedProcessor, ProcessorLike } from '../__fixtures__/workletHarness';
import { loadProcessor, render } from '../__fixtures__/workletHarness';
import { FILTER_MODE, makeEnvelope, makePatch } from '../patch/patch';

const loaded: LoadedProcessor = loadProcessor();
const BLOCK = 128;
const BLOCKS = 40;
const NOTE = 60;

/** A filtered saw whose wheel opens the filter two octaves and deepens the LFO. */
const patch = (): unknown =>
  makePatch({
    filter: {
      mode: FILTER_MODE.LOWPASS,
      cutoff: 800,
      envAmount: 1,
      modWheelDepth: 2,
      env: makeEnvelope({ attackTime: 0.002, peakLevel: 1, sustainLevel: 1 }),
    },
    lfo: { amount: 0.2, modWheelDepth: 1, toOp: [0, 0, 0, 1] },
  });

/** Hold one note for `BLOCKS` blocks with the wheel param at `wheel` and the note's own `mod`. */
function hold(wheel: number, mod: number | undefined): Float32Array {
  const processor: ProcessorLike = loaded.create(patch(), 1);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const samples = new Float32Array(BLOCKS * BLOCK * 2);
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([wheel]),
    gain: new Float32Array([1]),
  };
  loaded.setFrame(0);
  processor.inbox({
    type: 'noteOn',
    id: 1,
    note: NOTE,
    velocity: 0.8,
    frame: 0,
    ...(mod === undefined ? {} : { mod }),
  });
  for (let b = 0; b < BLOCKS; b++) {
    loaded.setFrame(b * BLOCK);
    processor.process([], [[left, right]], params);
    samples.set(left, b * BLOCK * 2);
    samples.set(right, b * BLOCK * 2 + BLOCK);
  }
  return samples;
}

describe('per-note mod (#602)', () => {
  it('a note with mod 1 renders sample-identical to the wheel at 1', () => {
    expect(hold(0, 1)).toEqual(hold(1, undefined));
  });

  it('adds to the wheel: mod 0.25 over wheel 0.5 is the wheel at 0.75', () => {
    expect(hold(0.5, 0.25)).toEqual(hold(0.75, undefined));
  });

  it('a note without mod, or with mod 0, renders exactly as before', () => {
    expect(hold(0.3, 0)).toEqual(hold(0.3, undefined));
    // And through the harness's render, which never sets a mod.
    const a = render(loaded, loaded.create(patch(), 1), BLOCKS, [
      { type: 'noteOn', id: 1, note: NOTE, velocity: 0.8, frame: 0 },
    ]);
    const b = render(loaded, loaded.create(patch(), 1), BLOCKS, [
      { type: 'noteOn', id: 1, note: NOTE, velocity: 0.8, frame: 0, mod: 0 },
    ]);
    expect(a.samples).toEqual(b.samples);
    expect(hold(0, 1)).not.toEqual(hold(0, undefined));
  });
});
