/**
 * A chromatic harmony event under every pitched performer (windsor#330
 * decision 3): the Chord Player, the Arpeggiator and the Bass all read the
 * chord's `stack`, so a named quality and an accidental reach each of them
 * without a second rule; and the arp's retrigger counts a change of quality
 * or accidental as a chord change, but not a change of key (decision 4).
 */
import { describe, expect, it } from 'vitest';

import { chordAt, type Harmony, type HarmonyEvent } from '../harmony/harmonyTimeline';
import { DEFAULT_ARP_CONFIG, type ArpSequencerConfig } from './arpSequencer';
import { Arpeggiator, arpNoteList } from './arpeggiator';
import { BassSequencer, DEFAULT_BASS_CONFIG, type BassSequencerConfig } from './bassSequencer';
import { DEFAULT_CHORD_CONFIG, voiceHit } from './chordSequencer';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import { ScaleSampler } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR } from './scheduler';

const BAR = TICKS_PER_BAR;
const QUARTER = DIVISORS.quarter;
const SONG = 4 * BAR;
const C_MAJOR = { root: 0, scale: 'major' } as const;
const major = new ScaleSampler(C_MAJOR);

const whole = (fields: Partial<HarmonyEvent>): HarmonyEvent => ({
  start: 0,
  duration: SONG,
  degree: 0,
  size: 3,
  ...fields,
});
const holding = (event: HarmonyEvent, key: Omit<Harmony, 'events'> = C_MAJOR): Harmony => ({
  ...key,
  events: [event],
});

/** ♭I major in C: B D♯ F♯. */
const FLAT_ONE = holding(whole({ quality: 'maj', accidental: -1 }));
const B4_TRIAD = [59, 63, 66];

describe('the Chord Player voices the stack (decision 3)', () => {
  const hit = { inversion: 0, octave: 0 };
  const at = (octave: number) => ({
    ...DEFAULT_CHORD_CONFIG,
    voicing: 'close' as const,
    register: { octave },
  });

  it('plays ♭I major in C as B D♯ F♯ at octave 4', () => {
    expect(voiceHit(major, at(4), hit, chordAt(FLAT_ONE, SONG, 0)!)).toEqual(B4_TRIAD);
  });

  it('drops a flattened root below MIDI 0 at register −1 rather than clamping it', () => {
    expect(voiceHit(major, at(-1), hit, chordAt(FLAT_ONE, SONG, 0)!)).toEqual([3, 6]);
  });

  it('plays a diatonic event exactly as the scale’s own chord', () => {
    const plain = chordAt(holding(whole({ degree: 4 })), SONG, 0)!;
    expect(voiceHit(major, at(4), hit, plain)).toEqual([67, 71, 74]);
  });
});

