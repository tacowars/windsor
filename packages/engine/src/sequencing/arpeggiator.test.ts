/**
 * The Arpeggiator (#706): the nine traversals over a C-minor triad × 2
 * octaves (L = 6), their degenerate lists, the lifted voicing cap, one
 * voicing vocabulary with the Chord Player, retrigger across a chord change,
 * the seeded stream and the gate. Driven tick by tick as the region gate
 * would; the player path is `song/arrangementPlayerArp.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { MIDI_NOTE_MAX } from '../audioConstants';
import { chordAt, type Harmony, type HarmonyChord } from '../harmony/harmonyTimeline';
import { DEFAULT_CHORD_CONFIG, voiceHit } from './chordSequencer';
import { DEFAULT_ARP_CONFIG, type ArpSequencerConfig, type ArpStyle } from './arpSequencer';
import {
  Arpeggiator,
  arpNoteList,
  orderedIndex,
  otherIndex,
  shuffledIndices,
  type OrderedArpStyle,
} from './arpeggiator';
import { streamRng } from './generatorSeed';
import type { NoteEvent } from './noteEvent';
import { SEMITONES_PER_OCTAVE, ScaleSampler } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR } from './scheduler';

const BAR = TICKS_PER_BAR;
const QUARTER = DIVISORS.quarter;
const SONG = 4 * BAR;
const MINOR = { root: 0, scale: 'naturalMinor' } as const;
const sampler = new ScaleSampler(MINOR);
/** i for the whole song. */
const TONIC: Harmony = { ...MINOR, events: [{ start: 0, duration: SONG, degree: 0, size: 3 }] };
/** i for two bars, then VI. */
const I_VI: Harmony = {
  ...MINOR,
  events: [
    { start: 0, duration: 2 * BAR, degree: 0, size: 3 },
    { start: 2 * BAR, duration: 2 * BAR, degree: 5, size: 3 },
  ],
};
const chord = (harmony: Harmony, tick = 0): HarmonyChord => chordAt(harmony, SONG, tick)!;

const arpConfig = (over: Partial<ArpSequencerConfig> = {}): ArpSequencerConfig => ({
  ...DEFAULT_ARP_CONFIG,
  divisor: QUARTER,
  octaves: 2,
  gate: 1,
  ...over,
});

