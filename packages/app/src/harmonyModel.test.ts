/**
 * The Harmony tab's event list (#705): every edit keeps the list contiguous
 * from tick 0 and inside the song, so what reaches `ctx.change` is what the
 * normaliser would make of it, and a round trip through `makeArrangement`
 * reports nothing.
 */
import { describe, expect, it } from 'vitest';

import type { HarmonyEvent } from '../../../packages/client/src/audio/index-for-editor';
import { PPQ, TICKS_PER_BAR } from '../../../packages/client/src/audio/index-for-editor';
import {
  appendEvent,
  barsBeats,
  relay,
  removeEvent,
  setDegree,
  setDuration,
  setSize,
  toTicks,
} from './harmonyModel';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
const TWO: HarmonyEvent[] = [
  { start: 0, duration: 2 * BAR, degree: 0, size: 3 },
  { start: 2 * BAR, duration: 2 * BAR, degree: 5, size: 3 },
];

describe('harmonyModel', () => {
  it('shows a duration as bars and beats and reads it back', () => {
    expect(barsBeats(2 * BAR + PPQ)).toEqual({ bars: 2, beats: 1 });
    expect(toTicks(2, 1)).toBe(2 * BAR + PPQ);
    expect(toTicks(-1, 7)).toBe(7 * PPQ);
  });

  it('relays starts from durations, the last event running to the song end', () => {
    expect(relay([{ ...TWO[0]!, duration: BAR }, TWO[1]!], SONG)).toEqual([
      { ...TWO[0]!, duration: BAR },
      { ...TWO[1]!, start: BAR, duration: 3 * BAR },
    ]);
    // A shorter song clamps; an event pushed past the end is dropped.
    expect(relay(TWO, 3 * BAR)).toEqual([TWO[0]!, { ...TWO[1]!, duration: BAR }]);
    expect(relay(TWO, 2 * BAR)).toEqual([TWO[0]!]);
  });

  it('sets a degree or a size on one event and nothing else', () => {
    expect(setDegree(TWO, 1, 3)[1]).toMatchObject({ degree: 3, start: 2 * BAR });
    expect(setDegree(TWO, 1, 3)[0]).toBe(TWO[0]);
    expect(setSize(TWO, 0, 4)[0]).toMatchObject({ size: 4 });
  });

  it('a duration edit moves what follows, holds at least a beat and never leaves the song', () => {
    expect(setDuration(TWO, 0, BAR, SONG)).toEqual([
      { ...TWO[0]!, duration: BAR },
      { ...TWO[1]!, start: BAR, duration: 3 * BAR },
    ]);
    expect(setDuration(TWO, 0, 0, SONG)[0]).toMatchObject({ duration: PPQ });
    expect(setDuration(TWO, 0, 5 * BAR, SONG)).toEqual([{ ...TWO[0]!, duration: SONG }]);
  });

  it('removes an event into the one before it, so later chords keep their bars; the first goes to the next', () => {
    expect(removeEvent(TWO, 1, SONG)).toEqual([{ ...TWO[0]!, duration: SONG }]);
    expect(removeEvent(TWO, 0, SONG)).toEqual([{ ...TWO[1]!, start: 0, duration: SONG }]);
    expect(removeEvent([TWO[0]!], 0, SONG)).toEqual([TWO[0]!]);
    // C bar 1, F bar 2, G bars 3–4: deleting F leaves C holding through bar 2 and G where it was.
    const three: HarmonyEvent[] = [
      { start: 0, duration: BAR, degree: 0, size: 3 },
      { start: BAR, duration: BAR, degree: 3, size: 3 },
      { start: 2 * BAR, duration: 2 * BAR, degree: 4, size: 3 },
    ];
    expect(removeEvent(three, 1, SONG)).toEqual([{ ...three[0]!, duration: 2 * BAR }, three[2]!]);
    expect(removeEvent(three, 0, SONG)).toEqual([
      { ...three[1]!, start: 0, duration: 2 * BAR },
      three[2]!,
    ]);
  });

  it('appends a chord out of the last one’s bars, and refuses when a beat cannot be spared', () => {
    expect(appendEvent(TWO, SONG)).toEqual([
      TWO[0]!,
      { ...TWO[1]!, duration: BAR },
      { ...TWO[1]!, start: 3 * BAR, duration: BAR },
    ]);
    const short = [{ start: 0, duration: 3 * PPQ, degree: 0, size: 3 as const }];
    expect(appendEvent(short, 3 * PPQ)).toEqual([
      { ...short[0]!, duration: 2 * PPQ },
      { ...short[0]!, start: 2 * PPQ, duration: PPQ },
    ]);
    const beat = [{ start: 0, duration: PPQ, degree: 0, size: 3 as const }];
    expect(appendEvent(beat, PPQ)).toEqual(beat);
    expect(appendEvent([], SONG)).toEqual([{ start: 0, duration: SONG, degree: 0, size: 3 }]);
  });
});
