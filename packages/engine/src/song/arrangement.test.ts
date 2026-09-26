/**
 * `mergeArrangement` implements the apply-over-defaults contract (issue #69,
 * refinement decision 3), over a part list addressed by slot (#597). The
 * shipped arrangement's own validity is asserted where the arrangement lives
 * (issue #75): `arrangementGate.test.ts`, on the committed JSON document.
 */
import { describe, expect, it } from 'vitest';

import {
  FULL_ARRANGEMENT,
  FULL_PARTS,
  FULL_SLOT,
  onlyParts,
} from '../__fixtures__/fullArrangement';
import { mergeArrangement, type ArrangementPartial } from './arrangement';

const { kick, hat, arp } = FULL_SLOT;

describe('mergeArrangement', () => {
  it('changes only the named fields and leaves the input untouched', () => {
    const before = JSON.stringify(FULL_ARRANGEMENT);
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, {
      transport: { bpm: 90 },
      parts: { [arp]: { velocity: 0.5 } },
    });
    expect(ignored).toEqual([]);
    expect(merged.transport).toEqual({ ...FULL_ARRANGEMENT.transport, bpm: 90 });
    expect(merged.parts[arp]?.velocity).toBe(0.5);
    expect(merged.parts[arp]?.sequencer).toEqual(FULL_PARTS.arp.sequencer);
    expect(merged.parts[kick]).toEqual(FULL_PARTS.kick);
    expect(JSON.stringify(FULL_ARRANGEMENT)).toBe(before);
  });

  it('addresses a part by slot, not by list position', () => {
    const hatAndArp = onlyParts(FULL_ARRANGEMENT, 'hat', 'arp');
    const { merged, ignored } = mergeArrangement(hatAndArp, {
      parts: { [arp]: { velocity: 0.1 } },
    });
    expect(ignored).toEqual([]);
    // Slot 2 is the list's second entry here.
    expect(merged.parts.map((p) => p.velocity)).toEqual([FULL_PARTS.hat.velocity, 0.1]);
  });

  it('reports unknown keys by path and ignores them', () => {
    const partial = {
      bogus: 1,
      parts: { [kick]: { nope: 2, velocity: 0.9 } },
    } as unknown as ArrangementPartial;
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, partial);
    expect(ignored.sort()).toEqual(['bogus', 'parts.0.nope']);
    expect(merged.parts[kick]?.velocity).toBe(0.9);
  });

  it('ignores and reports an object arriving where a leaf lives', () => {
    const partial = { transport: { bpm: { oops: 1 } } } as unknown as ArrangementPartial;
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, partial);
    expect(ignored).toEqual(['transport.bpm']);
    expect(merged.transport.bpm).toBe(FULL_ARRANGEMENT.transport.bpm);
  });

  it('ignores and reports a fragment naming an absent slot', () => {
    // A fragment has nothing to merge into; only a whole part adds a slot (#629).
    const kickOnly = onlyParts(FULL_ARRANGEMENT, 'kick');
    const { merged, ignored } = mergeArrangement(kickOnly, { parts: { 5: { velocity: 0.5 } } });
    expect(ignored).toEqual(['parts.5']);
    expect(merged.parts).toEqual(kickOnly.parts);
  });

  it('appends a whole part on a free slot, and only when its slot names that slot (#629)', () => {
    const kickOnly = onlyParts(FULL_ARRANGEMENT, 'kick');
    const added = mergeArrangement(kickOnly, { parts: { [FULL_SLOT.hat]: FULL_PARTS.hat } });
    expect(added.ignored).toEqual([]);
    expect(added.merged.parts).toEqual([FULL_PARTS.kick, FULL_PARTS.hat]);
    const mismatched = mergeArrangement(kickOnly, { parts: { 6: FULL_PARTS.hat } });
    expect(mismatched.ignored).toEqual(['parts.6']);
    expect(mismatched.merged.parts).toEqual(kickOnly.parts);
  });

  it('removes the part at a null slot and reports a null at an absent one (#629)', () => {
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, {
      parts: { [FULL_SLOT.arp]: null, 7: null },
    });
    expect(ignored).toEqual(['parts.7']);
    expect(merged.parts.map((p) => p.slot)).toEqual([
      FULL_SLOT.kick,
      FULL_SLOT.hat,
      FULL_SLOT.drone,
    ]);
    expect(FULL_ARRANGEMENT.parts).toHaveLength(4);
  });

  it('ignores a parts list: adding or removing parts is a rebuild, not a partial', () => {
    const partial = { parts: [FULL_PARTS.kick] } as unknown as ArrangementPartial;
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, partial);
    expect(ignored).toEqual(['parts']);
    expect(merged.parts).toEqual(FULL_ARRANGEMENT.parts);
  });

  it('replaces a tagged union wholesale when the kind changes', () => {
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, {
      parts: { [hat]: { sequencer: { density: { kind: 'walk', stepChance: 0.5 } } } },
    });
    expect(ignored).toEqual([]);
    // No lfoBars fields left lying around in the data (#70 round-trips it).
    const sequencer = merged.parts[hat]?.sequencer;
    expect(sequencer?.kind === 'euclidean' && sequencer.density).toEqual({
      kind: 'walk',
      stepChance: 0.5,
    });
  });

  it('replaces the sequencer wholesale when its kind changes (#597)', () => {
    const { merged } = mergeArrangement(FULL_ARRANGEMENT, {
      parts: { [kick]: { sequencer: { kind: 'none' } } },
    });
    expect(merged.parts[kick]?.sequencer).toEqual({ kind: 'none' });
  });

  it('merges within a union when the kind is unchanged', () => {
    const { merged } = mergeArrangement(FULL_ARRANGEMENT, {
      parts: {
        [kick]: { sequencer: { kind: 'euclidean', density: { kind: 'lfoBars', bars: 4 } } },
      },
    });
    const sequencer = merged.parts[kick]?.sequencer;
    expect(sequencer?.kind === 'euclidean' && sequencer.density).toEqual({
      kind: 'lfoBars',
      bars: 4,
      shape: 'tri',
    });
  });

  it('replaces arrays and the scale wholesale', () => {
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, {
      harmony: { scale: [0, 3, 7] },
    });
    expect(ignored).toEqual([]);
    expect(merged.harmony.scale).toEqual([0, 3, 7]);
    expect(merged.harmony.root).toBe(FULL_ARRANGEMENT.harmony.root);
    expect(merged.harmony.events).toEqual(FULL_ARRANGEMENT.harmony.events);
  });

  it('replaces the harmony events and a part’s regions wholesale (#705)', () => {
    const events = [{ start: 0, duration: 384, degree: 4, size: 4 as const }];
    const regions = [{ start: 96, duration: 96 }];
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, {
      harmony: { events },
      parts: { [arp]: { regions } },
    });
    expect(ignored).toEqual([]);
    expect(merged.harmony.events).toEqual(events);
    expect(merged.parts[arp]?.regions).toEqual(regions);
    expect(merged.parts[kick]?.regions).toEqual(FULL_PARTS.kick.regions);
  });
});
