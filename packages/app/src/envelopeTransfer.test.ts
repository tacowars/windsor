/**
 * Moving an envelope between slots (#588).
 *
 * The six slots are one type, so the model is six paths and two operations
 * over them — no DOM, no drag. What the tests guard is what a user would only
 * notice later: that the copy is structural (turning the target's knobs must
 * not move the source's curve) and that it carries loop mode and key scaling,
 * the two fields that are not part of the drawn shape and so are the ones a
 * shape-only copy would silently drop (tacowars, 2026-09-16).
 */
import { describe, expect, it } from 'vitest';

import type { Envelope, Patch } from '@windsor/engine';
import { LOOP_MODE_NAMES, makePatch } from '@windsor/engine';
import {
  ENVELOPE_SLOTS,
  type EnvelopeSlot,
  copyEnvelope,
  isEnvelopeSlot,
  opEnvelopeSlot,
  readEnvelope,
  slotLabel,
  swapEnvelopes,
  transferMessage,
} from './envelopeTransfer';

/** The envelope's fields, read off the schema rather than listed here. */
const ENV_FIELDS = Object.keys(makePatch().pitchEnv) as (keyof Envelope)[];

/** A recognisable envelope: every field a different value from the defaults. */
function stamp(patch: Patch, slot: EnvelopeSlot, seed: number): Envelope {
  const env = readEnvelope(patch, slot);
  if (!env) throw new Error(`no envelope at ${slot}`);
  ENV_FIELDS.forEach((field, i) => {
    env[field] = seed + i / ENV_FIELDS.length;
  });
  // The two fields a shape-only copy forgets, set to real values of their own.
  env.loopMode = seed % LOOP_MODE_NAMES.length;
  env.keyScale = -1 + seed / ENV_FIELDS.length;
  return { ...env };
}

const at = (patch: Patch, slot: EnvelopeSlot): Envelope => {
  const env = readEnvelope(patch, slot);
  if (!env) throw new Error(`no envelope at ${slot}`);
  return env;
};

describe('the envelope slots', () => {
  it('names every envelope a patch has, and nothing else', () => {
    expect([...ENVELOPE_SLOTS]).toEqual([
      'ops.0.env',
      'ops.1.env',
      'ops.2.env',
      'ops.3.env',
      'filter.env',
      'pitchEnv',
    ]);
    const patch = makePatch();
    for (const slot of ENVELOPE_SLOTS) {
      // Every slot resolves to a real envelope with the full field set — a
      // path typo would otherwise only show up as a silent no-op drop.
      expect(Object.keys(at(patch, slot)).sort(), slot).toEqual([...ENV_FIELDS].sort());
    }
    expect(ENVELOPE_SLOTS.map(slotLabel)).toEqual(['A', 'B', 'C', 'D', 'Filter', 'Pitch']);
    expect([0, 1, 2, 3].map((i) => opEnvelopeSlot(i))).toEqual([
      'ops.0.env',
      'ops.1.env',
      'ops.2.env',
      'ops.3.env',
    ]);
    expect(() => opEnvelopeSlot(4)).toThrow();
    expect(isEnvelopeSlot('ops.0.env')).toBe(true);
    expect(isEnvelopeSlot('ops.4.env')).toBe(false);
    expect(isEnvelopeSlot('filter')).toBe(false);
    expect(isEnvelopeSlot(null)).toBe(false);
  });
});

