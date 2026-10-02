/**
 * The Arpeggiator through the player (#706): bound by `partGenerators.ts`,
 * gated by its regions, fed the harmony timeline's chord. The walk follows
 * i → VI, a region entry restarts the line, a region end releases the held
 * note, a seed edit restarts the stream at once, and
 * two players over one document play the same notes (epic #703 decisions 2,
 * 12, 13, 16).
 */
import { describe, expect, it } from 'vitest';

import {
  FULL_ARRANGEMENT,
  FULL_REGION,
  FULL_SLOT,
  withPart,
} from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import { kinds, type RecordingPart } from '../__fixtures__/recordingPart';
import type { Arrangement, ArpSpec, Harmony, Region } from './arrangement';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { arpNoteList } from '../sequencing/arpeggiator';
import { chordAt } from '../harmony/harmonyTimeline';
import { ScaleSampler } from '../sequencing/scaleSampler';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { DIVISORS, PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
const QUARTER = DIVISORS.quarter;
/** C natural minor: i for two bars, then VI. */
const HARMONY: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [
    { start: 0, duration: 2 * BAR, degree: 0, size: 3 },
    { start: 2 * BAR, duration: 2 * BAR, degree: 5, size: 3 },
  ],
};
const sampler = new ScaleSampler(HARMONY);
const SPEC: ArpSpec = { kind: 'arp', ...DEFAULT_ARP_CONFIG, divisor: QUARTER, octaves: 2, gate: 1 };
const listAt = (tick: number): number[] =>
  arpNoteList(sampler, SPEC, chordAt(HARMONY, SONG, tick)!);

const arp = (over: Partial<ArpSpec> = {}, regions: Region[] = [FULL_REGION]): Arrangement =>
  withPart({ ...FULL_ARRANGEMENT, harmony: HARMONY }, 'arp', {
    regions,
    sequencer: { ...SPEC, ...over },
  });

const tickOf = (time: number, a: Arrangement): number =>
  Math.round((time * a.transport.bpm * PPQ) / SECONDS_PER_MINUTE);
const onNotes = (part: RecordingPart): number[] => kinds(part, 'noteOn').map((c) => c.note!);
const trace = (part: RecordingPart, a: Arrangement): string[] =>
  part.calls.map((c) => `${c.kind} ${c.note ?? ''} @${tickOf(c.time ?? 0, a)}`);

describe('the arp part in the player', () => {
  it('walks up the i list, and carries its index into the VI list at bar 3 (retrigger off)', () => {
    const r = rig(arp());
    r.run(3);
    const notes = onNotes(r.parts.arp);
    const steps = (3 * BAR) / QUARTER;
    expect(notes).toHaveLength(steps);
    const expected = Array.from({ length: steps }, (_, step) => {
      const list = listAt(step * QUARTER);
      return list[step % list.length];
    });
    expect(notes).toEqual(expected);
  });

  it('with retrigger on, the first VI step plays n[0]', () => {
    const r = rig(arp({ retrigger: true }));
    r.run(3);
    const firstVi = (2 * BAR) / QUARTER;
    expect(onNotes(r.parts.arp)[firstVi]).toBe(listAt(2 * BAR)[0]);
  });

  it('walks a chromatic event’s tones, and a quality change alone retriggers (windsor#330)', () => {
    // i, then I: C minor turned major by its quality, same degree and size.
    const picardy: Harmony = {
      ...HARMONY,
      events: [HARMONY.events[0]!, { ...HARMONY.events[0]!, start: 2 * BAR, quality: 'maj' }],
    };
    const major = arpNoteList(sampler, SPEC, chordAt(picardy, SONG, 2 * BAR)!);
    expect(major.slice(0, 3).map((n) => n - major[0]!)).toEqual([0, 4, 7]);
    const firstI = (2 * BAR) / QUARTER;
    const on = rig({ ...arp({ retrigger: true }), harmony: picardy });
    on.run(3);
    expect(onNotes(on.parts.arp).slice(firstI, firstI + 2)).toEqual(major.slice(0, 2));
    const off = rig({ ...arp(), harmony: picardy });
    off.run(3);
    expect(onNotes(off.parts.arp)[firstI]).toBe(major[firstI % major.length]);
  });

  it('a second region restarts the line at its entry, and a region end releases the held note', () => {
    const halves: Region[] = [
      { start: 0, duration: BAR },
      { start: 2 * BAR, duration: BAR },
    ];
    const a = arp({}, halves);
    const r = rig(a);
    r.run(3);
    const perBar = BAR / QUARTER;
    const notes = onNotes(r.parts.arp);
    expect(notes).toHaveLength(2 * perBar);
    expect(notes[perBar]).toBe(listAt(2 * BAR)[0]);
    const offAtEnd = kinds(r.parts.arp, 'noteOffByNote').filter(
      (c) => tickOf(c.time ?? 0, a) === BAR,
    );
    expect(offAtEnd.map((c) => c.note)).toEqual([notes[perBar - 1]]);
  });

  it('two players over the same random arp play the same notes; a different seed does not', () => {
    const a = arp({ style: 'random', seed: 21 });
    const first = rig(a);
    const second = rig(a);
    first.run(2);
    second.run(2);
    expect(trace(second.parts.arp, a)).toEqual(trace(first.parts.arp, a));
    const other = rig(arp({ style: 'random', seed: 22 }));
    other.run(2);
    expect(onNotes(other.parts.arp)).not.toEqual(onNotes(first.parts.arp));
  });

  it('a seed edit rebuilds the part and restarts its stream at once', () => {
    const r = rig(arp({ style: 'random', seed: 3 }));
    r.run(1);
    const reference = rig(arp({ style: 'random', seed: 3 }));
    reference.run(2);
    expect(r.player.apply({ parts: { [FULL_SLOT.arp]: { sequencer: { seed: 4 } } } }).ok).toBe(
      true,
    );
    r.run(1);
    const perBar = BAR / QUARTER;
    const restarted = rig(arp({ style: 'random', seed: 4 }));
    restarted.run(1);
    expect(onNotes(r.parts.arp).slice(perBar)).toEqual(onNotes(restarted.parts.arp));
    expect(onNotes(r.parts.arp).slice(perBar)).not.toEqual(
      onNotes(reference.parts.arp).slice(perBar),
    );
  });
});
