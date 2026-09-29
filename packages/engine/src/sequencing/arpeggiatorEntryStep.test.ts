/**
 * What the Arp card reads of the arp without playing it (windsor#137):
 * `entryStepAt`, the cell a local step lands on counted from an entry into a
 * chord, which a region that isn't sounding shows as its ghost; and
 * `arpCellPitch`, the pitch a cell plays when the walk alone decides it.
 */
import { describe, expect, it } from 'vitest';

import type { ChordSize } from '../harmony/chordTheory';
import { chordAt, type HarmonyChord } from '../harmony/harmonyTimeline';
import { DEFAULT_ARP_CONFIG, type ArpSequencerConfig } from './arpSequencer';
import { Arpeggiator, arpCellPitch, arpNoteList } from './arpeggiator';
import { SEMITONES_PER_OCTAVE, ScaleSampler } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR } from './scheduler';

const KEY = { root: 0, scale: 'naturalMinor' } as const;
const sampler = new ScaleSampler(KEY);
const chord = (degree: number, size: ChordSize): HarmonyChord =>
  chordAt(
    { ...KEY, events: [{ start: 0, duration: TICKS_PER_BAR, degree, size }] },
    TICKS_PER_BAR,
    0,
  )!;
const config = (over: Partial<ArpSequencerConfig> = {}): ArpSequencerConfig => ({
  ...DEFAULT_ARP_CONFIG,
  divisor: DIVISORS.quarter,
  octaves: 2,
  ...over,
});

describe('Arpeggiator.entryStepAt', () => {
  it('counts a local step over the cycle of the chord it is given, with no onset played', () => {
    const arp = new Arpeggiator(sampler, config({ style: 'upDown' }));
    // Before any onset `stepAt` has no list; `entryStepAt` needs none.
    expect(arp.stepAt(3)).toBe(-1);
    // A triad over two octaves: six notes, a 10-cell upDown cycle.
    expect([0, 3, 9, 10, 23].map((s) => arp.entryStepAt(s, chord(0, 3)))).toEqual([0, 3, 9, 0, 3]);
    // A seventh chord: eight notes, 14 cells.
    expect(arp.entryStepAt(13, chord(0, 4))).toBe(13);
    expect(arp.entryStepAt(14, chord(0, 4))).toBe(0);
  });

  it('follows a live style or octaves change', () => {
    const arp = new Arpeggiator(sampler, config({ style: 'up' }));
    expect(arp.entryStepAt(7, chord(0, 3))).toBe(1);
    arp.reconfigure(config({ style: 'up', octaves: 3 }));
    expect(arp.entryStepAt(7, chord(0, 3))).toBe(7);
  });

  it('is -1 with no chord', () => {
    expect(new Arpeggiator(sampler, config()).entryStepAt(2, null)).toBe(-1);
  });
});

describe('arpCellPitch', () => {
  const list = arpNoteList(sampler, config(), chord(0, 3));

  it('is the ordered walk at the cell, with its octave shift', () => {
    expect(arpCellPitch('up', 4, list, 0)).toBe(list[4]);
    expect(arpCellPitch('down', 0, list, 0)).toBe(list[5]);
    expect(arpCellPitch('converge', 1, list, -1)).toBe(list[5]! - SEMITONES_PER_OCTAVE);
    // The bounce comes back down: cell 7 of 10 is list index 3.
    expect(arpCellPitch('upDown', 7, list, 0)).toBe(list[3]);
  });

  it('keeps the unshifted pitch when the shift leaves MIDI', () => {
    expect(arpCellPitch('up', 0, [120], 2)).toBe(120);
  });

  it('is unknown for a random style over more than one note, known over one', () => {
    for (const style of ['random', 'randomOther', 'randomOnce'] as const) {
      expect(arpCellPitch(style, 0, list, 0)).toBeNull();
      expect(arpCellPitch(style, 3, [60], 1)).toBe(72);
    }
    expect(arpCellPitch('up', 0, [], 0)).toBeNull();
  });
});