/** Run `ticks` local ticks through `arp` under `harmony`; every event it emitted. */
function drive(arp: Arpeggiator, harmony: Harmony, ticks: number, from = 0): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (let tick = from; tick < from + ticks; tick++) {
    events.push(
      ...arp.handleTick({
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
  return events;
}
const ons = (events: readonly NoteEvent[]): number[] =>
  events.filter((e) => e.kind === 'noteOn').map((e) => e.note);
/** The notes of the first `steps` onsets of a fresh arp. */
const line = (over: Partial<ArpSequencerConfig>, steps = 12, harmony = TONIC): number[] => {
  const config = arpConfig(over);
  return ons(drive(new Arpeggiator(sampler, config), harmony, steps * config.divisor));
};

const c4 = sampler.rootNote(DEFAULT_ARP_CONFIG.register.octave);
const CM = [0, 3, 7].map((o) => c4 + o);
const LIST = [...CM, ...CM.map((n) => n + SEMITONES_PER_OCTAVE)];

describe('the note list', () => {
  it('is the C-minor triad voiced at the register and duplicated up one octave (L = 6)', () => {
    expect(arpNoteList(sampler, arpConfig(), chord(TONIC))).toEqual(LIST);
  });

  it('octaves 1 is the voiced stack only', () => {
    expect(arpNoteList(sampler, arpConfig({ octaves: 1 }), chord(TONIC))).toEqual(CM);
  });

  it('a seventh × 4 octaves yields 16 notes — the six-note cap is lifted', () => {
    const seventh: Harmony = { ...MINOR, events: [{ ...TONIC.events[0]!, size: 4 }] };
    const list = arpNoteList(sampler, arpConfig({ octaves: 4 }), chord(seventh));
    expect(list).toHaveLength(4 * 4);
    expect(new Set(list).size).toBe(list.length);
  });

  it('drop2 voices exactly what the Chord Player voices at the same register (one vocabulary)', () => {
    const seventh: Harmony = { ...MINOR, events: [{ ...TONIC.events[0]!, size: 4 }] };
    const register = { octave: DEFAULT_ARP_CONFIG.register.octave };
    const hit = voiceHit(
      sampler,
      { ...DEFAULT_CHORD_CONFIG, voicing: 'drop2', register },
      { inversion: 0, octave: 0 },
      chord(seventh),
    );
    const arp = arpNoteList(sampler, arpConfig({ voicing: 'drop2', octaves: 1 }), chord(seventh));
    expect(arp).toEqual(hit);
    expect(arp).not.toEqual(arpNoteList(sampler, arpConfig({ octaves: 1 }), chord(seventh)));
  });
});

describe('the MIDI range is clipped once, after the octave expansion (#714 review)', () => {
  const [C, EB, G] = [0, 3, 7];
  const drop2 = (octave: number) =>
    arpNoteList(sampler, arpConfig({ voicing: 'drop2', register: { octave } }), chord(TONIC));
  /** drop2 of C–E♭–G drops E♭ an octave — [E♭−12, C, G] — plus its copy an octave up, clipped once. */
  const expectedAt = (root: number): number[] => {
    const unclipped = [root + EB - SEMITONES_PER_OCTAVE, root + C, root + G];
    const expanded = [...unclipped, ...unclipped.map((n) => n + SEMITONES_PER_OCTAVE)];
    return expanded.filter((n) => n >= 0 && n <= MIDI_NOTE_MAX).sort((a, b) => a - b);
  };

  it('register −1, drop2, 2 octaves keeps the E♭ the voicing dropped below 0', () => {
    const root = sampler.rootNote(-1);
    expect(drop2(-1)).toEqual(expectedAt(root));
    expect(drop2(-1)).toContain(root + EB);
  });

  it('register 9, drop2, 2 octaves keeps every in-range tone and nothing above 127', () => {
    const root = sampler.rootNote(9);
    expect(drop2(9)).toEqual(expectedAt(root));
    expect(Math.max(...drop2(9))).toBeLessThanOrEqual(MIDI_NOTE_MAX);
  });

  it('C major, degree 42 (six octaves up), register 0, close, 1 octave is the triad, not silence', () => {
    const major = new ScaleSampler({ root: 0, scale: 'major' });
    const harmony: Harmony = {
      root: 0,
      scale: 'major',
      events: [{ start: 0, duration: SONG, degree: 42, size: 3 }],
    };
    const config = arpConfig({ voicing: 'close', octaves: 1, register: { octave: 0 } });
    const top = major.rootNote(0) + 6 * SEMITONES_PER_OCTAVE;
    expect(arpNoteList(major, config, chord(harmony))).toEqual([top, top + 4, top + 7]);
    expect(arpNoteList(major, config, chord(harmony))).toEqual([84, 88, 91]);
  });

  it('the one-degree [0] scale keeps note 120 from a seventh at register 3', () => {
    const unison = new ScaleSampler({ root: 0, scale: [0] });
    const harmony: Harmony = {
      root: 0,
      scale: [0],
      events: [{ start: 0, duration: SONG, degree: 0, size: 4 }],
    };
    const config = arpConfig({ voicing: 'close', octaves: 1, register: { octave: 3 } });
    const root = unison.rootNote(3);
    const expected = [0, 2, 4, 6].map((k) => root + k * SEMITONES_PER_OCTAVE);
    expect(arpNoteList(unison, config, chord(harmony))).toEqual(expected);
    expect(arpNoteList(unison, config, chord(harmony))).toContain(120);
  });
});

describe('the ordered styles over L = 6, first 12 steps', () => {
  const expected: Record<OrderedArpStyle, number[]> = {
    up: [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5],
    down: [5, 4, 3, 2, 1, 0, 5, 4, 3, 2, 1, 0],
    upDown: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1],
    downUp: [5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4],
    converge: [0, 5, 1, 4, 2, 3, 0, 5, 1, 4, 2, 3],
    diverge: [3, 2, 4, 1, 5, 0, 3, 2, 4, 1, 5, 0],
    conDiverge: [0, 5, 1, 4, 2, 3, 2, 4, 1, 5, 0, 5],
  };
  it.each(Object.entries(expected))('%s', (style, indices) => {
    expect(line({ style: style as ArpStyle })).toEqual(indices.map((i) => LIST[i]));
  });
});

describe('conDiverge over L = 4', () => {
  it('turns at the centre and the edge without repeating either', () => {
    const cycle = [0, 1, 2, 3, 4, 5, 6].map((i) => orderedIndex('conDiverge', i, 4));
    expect(cycle).toEqual([0, 3, 1, 2, 1, 3, 0]);
  });
});

describe('the degenerate lists', () => {
  const ordered: OrderedArpStyle[] = [
    'up',
    'down',
    'upDown',
    'downUp',
    'converge',
    'diverge',
    'conDiverge',
  ];
  const walk = (style: OrderedArpStyle, length: number): number[] =>
    [0, 1, 2, 3].map((i) => orderedIndex(style, i, length));

  it('L = 1: every ordered style plays the one note, and randomOther repeats it', () => {
    for (const style of ordered) expect(walk(style, 1), style).toEqual([0, 0, 0, 0]);
    expect(otherIndex([c4], c4, streamRng(1, 0))).toBe(0);
  });

  it('L = 2: upDown / downUp are up / down, converge and diverge are one pass each way', () => {
    expect(walk('upDown', 2)).toEqual(walk('up', 2));
    expect(walk('downUp', 2)).toEqual(walk('down', 2));
    expect(walk('converge', 2)).toEqual([0, 1, 0, 1]);
    expect(walk('diverge', 2)).toEqual([1, 0, 1, 0]);
  });

  it('L = 2: conDiverge is converge', () => {
    expect(walk('conDiverge', 2)).toEqual(walk('converge', 2));
    expect(walk('conDiverge', 2)).toEqual([0, 1, 0, 1]);
  });

  it('L = 2: randomOther alternates', () => {
    const rng = streamRng(3, 0);
    const pair = [c4, c4 + SEMITONES_PER_OCTAVE];
    let previous: number | null = null;
    for (let step = 0; step < 8; step++) {
      const note: number = pair[otherIndex(pair, previous, rng)]!;
      if (previous !== null) expect(note).not.toBe(previous);
      previous = note;
    }
  });
});

describe('the random styles, pinned to a seed', () => {
  const seed = 42;

  it('random: one uniform draw per step from the stream', () => {
    const rng = streamRng(seed, 0);
    const expected = Array.from({ length: 12 }, () => LIST[Math.floor(rng() * LIST.length)]);
    expect(line({ style: 'random', seed })).toEqual(expected);
  });

  it('randomOther never repeats a note consecutively over 200 steps', () => {
    const notes = line({ style: 'randomOther', seed, divisor: DIVISORS.sixteenth }, 200);
    expect(notes).toHaveLength(200);
    for (let i = 1; i < notes.length; i++) expect(notes[i]).not.toBe(notes[i - 1]);
    expect(new Set(notes)).toEqual(new Set(LIST));
  });

  it('randomOnce repeats its first 6-note order exactly — one seeded shuffle', () => {
    const notes = line({ style: 'randomOnce', seed });
    const order = shuffledIndices(LIST.length, streamRng(seed, 0));
    expect(notes.slice(0, 6)).toEqual(order.map((i) => LIST[i]));
    expect(notes.slice(6)).toEqual(notes.slice(0, 6));
    expect([...notes.slice(0, 6)].sort((a, b) => a - b)).toEqual(LIST);
  });
});

describe('a chord change i → VI at bar 2 (quarter notes: step 8 is the first VI step)', () => {
  const vi = arpNoteList(sampler, arpConfig(), chord(I_VI, 2 * BAR));
  const firstVi = (2 * BAR) / QUARTER;

  it('retrigger off: the index carries on — step 8 plays n[2] of the new list', () => {
    const notes = line({ style: 'up', retrigger: false }, 10, I_VI);
    expect(notes[firstVi]).toBe(vi[firstVi % vi.length]);
    expect(notes[firstVi + 1]).toBe(vi[(firstVi + 1) % vi.length]);
  });

  it('retrigger on: step 8 plays n[0]', () => {
    const notes = line({ style: 'up', retrigger: true }, 10, I_VI);
    expect(notes[firstVi]).toBe(vi[0]);
    expect(notes[firstVi + 1]).toBe(vi[1]);
  });

  it('the note held across the boundary keeps its pitch: its off names the old note', () => {
    const events = drive(new Arpeggiator(sampler, arpConfig()), I_VI, 2 * BAR + 1);
    const atBoundary = events.filter((e) => e.tick === 2 * BAR);
    expect(atBoundary.map((e) => [e.kind, e.note])).toEqual([
      ['noteOff', LIST[(firstVi - 1) % LIST.length]],
      ['noteOn', vi[firstVi % vi.length]],
    ]);
  });
});

describe('a chord clipped to an empty pool is still a chord change (#714 review)', () => {
  const major = new ScaleSampler({ root: 0, scale: 'major' });
  /** C major I → vi → I, a bar each: at register 9 the vi (A–C–E) lies wholly above 127. */
  const I_vi_I: Harmony = {
    root: 0,
    scale: 'major',
    events: [
      { start: 0, duration: BAR, degree: 0, size: 3 },
      { start: BAR, duration: BAR, degree: 5, size: 3 },
      { start: 2 * BAR, duration: 2 * BAR, degree: 0, size: 3 },
    ],
  };
  const over = { style: 'up', voicing: 'close', register: { octave: 9 } } as const;
  const pool = arpNoteList(major, arpConfig(over), chord(I_vi_I));
  const returning = (2 * BAR) / QUARTER;
  /** The note the returning I's first onset plays. */
  const firstReturning = (retrigger: boolean): number | undefined => {
    const arp = new Arpeggiator(major, arpConfig({ ...over, retrigger }));
    return drive(arp, I_vi_I, 2 * BAR + 1).find((e) => e.kind === 'noteOn' && e.tick === 2 * BAR)
      ?.note;
  };

  it('the pools are [120, 124, 127], [], [120, 124, 127]', () => {
    expect(pool).toEqual([120, 124, 127]);
    expect(arpNoteList(major, arpConfig(over), chord(I_vi_I, BAR))).toEqual([]);
  });

  it('retrigger on: the returning I restarts at n[0] (120)', () => {
    expect(firstReturning(true)).toBe(pool[0]);
  });

  it('retrigger off: the index carries on through the silent bar — n[8 mod 3] = n[2] (127)', () => {
    expect(firstReturning(false)).toBe(pool[returning % pool.length]);
  });
});

describe('the seed and the stream', () => {
  it('same seed ⇒ identical line from two fresh instances; a different seed ⇒ a different line', () => {
    expect(line({ style: 'random', seed: 7 })).toEqual(line({ style: 'random', seed: 7 }));
    expect(line({ style: 'random', seed: 8 })).not.toEqual(line({ style: 'random', seed: 7 }));
  });

  it('region re-entry restarts the line and the stream', () => {
    const arp = new Arpeggiator(sampler, arpConfig({ style: 'random', seed: 5 }));
    arp.enter(0);
    const first = ons(drive(arp, TONIC, 12 * QUARTER));
    arp.enter(0);
    expect(ons(drive(arp, TONIC, 12 * QUARTER))).toEqual(first);
    arp.enter(1);
    expect(ons(drive(arp, TONIC, 12 * QUARTER))).not.toEqual(first);
  });

  it('a chord change never restarts the stream', () => {
    const acrossChange = line({ style: 'random', seed: 9, octaves: 1 }, 12, I_VI);
    const rng = streamRng(9, 0);
    const draws = acrossChange.map(() => Math.floor(rng() * CM.length));
    const lists = [0, 2 * BAR].map((t) =>
      arpNoteList(sampler, arpConfig({ octaves: 1 }), chord(I_VI, t)),
    );
    const firstVi = (2 * BAR) / QUARTER;
    expect(acrossChange).toEqual(draws.map((d, step) => lists[step < firstVi ? 0 : 1]![d]));
  });
});

describe('the gate', () => {
  const sixteenth = DIVISORS.sixteenth;

  it('gate 0.5 at divisor 6: each note-off lands 3 ticks after its on', () => {
    const events = drive(
      new Arpeggiator(sampler, arpConfig({ gate: 0.5, divisor: sixteenth })),
      TONIC,
      BAR,
    );
    const on = events.filter((e) => e.kind === 'noteOn');
    const off = events.filter((e) => e.kind === 'noteOff');
    expect(on).toHaveLength(BAR / sixteenth);
    expect(off.map((e) => e.tick)).toEqual(on.map((e) => e.tick + sixteenth * 0.5));
    expect(off.map((e) => e.note)).toEqual(on.map((e) => e.note));
  });

  it('gate 1 ties nothing: every onset after the first releases and restrikes, even the same pitch', () => {
    const cfg = arpConfig({ gate: 1, divisor: sixteenth, octaves: 1, style: 'random', seed: 1 });
    const events = drive(new Arpeggiator(sampler, cfg), TONIC, BAR);
    for (let step = 1; step < BAR / sixteenth; step++) {
      const at = events.filter((e) => e.tick === step * sixteenth).map((e) => e.kind);
      expect(at, `step ${step}`).toEqual(['noteOff', 'noteOn']);
    }
    const notes = ons(events);
    expect(notes.some((n, i) => i > 0 && n === notes[i - 1])).toBe(true);
  });

  it('release sends the held note its off, once', () => {
    const arp = new Arpeggiator(sampler, arpConfig());
    drive(arp, TONIC, 1);
    expect(arp.release(1, 1).map((e) => [e.kind, e.note])).toEqual([['noteOff', LIST[0]]]);
    expect(arp.release(2, 2)).toEqual([]);
  });

  it('no chord, no note', () => {
    const silent: Harmony = { ...MINOR, events: [] };
    expect(drive(new Arpeggiator(sampler, arpConfig()), silent, BAR)).toEqual([]);
  });
});
