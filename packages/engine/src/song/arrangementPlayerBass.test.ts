/**
 * The Bass / Drone through the player (#707): the binding builds it over the
 * song's key, the region gate hands it the chord and its local tick, a
 * region entry restarts its stream and a chord change does not, and a
 * region end releases the note it holds.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_REGION, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import { kinds, type RecordingPart } from '../__fixtures__/recordingPart';
import type { Arrangement, BassSpec, Harmony, Region } from './arrangement';
import { DEFAULT_BASS_CONFIG } from '../sequencing/bassSequencer';
import { ScaleSampler } from '../sequencing/scaleSampler';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { DIVISORS, PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
const OCTAVE = 2;
/** C natural minor: i for bar 1, VI from bar 2 on. */
const HARMONY: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [
    { start: 0, duration: BAR, degree: 0, size: 3 },
    { start: BAR, duration: 3 * BAR, degree: 5, size: 3 },
  ],
};
/** The same song held on i throughout. */
const ONLY_I: Harmony = {
  ...HARMONY,
  events: [{ start: 0, duration: 4 * BAR, degree: 0, size: 3 }],
};
const sampler = new ScaleSampler(HARMONY);
const C2 = sampler.noteFor(0, OCTAVE);
const A_FLAT_2 = sampler.noteFor(5, OCTAVE);

const bassSong = (
  over: Partial<BassSpec>,
  regions: Region[] = [FULL_REGION],
  harmony: Harmony = HARMONY,
): Arrangement =>
  withPart({ ...FULL_ARRANGEMENT, harmony }, 'drone', {
    regions,
    sequencer: {
      kind: 'bass',
      ...DEFAULT_BASS_CONFIG,
      divisor: DIVISORS.quarter,
      register: { octave: OCTAVE },
      ...over,
    },
  });

const tickOf = (time: number, arrangement: Arrangement): number =>
  Math.round((time * arrangement.transport.bpm * PPQ) / SECONDS_PER_MINUTE);
const trace = (part: RecordingPart, kind: 'noteOn' | 'noteOffByNote', a: Arrangement) =>
  kinds(part, kind).map((c) => [tickOf(c.time ?? 0, a), c.note]);
const onsetTicks = (part: RecordingPart, a: Arrangement): number[] =>
  trace(part, 'noteOn', a).map(([tick]) => tick as number);

describe('the bass through the player', () => {
  it('follows the root at gate 1: C2 held through bar 1, A♭2 from the bar-2 onset', () => {
    const song = bassSong({ gate: 1 });
    const r = rig(song);
    r.run(2);
    expect(trace(r.parts.drone, 'noteOn', song)).toEqual([
      [0, C2],
      [BAR, A_FLAT_2],
    ]);
    expect(trace(r.parts.drone, 'noteOffByNote', song)).toEqual([[BAR, C2]]);
  });

  it('follows a chromatic root: ♭VI major in C minor is G, a semitone under A♭ (windsor#330)', () => {
    const flatVi: Harmony = {
      ...HARMONY,
      events: [HARMONY.events[0]!, { ...HARMONY.events[1]!, quality: 'maj', accidental: -1 }],
    };
    const song = bassSong({ gate: 1 }, [FULL_REGION], flatVi);
    const r = rig(song);
    r.run(2);
    expect(trace(r.parts.drone, 'noteOn', song)).toEqual([
      [0, C2],
      [BAR, A_FLAT_2 - 1],
    ]);
  });

  it('a region re-entry restarts the density stream: the second pass repeats the first', () => {
    const firstBar: Region[] = [{ start: 0, duration: BAR }];
    const song = bassSong({ gate: 0.5, density: 0.5, seed: 9 }, firstBar);
    const songTicks = song.transport.bars * BAR;
    const r = rig(song);
    r.run(song.transport.bars + 1);
    const ticks = onsetTicks(r.parts.drone, song);
    const first = ticks.filter((t) => t < BAR);
    const second = ticks.filter((t) => t >= songTicks).map((t) => t - songTicks);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it('a chord change mid-region does not restart the stream', () => {
    const over = { gate: 0.5, density: 0.5, seed: 9 };
    const changing = bassSong(over);
    const still = bassSong(over, [FULL_REGION], ONLY_I);
    const a = rig(changing);
    const b = rig(still);
    a.run(2);
    b.run(2);
    expect(onsetTicks(a.parts.drone, changing)).toEqual(onsetTicks(b.parts.drone, still));
  });

  it('a region end releases the held note on that tick', () => {
    const song = bassSong({ gate: 1 }, [{ start: 0, duration: BAR }]);
    const r = rig(song);
    r.run(2);
    expect(trace(r.parts.drone, 'noteOn', song)).toEqual([[0, C2]]);
    expect(trace(r.parts.drone, 'noteOffByNote', song)).toEqual([[BAR, C2]]);
  });

  it('a region ending inside a gated note cuts it on the region end, not at its gate', () => {
    const divisor = DIVISORS.quarter;
    const regionEnd = divisor / 4;
    const song = bassSong({ gate: 0.5 }, [{ start: 0, duration: regionEnd }]);
    const r = rig(song);
    r.run(1);
    expect(trace(r.parts.drone, 'noteOn', song)).toEqual([[0, C2]]);
    expect(trace(r.parts.drone, 'noteOffByNote', song)).toEqual([[regionEnd, C2]]);
  });
});
