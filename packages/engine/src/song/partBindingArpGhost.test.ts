/**
 * An arp region's ghost playhead (windsor#137): `regionStepAt` for a region
 * that isn't sounding. An arp's `stepAt` reads the list its last onset
 * walked, so a region with its own pattern that has never played would
 * answer -1 and show no ghost, and one that has played would count over
 * whatever chord its last visit ended on. Outside its region the arp's cell
 * is counted instead from an entry into the region's first chord
 * (`Arpeggiator.entryStepAt`), the chord the Arp card's strip shows there,
 * and the cell the region plays on entry.
 *
 * The song: C natural minor, i (a triad) for bar 1, then VI7 (four notes)
 * for bars 2–4. The arp part at two octaves, quarters: region 0 (bars 1–2)
 * plays the part's `up`, region 1 (bars 3–4) its own `upDown`.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_SLOT, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import { patternOf } from '../__fixtures__/regionPatternSongs';
import { chordAt } from '../harmony/harmonyTimeline';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { arpCycleLength } from '../sequencing/arpSteps';
import { arpNoteList } from '../sequencing/arpeggiator';
import { ScaleSampler } from '../sequencing/scaleSampler';
import { DIVISORS, TICKS_PER_BAR } from '../sequencing/scheduler';
import type { Arrangement, ArpSpec, Harmony } from './arrangement';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
const QUARTER = DIVISORS.quarter;
const { arp } = FULL_SLOT;
const HARMONY: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [
    { start: 0, duration: BAR, degree: 0, size: 3 },
    { start: BAR, duration: 3 * BAR, degree: 5, size: 4 },
  ],
};
const SPEC: ArpSpec = { kind: 'arp', ...DEFAULT_ARP_CONFIG, divisor: QUARTER, octaves: 2 };
const OWN = patternOf({ ...SPEC, style: 'upDown' as const });
const A = { start: 0, duration: 2 * BAR };
const B = { start: 2 * BAR, duration: 2 * BAR, pattern: OWN };

const song = (): Arrangement =>
  withPart({ ...FULL_ARRANGEMENT, harmony: HARMONY }, 'arp', {
    regions: [A, B],
    sequencer: SPEC,
  });

/** The cycle length over the chord at `tick` for `style`, as the engine voices it. */
const cycleAt = (tick: number, style: ArpSpec['style']): number => {
  const list = arpNoteList(new ScaleSampler(HARMONY), SPEC, chordAt(HARMONY, SONG, tick)!);
  return arpCycleLength(style, list.length);
};
/** Region `start`'s local step at transport tick `tick`, on the song's cycle. */
const phaseStep = (start: number, tick: number): number =>
  Math.floor(((((tick - start) % SONG) + SONG) % SONG) / QUARTER);

describe('an arp region’s ghost (windsor#137)', () => {
  it('shows for a region with its own pattern before it has ever played', () => {
    const r = rig(song());
    r.run(1);
    // VI7 over two octaves is eight notes: a 14-cell upDown cycle.
    expect(cycleAt(B.start, 'upDown')).toBe(14);
    for (const tick of [0, QUARTER, BAR - 1, BAR, 2 * BAR - QUARTER]) {
      const step = phaseStep(B.start, tick) % 14;
      expect(r.player.regionStepAt(arp, 1, tick), `tick ${tick}`).toEqual({ step, live: false });
    }
  });

  it('counts from the region’s first chord, not the list its last onset walked', () => {
    const r = rig(song());
    // Region 0 plays through i into VI7: its generator last walked eight notes.
    r.run(2);
    // Its first chord, i over two octaves, is six notes: a 6-cell up cycle.
    expect(cycleAt(A.start, 'up')).toBe(6);
    expect(cycleAt(BAR, 'up')).toBe(8);
    for (const tick of [2 * BAR, 2 * BAR + QUARTER, SONG - QUARTER]) {
      const step = phaseStep(A.start, tick) % 6;
      expect(r.player.regionStepAt(arp, 0, tick), `tick ${tick}`).toEqual({ step, live: false });
    }
  });

  it('lands on cell 0 as the song enters the region, which the engine then plays live', () => {
    const r = rig(song());
    r.run(2);
    // Fifteen quarters since its last start, over its 14-cell cycle.
    expect(r.player.regionStepAt(arp, 1, 2 * BAR - QUARTER)).toEqual({ step: 1, live: false });
    r.run(1);
    expect(r.player.regionStepAt(arp, 1, 2 * BAR)).toEqual({ step: 0, live: true });
    expect(r.player.regionStepAt(arp, 1, 2 * BAR + QUARTER)).toEqual({ step: 1, live: true });
  });
});
