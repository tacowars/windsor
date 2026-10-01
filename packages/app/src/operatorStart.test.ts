/**
 * The operator Start segment and the Phase knob: what a button writes into
 * the working patch, and that the document keeps it (`makePatch` is the
 * normalisation every commit goes through).
 */
import { describe, expect, it } from 'vitest';

import { makePatch, OP_NAMES } from '@windsor/engine';
import { OP_START_NAMES, opStartIndex, opStartLocked, writeOpStart } from './operatorStart';
import { OP_PHASE_KNOB, allPatchKnobs, patchDefault } from './patchKnobTables';

describe('the operator Start segment', () => {
  it('shows Free for a fresh patch, the engine default', () => {
    const patch = makePatch();
    expect(OP_START_NAMES).toEqual(['Free', 'Locked']);
    OP_NAMES.forEach((_, i) => {
      expect(opStartIndex(patch, i)).toBe(0);
      expect(opStartLocked(patch, i)).toBe(false);
    });
  });

  it('writes phaseFree both ways on one operator only', () => {
    const patch = makePatch();
    writeOpStart(patch, 2, 1);
    expect(patch.ops[2]?.phaseFree).toBe(false);
    expect(opStartIndex(patch, 2)).toBe(1);
    expect(patch.ops.filter((o) => o.phaseFree === false)).toHaveLength(1);

    writeOpStart(patch, 2, 0);
    expect(patch.ops[2]?.phaseFree).toBe(true);
    expect(opStartIndex(patch, 2)).toBe(0);
  });

  it('survives the normaliser with the phase it locks to', () => {
    const patch = makePatch();
    writeOpStart(patch, 0, 1);
    const op = patch.ops[0];
    if (op) op.phase = 0.25;
    const again = makePatch(structuredClone(patch));
    expect(again.ops[0]?.phaseFree).toBe(false);
    expect(again.ops[0]?.phase).toBe(0.25);
  });
});

describe('the Phase knob', () => {
  it('spans one cycle and is walked for every operator', () => {
    expect(OP_PHASE_KNOB.o.min).toBe(0);
    expect(OP_PHASE_KNOB.o.max).toBe(1);
    const paths = allPatchKnobs().map((k) => k.path);
    OP_NAMES.forEach((_, i) => expect(paths).toContain(`ops.${i}.phase`));
    expect(patchDefault('ops.0.phase')).toBe(0);
  });

  it('leaves Key off the pitch envelope, which the voice never key-scales', () => {
    const paths = allPatchKnobs().map((k) => k.path);
    expect(paths).toContain('pitchEnv.initLevel');
    expect(paths).toContain('pitchEnv.decayCurve');
    expect(paths).not.toContain('pitchEnv.keyScale');
    expect(paths).toContain('filter.env.keyScale');
  });
});
