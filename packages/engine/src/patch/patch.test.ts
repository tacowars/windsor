/**
 * The patch schema: `makePatch` and its defaults, the presets it admits, and
 * the waveform names. The tables it once mirrored from the worklet
 * (`ALGORITHMS`, `WAVE`) are the worklet's own modules since #656, so there
 * is no second copy to pin.
 */
import { describe, expect, it } from 'vitest';

import { ALGORITHMS, WAVE, WAVE_NAMES, makePatch } from './patch';
import { PRESETS, PRESET_NAMES } from './presets';

describe('waveform ids', () => {
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