describe('the Arpeggiator lists the stack (decision 3)', () => {
  const arpConfig = (over: Partial<ArpSequencerConfig> = {}): ArpSequencerConfig => ({
    ...DEFAULT_ARP_CONFIG,
    voicing: 'close',
    divisor: QUARTER,
    octaves: 1,
    gate: 1,
    register: { octave: 4 },
    ...over,
  });

  it('lists ♭I major’s tones', () => {
    expect(arpNoteList(major, arpConfig(), chordAt(FLAT_ONE, SONG, 0)!)).toEqual(B4_TRIAD);
  });

  /** The notes of the arp's onsets over `steps` quarters, the harmony read at each tick from `harmonyAt`. */
  const walk = (harmonyAt: (tick: number) => Harmony, steps: number): number[] => {
    const arp = new Arpeggiator(major, arpConfig({ style: 'up', octaves: 2, retrigger: true }));
    const events: NoteEvent[] = [];
    for (let tick = 0; tick < steps * QUARTER; tick++) {
      events.push(
        ...arp.handleTick({
          tick,
          step: tick,
          bar: Math.floor(tick / BAR),
          tickInBar: tick % BAR,
          seconds: 0,
          secondsPerTick: 0,
          time: tick,
          chord: chordAt(harmonyAt(tick), SONG, tick),
          regionIndex: 0,
        }),
      );
    }
    return events.filter((e): e is NoteOnEvent => e.kind === 'noteOn').map((e) => e.note);
  };
  const changeAt = (2 * BAR) / QUARTER;

  it('restarts when only the quality changes between two events of one degree and size', () => {
    // C major's I, then I named `aug` (C E G♯): same degree, same size.
    const harmony: Harmony = {
      ...C_MAJOR,
      events: [
        { start: 0, duration: 2 * BAR, degree: 0, size: 3 },
        { start: 2 * BAR, duration: 2 * BAR, degree: 0, size: 3, quality: 'aug' },
      ],
    };
    const augmented = arpNoteList(
      major,
      arpConfig({ octaves: 2 }),
      chordAt(harmony, SONG, 2 * BAR)!,
    );
    const notes = walk(() => harmony, changeAt + 2);
    expect(notes[changeAt]).toBe(augmented[0]);
    expect(notes[changeAt + 1]).toBe(augmented[1]);
  });

  it('restarts when only the accidental changes', () => {
    const harmony: Harmony = {
      ...C_MAJOR,
      events: [
        { start: 0, duration: 2 * BAR, degree: 3, size: 3 },
        { start: 2 * BAR, duration: 2 * BAR, degree: 3, size: 3, accidental: 1 },
      ],
    };
    const sharp = arpNoteList(major, arpConfig({ octaves: 2 }), chordAt(harmony, SONG, 2 * BAR)!);
    expect(walk(() => harmony, changeAt + 1)[changeAt]).toBe(sharp[0]);
  });

  it('does not restart on a key change: the walk carries on into the new list', () => {
    const before = holding(whole({}));
    const after = holding(whole({}), { root: 0, scale: 'naturalMinor' });
    const minorList = arpNoteList(major, arpConfig({ octaves: 2 }), chordAt(after, SONG, 0)!);
    const notes = walk((tick) => (tick < 2 * BAR ? before : after), changeAt + 1);
    expect(minorList[0]).not.toBe(minorList[changeAt % minorList.length]);
    expect(notes[changeAt]).toBe(minorList[changeAt % minorList.length]);
  });
});

describe('the Bass reads the stack (decision 3)', () => {
  const OCTAVE = 2;
  const C2 = major.rootNote(OCTAVE);
  const bass = (over: Partial<BassSequencerConfig>): BassSequencer =>
    new BassSequencer(major, {
      ...DEFAULT_BASS_CONFIG,
      divisor: QUARTER,
      density: 1,
      register: { octave: OCTAVE },
      ...over,
    });
  const play = (seq: BassSequencer, harmony: Harmony, steps: number): NoteOnEvent[] => {
    const events: NoteEvent[] = [];
    for (let tick = 0; tick < steps * QUARTER; tick++) {
      events.push(
        ...seq.handleTick({
          tick,
          step: tick,
          bar: Math.floor(tick / BAR),
          tickInBar: tick % BAR,
          seconds: 0,
          secondsPerTick: 0,
          time: tick,
          chord: chordAt(harmony, SONG, tick),
          regionIndex: 0,
        }),
      );
    }
    return events.filter((e): e is NoteOnEvent => e.kind === 'noteOn');
  };

  it('followRoot plays B under ♭I major, and reports the event’s degree', () => {
    const notes = play(bass({ pitchMode: 'followRoot' }), FLAT_ONE, 4);
    expect(notes.map((e) => e.note)).toEqual([C2 - 1, C2 - 1, C2 - 1, C2 - 1]);
    expect(notes.every((e) => e.degree === 0)).toBe(true);
  });

  it('followChord draws its other tones from the moved stack: D♯ and F♯', () => {
    const notes = play(bass({ pitchMode: 'followChord', rootBias: 0 }), FLAT_ONE, 32);
    expect(new Set(notes.map((e) => e.note))).toEqual(new Set([C2 + 3, C2 + 6]));
  });

  it('followRoot under a diatonic event plays the scale degree as before', () => {
    const notes = play(bass({ pitchMode: 'followRoot' }), holding(whole({ degree: 5 })), 1);
    expect(notes.map((e) => e.note)).toEqual([major.noteForFolded(5, OCTAVE)]);
  });
});
