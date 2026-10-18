/**
 * The keyboard's fold as it stands (windsor#919, record
 * `2026-10-18-keyboard-fold`), on the record's demo song: A minor, four
 * bars of A min, F maj, C maj and G 7. The keys at octave 3 (15 on Scale; 7,
 * 7, 7 and 9 on Chord), the strip Scale draws, and the signature the frame
 * watch rebuilds on.
 */
import { describe, expect, it } from 'vitest';

import type { ArrangementDocument, ChordSize, HarmonyEvent } from '@windsor/engine';
import { CHORD_SIZE_SEVENTH, CHORD_SIZE_TRIAD } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { type PartFold, foldedKeys } from './keyboardFold';
import { foldKeyName } from './keyboardKeys';
import { foldNowOf, foldSignature, partFoldOf, rowSlotsOf, setSignature } from './keyboardFoldNow';
import { whiteSlots } from './keyboardLayout';
import { newSong } from './songParts';

const BAR = 96;
const event = (bar: number, degree: number, size: ChordSize = CHORD_SIZE_TRIAD): HarmonyEvent => ({
  start: bar * BAR,
  duration: BAR,
  degree,
  size,
});

/** The demo song with its one part folded to `fold`. */
function demo(fold: PartFold): ArrangementDocument {
  const model = new DocumentModel(newSong());
  model.merge({
    transport: { bars: 4 },
    harmony: {
      root: 9,
      scale: 'naturalMinor',
      events: [event(0, 0), event(1, 5), event(2, 2), event(3, 6, CHORD_SIZE_SEVENTH)],
    },
    parts: { 0: { fold } },
  });
  return model.doc;
}

/** The names of the keys two octaves at octave 3 show for `fold` at `tick`. */
function names(fold: PartFold, tick: number): string[] {
  const now = foldNowOf(demo(fold), 0, tick);
  if (!now) return [];
  const keys = foldedKeys(now.set, { octave: 3, octaves: 2, rows: 1 });
  return keys.rows.flat().map(foldKeyName);
}

describe('the keyboard’s fold as it stands', () => {
  it('is nothing for a part on Off, or a slot with no part', () => {
    expect(foldNowOf(demo('off'), 0, 0)).toBeNull();
    expect(foldNowOf(demo('scale'), 5, 0)).toBeNull();
    expect(partFoldOf(null)).toBe('off');
    expect(rowSlotsOf(null)).toBe(whiteSlots);
  });

  it('shows 15 keys from A3 to A5 on Scale, the roots named with their octave', () => {
    expect(names('scale', 0)).toEqual('A3 B C D E F G A4 B C D E F G A5'.split(' '));
    expect(rowSlotsOf(foldNowOf(demo('scale'), 0, 0))({ octaves: 2, rows: 1 })).toBe(15);
  });

  it('shows 7 keys under A min and F maj and 9 under G 7 on Chord, renamed at each change', () => {
    expect(names('chord', 0)).toEqual('A3 C E A4 C E A5'.split(' '));
    expect(names('chord', BAR)).toEqual('F3 A C F4 A C F5'.split(' '));
    expect(names('chord', 2 * BAR)).toEqual('C3 E G C4 E G C5'.split(' '));
    expect(names('chord', 3 * BAR)).toEqual('G3 B D F G4 B D F G5'.split(' '));
  });

  it('strips the chord’s tones on Scale only', () => {
    expect([...(foldNowOf(demo('scale'), 0, BAR)?.strip ?? [])].sort((a, b) => a - b)).toEqual([
      0, 5, 9,
    ]);
    expect(foldNowOf(demo('chord'), 0, BAR)?.strip.size).toBe(0);
  });

  it('signs what the keys show: Chord’s set moves at a change, Scale’s strip does, its set does not', () => {
    const at = (fold: PartFold, tick: number): ReturnType<typeof foldNowOf> =>
      foldNowOf(demo(fold), 0, tick);
    expect(setSignature(at('chord', 0))).not.toBe(setSignature(at('chord', BAR)));
    expect(setSignature(at('chord', 0))).toBe(setSignature(at('chord', BAR - 1)));
    expect(setSignature(at('scale', 0))).toBe(setSignature(at('scale', BAR)));
    expect(foldSignature(at('scale', 0))).not.toBe(foldSignature(at('scale', BAR)));
    expect(setSignature(at('scale', 0))).not.toBe(setSignature(at('chord', 0)));
    expect([setSignature(null), foldSignature(null)]).toEqual([0, 0]);
  });
});
