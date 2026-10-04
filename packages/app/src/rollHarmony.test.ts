/**
 * How the Roll reads the harmony (windsor#602 decisions 5–7), over the
 * mockup's example: Am F C G Am F Dm E in A minor, a bar each.
 */
import { describe, expect, it } from 'vitest';
import type { Harmony, HarmonyEvent } from '@windsor/engine';
import { chordLabel, chordSpans, keyName, noteTier, tierOf, tonesAt } from './rollHarmony';
import { rollInstances } from './rollRepeats';
import { instanceLook } from './rollNoteLook';

const BAR = 96;
const DEGREES = [0, 5, 2, 6, 0, 5, 3, 4];
const events: HarmonyEvent[] = DEGREES.map((degree, i) => ({
  start: i * BAR,
  duration: BAR,
  degree,
  size: 3,
  ...(i === 7 ? { quality: 'maj' as const } : {}),
}));
const HARMONY: Harmony = { root: 9, scale: 'naturalMinor', events };
const SONG = 8 * BAR;

describe('tiers', () => {
  it('measures a pitch against the chord at a tick: root, chord tone, scale tone, outside', () => {
    const { tones } = tonesAt(HARMONY, SONG, 0);
    expect(tierOf(57, tones)).toBe('root');
    expect(tierOf(60, tones)).toBe('chord');
    expect(tierOf(64, tones)).toBe('chord');
    expect(tierOf(71, tones)).toBe('scale');
    expect(tierOf(65, tones)).toBe('scale');
    expect(tierOf(68, tones)).toBe('out');
    expect(noteTier(57, tones)).toBe('chord');
  });

  it('reads each tick on its own chord: C at bar 3, G at bar 4, a borrowed E major at bar 8', () => {
    const at = (bar: number) => tonesAt(HARMONY, SONG, bar * BAR + 10);
    expect(at(2).tones.rootPc).toBe(0);
    expect(at(3).tones.rootPc).toBe(7);
    expect(tierOf(80, at(7).tones)).toBe('chord');
    expect(chordLabel(HARMONY, at(3).chord)).toBe('G maj');
  });

  it('with no chord, measures against the scale alone', () => {
    const { chord, tones } = tonesAt({ ...HARMONY, events: [] }, SONG, 0);
    expect(chord).toBeNull();
    expect(tierOf(57, tones)).toBe('scale');
    expect(tierOf(68, tones)).toBe('out');
  });

  it("colours the loop's G♯ out of key over G in bar 4 and a chord tone in its repeat over E", () => {
    const notes = [{ tick: 360, ticks: 24, pitch: 80, velocity: 0.85 }];
    const [first, ghost] = rollInstances(notes, {
      loopTicks: 4 * BAR,
      regionTicks: 8 * BAR,
      within: { from: 0, to: 8 * BAR },
    });
    const row = { pitch: 80, top: 0, h: 7, thin: false };
    const place = { harmony: HARMONY, songTicks: SONG, regionStart: 0 };
    expect(instanceLook(notes[0] as (typeof notes)[0], first!, row, place)).toBe('out');
    expect(ghost?.start).toBe(744);
    expect(instanceLook(notes[0] as (typeof notes)[0], ghost!, row, place)).toBe('chord');
    expect(instanceLook(notes[0] as (typeof notes)[0], first!, { ...row, thin: true }, place)).toBe(
      'grey',
    );
  });
});

describe('chordSpans', () => {
  it('cuts the harmony to the region, in its local ticks', () => {
    const spans = chordSpans(HARMONY, SONG, 2 * BAR + 48, 2 * BAR);
    expect(spans.map((s) => [s.start, s.end, s.name])).toEqual([
      [0, 48, 'C maj'],
      [48, 144, 'G maj'],
      [144, 192, 'A min'],
    ]);
  });
});

describe('keyName', () => {
  it('names the key as the summary does', () => {
    expect(keyName(HARMONY)).toBe('A minor');
    expect(keyName({ ...HARMONY, root: 0, scale: [0, 2, 4] })).toBe('C custom scale');
  });
});
