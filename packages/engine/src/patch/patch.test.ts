/**
 * The patch schema: `makePatch` and its defaults, the presets it admits, and
 * the waveform names. The tables it once mirrored from the worklet
 * (`ALGORITHMS`, `WAVE`) are the worklet's own modules since #656, so there
 * is no second copy to pin.
 */
import { describe, expect, it } from 'vitest';

import { LFO2_DEFAULTS, LFO_DEFAULTS } from '../worklet/fm/patchDefaults';
import { ALGORITHMS, FILTER_MODE, FILTER_MODE_NAMES, WAVE, WAVE_NAMES, makePatch } from './patch';
import type { Patch } from './patch';
import { serialisePatchFile } from './patchFileSerialise';
import { loadPatchFile } from './patchLibrary';
import { PRESETS, PRESET_NAMES } from './presets';

describe('waveform ids', () => {
  it('names every waveform id', () => {
    expect(WAVE_NAMES.length).toBe(Object.keys(WAVE).length);
  });

  it('names PULSE at its id (windsor#54)', () => {
    expect(WAVE.PULSE).toBe(10);
    expect(WAVE_NAMES[WAVE.PULSE]).toBe('Pulse');
  });
});

describe('operator width, the LFO fields and LFO 2 (windsor#54)', () => {
  const zeros = [0, 0, 0, 0];

  it('default to values that reproduce the old sound', () => {
    const patch = makePatch();
    for (const op of patch.ops) expect(op.width).toBe(1);
    expect(patch.lfo).toMatchObject({
      oneShot: false,
      unipolar: false,
      toWidth: zeros,
      toRatio: zeros,
    });
    expect(patch.lfo2).toEqual({ ...LFO2_DEFAULTS, toOp: zeros, toWidth: zeros, toRatio: zeros });
    expect(patch.lfo2.modWheelDepth).toBe(0);
    expect(patch.filter.lfo2Amount).toBe(0);
  });

  it('keep LFO 2 its own: a partial LFO 2 is completed from LFO2_DEFAULTS, not from lfo', () => {
    const patch = makePatch({ lfo: { rate: 2 }, lfo2: { amount: 0.5, oneShot: true } });
    expect(patch.lfo2).toEqual({
      ...LFO2_DEFAULTS,
      amount: 0.5,
      oneShot: true,
      toOp: zeros,
      toWidth: zeros,
      toRatio: zeros,
    });
    expect(patch.lfo).toEqual({
      ...LFO_DEFAULTS,
      rate: 2,
      toOp: zeros,
      toWidth: zeros,
      toRatio: zeros,
    });
    expect(patch.lfo2.toWidth).not.toBe(patch.lfo.toWidth);
  });
});

/**
 * A patch file as it was saved before windsor#54: no `lfo2`, no
 * `filter.lfo2Amount` and no operator `width`. Built here rather than read
 * from a library file, so a refit that gives a library patch those fields
 * (windsor#324) does not break the test.
 */
function fileBeforeWindsor54(): Record<string, unknown> {
  const patch = JSON.parse(JSON.stringify(makePatch({ name: 'Old Bell', algorithm: 2 }))) as {
    lfo2?: unknown;
    filter: { lfo2Amount?: unknown };
    ops: { width?: unknown }[];
  };
  delete patch.lfo2;
  delete patch.filter.lfo2Amount;
  for (const op of patch.ops) delete op.width;
  return { format: 3, name: 'Old Bell', category: 'Leads', tags: [], description: '', patch };
}

describe('a patch file written before windsor#54', () => {
  const raw = fileBeforeWindsor54();
  const before = raw['patch'] as Record<string, unknown>;

  it('carries none of the new fields', () => {
    expect(before).not.toHaveProperty('lfo2');
    expect(before['filter']).not.toHaveProperty('lfo2Amount');
  });

  it('loads with the defaults, and round-trips unchanged apart from the new fields', () => {
    const entry = loadPatchFile('old-bell', raw);
    const fresh = makePatch();
    expect(entry.patch.lfo2).toEqual(fresh.lfo2);
    expect(entry.patch.ops.map((op) => op.width)).toEqual([1, 1, 1, 1]);
    const written = JSON.parse(serialisePatchFile(entry)) as { patch: Patch };
    expect(written.patch).toMatchObject(before);
    expect(written.patch).toEqual(entry.patch);
  });
});

describe('makePatch', () => {
  it('fills in four operators regardless of input', () => {
    expect(makePatch().ops).toHaveLength(4);
    expect(makePatch({ ops: [{ level: 1 }] }).ops).toHaveLength(4);
  });

  it('defaults operator A audible and the rest silent', () => {
    const patch = makePatch();
    expect(patch.ops[0]?.level).toBe(1);
    expect(patch.ops[1]?.level).toBe(0);
  });

  it('completes a partial envelope rather than dropping its siblings', () => {
    const patch = makePatch({ ops: [{ env: { attackTime: 1.5 } }] });
    expect(patch.ops[0]?.env.attackTime).toBe(1.5);
    expect(patch.ops[0]?.env.releaseTime).toBe(0.3);
  });

  it('defaults mono off, and carries it when a partial sets it (#453)', () => {
    // Polyphonic is what every patch was before mono existed, so an absent
    // field has to stay poly -- in the code's presets and in a document alike.
    expect(makePatch().mono).toBe(false);
    expect(makePatch({ mono: true }).mono).toBe(true);
  });

  it('defaults the filter wheel depth to 0 and carries a set one (#586)', () => {
    // Off by default, so every patch authored before the field existed keeps
    // its render; the LFO's wheel depth keeps its own default of 1.
    expect(makePatch().filter.modWheelDepth).toBe(0);
    expect(makePatch().lfo.modWheelDepth).toBe(1);
    expect(makePatch({ filter: { modWheelDepth: -3 } }).filter.modWheelDepth).toBe(-3);
  });

  it('carries the Acid mode, and leaves a mode past it for the normaliser to play as Off (windsor#573)', () => {
    expect(makePatch({ filter: { mode: FILTER_MODE.LADDER } }).filter.mode).toBe(6);
    expect(FILTER_MODE_NAMES[FILTER_MODE.LADDER]).toBe('Acid');
    // `normalisePatch` plays 7 as Off (`patchNormalise.test.ts`); makePatch copies what it is given.
    expect(makePatch({ filter: { mode: 7 } }).filter.mode).toBe(7);
  });

  it('does not share nested state between two patches', () => {
    const a = makePatch();
    const b = makePatch();
    const opA = a.ops[0];
    expect(opA).toBeDefined();
    if (opA) opA.env.attackTime = 9;
    expect(b.ops[0]?.env.attackTime).toBe(0.002);
  });
});

describe('presets', () => {
  it('are all well-formed patches', () => {
    expect(PRESET_NAMES.length).toBeGreaterThan(0);
    for (const name of PRESET_NAMES) {
      const patch = PRESETS[name];
      expect(patch, name).toBeDefined();
      if (!patch) continue;
      expect(patch.ops, name).toHaveLength(4);
      expect(patch.algorithm, name).toBeGreaterThanOrEqual(0);
      expect(patch.algorithm, name).toBeLessThan(ALGORITHMS.length);
    }
  });

  it('reference only waveforms the worklet implements', () => {
    const ids = new Set<number>(Object.values(WAVE));
    for (const name of PRESET_NAMES) {
      for (const op of PRESETS[name]?.ops ?? []) {
        expect(ids.has(op.wave), `${name} uses waveform ${op.wave}`).toBe(true);
      }
    }
  });
});
