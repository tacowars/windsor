/**
 * The patch schema is duplicated: `patch.ts` for the main thread, and the same
 * tables again inside `worklet/fm-processor.js`, which must stay import-free.
 * These tests are what makes the duplication safe -- they fail the moment the
 * two copies disagree.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor } from './__fixtures__/workletHarness';
import { ALGORITHMS, WAVE, WAVE_NAMES, makePatch } from './patch';
import { PRESETS, PRESET_NAMES } from './presets';

const loaded = loadProcessor();

const normalise = (a: { mods: readonly (readonly number[])[]; carriers: readonly number[] }) =>
  JSON.stringify({
    mods: a.mods.map((m) => [...m].sort((x, y) => x - y)),
    carriers: [...a.carriers].sort((x, y) => x - y),
  });

describe('patch schema mirrors the worklet', () => {
  it('declares the same number of algorithms', () => {
    expect(ALGORITHMS.length).toBe(loaded.algorithms.length);
  });

  it('routes every algorithm identically', () => {
    for (let i = 0; i < ALGORITHMS.length; i++) {
      const ours = ALGORITHMS[i];
      const theirs = loaded.algorithms[i];
      expect(ours, `algorithm ${i}`).toBeDefined();
      expect(theirs, `algorithm ${i}`).toBeDefined();
      if (!ours || !theirs) continue;
      expect(normalise(ours), `algorithm ${i} (${ours.label})`).toBe(normalise(theirs));
    }
  });

  it('uses the same waveform ids', () => {
    for (const [name, value] of Object.entries(WAVE)) {
      expect(loaded.waveIds[name], `waveform ${name}`).toBe(value);
    }
  });

  it('names every waveform id', () => {
    expect(WAVE_NAMES.length).toBe(Object.keys(WAVE).length);
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
