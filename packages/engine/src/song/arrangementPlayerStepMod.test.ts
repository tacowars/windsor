/**
 * A grid part's step modulation lanes through the player (windsor#17): a
 * step's offsets reach the part with that step's note-on only, a line
 * without lanes sends exactly what it did, and a lane edit is live.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_SLOT } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import { kinds } from '../__fixtures__/recordingPart';
import type { Arrangement, MusicPart } from './arrangement';
import { DEFAULT_GRID_CONFIG, gridNote } from '../sequencing/gridSequencer';
import type { StepModLane } from '../sequencing/stepModLanes';
import { DIVISORS } from '../sequencing/scheduler';
import { STEP_MOD_PARAMS } from '../worklet/fm/stepModTables';

const { drone } = FULL_SLOT;
const CUTOFF = STEP_MOD_PARAMS.indexOf('filter.cutoff');

/** The drone slot as a four-quarter line, every step a note, with `lanes`. */
function line(lanes: readonly StepModLane[]): Arrangement {
  return {
    ...FULL_ARRANGEMENT,
    parts: FULL_ARRANGEMENT.parts.map((part): MusicPart =>
      part.slot === drone
        ? {
            ...part,
            sequencer: {
              kind: 'grid',
              ...DEFAULT_GRID_CONFIG,
              divisor: DIVISORS.quarter,
              steps: [gridNote(0), gridNote(2), gridNote(4), gridNote(2)],
              length: 4,
              register: { octave: 3 },
              lanes,
            },
          }
        : part,
    ),
  };
}

describe('grid lanes through the player (windsor#17)', () => {
  it('a cutoff of +0.5 on step 3 rides only step 3’s note-on; step 4 is back at the patch', () => {
    const { parts, run } = rig(line([{ param: 'filter.cutoff', values: [0, 0, 0.5, 0] }]));
    run(1);
    const ons = kinds(parts.drone, 'noteOn');
    expect(ons).toHaveLength(4);
    expect(ons[0]).not.toHaveProperty('extras');
    expect(ons[1]).not.toHaveProperty('extras');
    expect(ons[2]?.extras?.stepMod?.[CUTOFF]).toBe(0.5);
    expect(ons[2]?.extras?.stepMod?.filter((v) => v !== 0)).toEqual([0.5]);
    expect(ons[3]).not.toHaveProperty('extras');
  });

  it('a line with no lanes, or lanes all at 0, calls the part exactly as before', () => {
    const plain = rig(line([]));
    plain.run(2);
    const zero = rig(line([{ param: 'ops.0.level', values: [0, 0, 0, 0] }]));
    zero.run(2);
    expect(zero.parts.drone.calls).toEqual(plain.parts.drone.calls);
  });

  it('a lane edit reconfigures the line live: no all-notes-off, the next note carries it', () => {
    const { parts, player, run } = rig(line([]));
    run(1);
    const before = parts.drone.calls.length;
    const lanes: StepModLane[] = [{ param: 'ops.2.width', values: [-0.5, -0.5, -0.5, -0.5] }];
    expect(player.apply({ parts: { [drone]: { sequencer: { lanes } } } }, {}).ok).toBe(true);
    run(1);
    const after = parts.drone.calls.slice(before);
    expect(after.filter((c) => c.kind === 'allNotesOff')).toEqual([]);
    const width = STEP_MOD_PARAMS.indexOf('ops.2.width');
    const on = after.find((c) => c.kind === 'noteOn');
    expect(on?.extras?.stepMod?.[width]).toBe(-0.5);
  });
});