describe('copyEnvelope', () => {
  it('carries every field, loop mode and key scaling included, and leaves the source alone', () => {
    const patch = makePatch();
    const before = stamp(patch, 'ops.0.env', 3);
    stamp(patch, 'ops.2.env', 7);

    expect(copyEnvelope(patch, 'ops.0.env', 'ops.2.env')).toBe(true);

    for (const field of ENV_FIELDS) {
      expect(at(patch, 'ops.2.env')[field], field).toBe(before[field]);
    }
    expect(at(patch, 'ops.2.env').loopMode).toBe(before.loopMode);
    expect(at(patch, 'ops.2.env').keyScale).toBe(before.keyScale);
    expect({ ...at(patch, 'ops.0.env') }).toEqual({ ...before });
  });

  it('gives the target its own object, so editing it does not move the source', () => {
    const patch = makePatch();
    stamp(patch, 'ops.0.env', 3);
    copyEnvelope(patch, 'ops.0.env', 'ops.2.env');
    expect(at(patch, 'ops.2.env')).not.toBe(at(patch, 'ops.0.env'));

    const sourceAttack = at(patch, 'ops.0.env').attackTime;
    at(patch, 'ops.2.env').attackTime = sourceAttack + 1;
    expect(at(patch, 'ops.0.env').attackTime).toBe(sourceAttack);
  });

  it('is a no-op onto itself', () => {
    const patch = makePatch();
    const before = stamp(patch, 'filter.env', 2);
    expect(copyEnvelope(patch, 'filter.env', 'filter.env')).toBe(false);
    expect({ ...at(patch, 'filter.env') }).toEqual({ ...before });
  });

  it('reaches every slot as source and as target', () => {
    for (const from of ENVELOPE_SLOTS) {
      for (const to of ENVELOPE_SLOTS) {
        const patch = makePatch();
        const source = stamp(patch, from, ENVELOPE_SLOTS.indexOf(from) + 1);
        if (from === to) {
          expect(copyEnvelope(patch, from, to), `${from} -> ${to}`).toBe(false);
          continue;
        }
        expect(copyEnvelope(patch, from, to), `${from} -> ${to}`).toBe(true);
        expect({ ...at(patch, to) }, `${from} -> ${to}`).toEqual({ ...source });
      }
    }
  });
});

describe('swapEnvelopes', () => {
  it('exchanges an operator and the filter, both sides cloned', () => {
    const patch = makePatch();
    const a = stamp(patch, 'ops.0.env', 3);
    const f = stamp(patch, 'filter.env', 9);

    expect(swapEnvelopes(patch, 'ops.0.env', 'filter.env')).toBe(true);
    expect({ ...at(patch, 'ops.0.env') }).toEqual({ ...f });
    expect({ ...at(patch, 'filter.env') }).toEqual({ ...a });

    at(patch, 'ops.0.env').keyScale = 0.125;
    expect(at(patch, 'filter.env').keyScale).toBe(a.keyScale);
  });

  it('is a no-op with itself', () => {
    const patch = makePatch();
    const before = stamp(patch, 'pitchEnv', 4);
    expect(swapEnvelopes(patch, 'pitchEnv', 'pitchEnv')).toBe(false);
    expect({ ...at(patch, 'pitchEnv') }).toEqual({ ...before });
  });

  it('reaches every pair of slots', () => {
    for (const a of ENVELOPE_SLOTS) {
      for (const b of ENVELOPE_SLOTS) {
        if (a === b) continue;
        const patch = makePatch();
        const first = stamp(patch, a, ENVELOPE_SLOTS.indexOf(a) + 1);
        const second = stamp(patch, b, ENVELOPE_SLOTS.indexOf(b) + 2);
        expect(swapEnvelopes(patch, a, b), `${a} <-> ${b}`).toBe(true);
        expect({ ...at(patch, a) }, `${a} <-> ${b}`).toEqual({ ...second });
        expect({ ...at(patch, b) }, `${a} <-> ${b}`).toEqual({ ...first });
      }
    }
  });
});

describe('transferMessage', () => {
  it('words the status line as the operation the user just did', () => {
    expect(transferMessage('copy', 'ops.0.env', 'ops.2.env')).toBe("Copied A's envelope to C");
    expect(transferMessage('swap', 'ops.1.env', 'filter.env')).toBe(
      'Swapped B and Filter envelopes',
    );
    expect(transferMessage('copy', 'pitchEnv', 'ops.3.env')).toBe("Copied Pitch's envelope to D");
  });
});
