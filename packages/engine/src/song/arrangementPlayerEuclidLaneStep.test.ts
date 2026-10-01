/**
 * The console's lane playheads (windsor#355 decision 8): `regionStepAt`
 * reports a Euclid region's local step, the count its lanes read mod their
 * own lengths, sounding or not, and it is the step each hit's lanes were
 * read at. Other kinds report none.
 */
import { describe, expect, it } from 'vitest';

import { ALL_ON, KICK_SLOT, hitsByStep, kickSong, tickOf } from '../__fixtures__/euclidSongs';
import { FULL_SLOT } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import { laneStep } from '../sequencing/euclidLanes';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
const A = { start: 0, duration: BAR + BAR / 2 };
const B = { start: 2 * BAR + BAR / 2, duration: BAR };
const PITCH = [0, 1, 2, 3, 4, 5, 6];

const song = kickSong({
  sequencer: { pattern: ALL_ON, note: 60, pitchLane: PITCH },
  part: { regions: [A, B] },
});

describe('a Euclid region’s local step (windsor#355)', () => {
  it('counts from the region’s start while live, and runs on from it as a ghost', () => {
    const { player } = rig(song);
    for (const tick of [B.start, B.start + 6, B.start + 47, B.start + BAR - 1]) {
      const at = player.regionStepAt(KICK_SLOT, 1, tick);
      const local = Math.floor((tick - B.start) / 6);
      expect(at, `tick ${tick}`).toEqual({ step: local % 16, live: true, localStep: local });
    }
    for (const tick of [0, 30, BAR + 5]) {
      const phase = (((tick - B.start) % SONG) + SONG) % SONG;
      const local = Math.floor(phase / 6);
      expect(player.regionStepAt(KICK_SLOT, 1, tick)).toEqual({
        step: local % 16,
        live: false,
        localStep: local,
      });
    }
  });

  it('is the step every hit’s lanes were read at', () => {
    const { parts, player, run } = rig(song);
    run(4);
    const hits = hitsByStep(parts.kick);
    expect(hits).toHaveLength(24 + 16);
    for (const hit of hits) {
      const tick = tickOf(hit);
      const region = tick < A.duration ? 0 : 1;
      const at = player.regionStepAt(KICK_SLOT, region, tick);
      expect(at?.live).toBe(true);
      expect(hit.note, `tick ${tick}`).toBe(
        60 + PITCH[laneStep(at?.localStep ?? -1, PITCH.length)]!,
      );
    }
  });

  it('is absent for another kind', () => {
    const { player } = rig(song);
    expect(player.regionStepAt(FULL_SLOT.arp, 0, 0)).not.toHaveProperty('localStep');
  });
});
