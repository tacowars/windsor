/**
 * The Arpeggiator playing its step grid (windsor#129, epic windsor#126):
 * accent over the style's cycle, the octave shift, tie, slide, rest, skip
 * chance and its own stream, the lanes, the cell across a chord change with
 * and without retrigger, and `stepAt`. Driven tick by tick as the region
 * gate would, over a C-minor triad at one octave (L = 3) unless it says
 * otherwise. The cell rules alone are `arpCellPlay.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { chordAt, type Harmony } from '../harmony/harmonyTimeline';
import { VOICE_TARGET_PATHS } from '../worklet/fm/voiceTargetTables';
import { DEFAULT_ARP_CONFIG, type ArpSequencerConfig } from './arpSequencer';
import { arpNote, defaultArpSteps, type ArpStep } from './arpSteps';
import { Arpeggiator, arpNoteList } from './arpeggiator';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import { SEMITONES_PER_OCTAVE, ScaleSampler } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR } from './scheduler';

const BAR = TICKS_PER_BAR;
const QUARTER = DIVISORS.quarter;
const SONG = 4 * BAR;
const MINOR = { root: 0, scale: 'naturalMinor' } as const;
const sampler = new ScaleSampler(MINOR);
const TONIC: Harmony = { ...MINOR, events: [{ start: 0, duration: SONG, degree: 0, size: 3 }] };
/** i (a triad, L = 3) for two bars, then VI7 (L = 4): quarter step 8 is the first VI7 step. */
const I_VI7: Harmony = {
  ...MINOR,
  events: [
    { start: 0, duration: 2 * BAR, degree: 0, size: 3 },
    { start: 2 * BAR, duration: 2 * BAR, degree: 5, size: 4 },
  ],
};
const TIE: ArpStep = { kind: 'tie' };
const REST: ArpStep = { kind: 'rest' };

/** The default cells with the given ones written over them. */
const cells = (written: Record<number, ArpStep>): ArpStep[] => {
  const steps = defaultArpSteps();
  for (const [k, cell] of Object.entries(written)) steps[Number(k)] = cell;
  return steps;
};
const arpConfig = (over: Partial<ArpSequencerConfig> = {}): ArpSequencerConfig => ({
  ...DEFAULT_ARP_CONFIG,
  divisor: QUARTER,
  octaves: 1,
  gate: 0.5,
  ...over,
});

function drive(arp: Arpeggiator, harmony: Harmony, ticks: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (let tick = 0; tick < ticks; tick++) {
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
const run = (over: Partial<ArpSequencerConfig>, steps = 12, harmony = TONIC): NoteEvent[] =>
  drive(new Arpeggiator(sampler, arpConfig(over)), harmony, steps * QUARTER);
const onsOf = (events: readonly NoteEvent[]): NoteOnEvent[] =>
  events.filter((e): e is NoteOnEvent => e.kind === 'noteOn');
/** The step of each note-on. */
const onSteps = (events: readonly NoteEvent[]): number[] =>
  onsOf(events).map((e) => e.tick / QUARTER);
/** Each step's note-on pitch, or null where the step struck nothing. */
const pitchByStep = (events: readonly NoteEvent[], steps = 12): (number | null)[] => {
  const byTick = new Map(onsOf(events).map((e) => [e.tick, e.note]));
  return Array.from({ length: steps }, (_, s) => byTick.get(s * QUARTER) ?? null);
};

const c4 = sampler.rootNote(DEFAULT_ARP_CONFIG.register.octave);
const CM = [0, 3, 7].map((o) => c4 + o);
const HALF_GATE = QUARTER / 2;

describe('unchanged by default', () => {
  it('default cells, no lanes and skip 0 play the walk: an off then an on at each onset, off at gate', () => {
    const events = run({ style: 'up' }, 6);
    const expected: NoteEvent[] = [];
    for (let s = 0; s < 6; s++) {
      const tick = s * QUARTER;
      const note = CM[s % 3]!;
      expected.push({ kind: 'noteOn', tick, time: tick, note, degree: 0 });
      expected.push({ kind: 'noteOff', tick: tick + HALF_GATE, time: tick + HALF_GATE, note });
    }
    expect(events).toStrictEqual(expected);
  });
});

describe('accent', () => {
  it('upDown over L = 3 (cycle 4): an accent on cell 1 lands on steps 1, 5, 9', () => {
    const ons = onsOf(run({ style: 'upDown', steps: cells({ 1: arpNote({ accent: true }) }) }));
    expect(ons.filter((e) => e.accent).map((e) => e.tick / QUARTER)).toEqual([1, 5, 9]);
    expect(ons[1]!.accent).toEqual({
      velocity: DEFAULT_ARP_CONFIG.accentVelocity,
      mod: DEFAULT_ARP_CONFIG.accentMod,
    });
  });
});

describe('octave', () => {
  it('an octave +1 cell plays 12 semitones up', () => {
    const notes = pitchByStep(run({ steps: cells({ 0: arpNote({ octave: 1 }) }) }), 4);
    expect(notes).toEqual([CM[0]! + SEMITONES_PER_OCTAVE, CM[1], CM[2], CM[0]! + 12]);
  });

  it('a shift past 127 plays the unshifted pitch', () => {
    const major = new ScaleSampler({ root: 0, scale: 'major' });
    const high: Harmony = {
      root: 0,
      scale: 'major',
      events: [{ start: 0, duration: SONG, degree: 0, size: 3 }],
    };
    const config = arpConfig({
      voicing: 'close',
      register: { octave: 9 },
      steps: cells({ 0: arpNote({ octave: 1 }), 1: arpNote({ octave: -1 }) }),
    });
    const list = arpNoteList(major, config, chordAt(high, SONG, 0)!);
    const events = drive(new Arpeggiator(major, config), high, 3 * QUARTER);
    expect(onsOf(events).map((e) => e.note)).toEqual([list[0], list[1]! - 12, list[2]]);
  });
});

describe('tie', () => {
  it('emits no note-on, and the held note runs past its gate to the tie step’s gate', () => {
    const events = run({ steps: cells({ 1: TIE }) }, 3);
    expect(onSteps(events)).toEqual([0, 2]);
    const firstOff = events.find((e) => e.kind === 'noteOff');
    expect(firstOff).toMatchObject({ note: CM[0], tick: QUARTER + HALF_GATE });
  });

  it('at gate 1 the held note runs to the next non-tie onset', () => {
    const events = run({ gate: 1, steps: cells({ 1: TIE }) }, 3);
    expect(events.map((e) => [e.kind, e.tick, e.note])).toEqual([
      ['noteOn', 0, CM[0]],
      ['noteOff', 2 * QUARTER, CM[0]],
      ['noteOn', 2 * QUARTER, CM[2]],
    ]);
  });

  it('with nothing held it plays nothing', () => {
    const events = run({ steps: cells({ 0: REST, 1: TIE }) }, 3);
    expect(onSteps(events)).toEqual([2]);
  });
});

describe('slide', () => {
  it('is flagged, comes before the previous note-off, and the previous note held past its gate', () => {
    const events = run({ steps: cells({ 1: arpNote({ slide: true }) }) }, 2);
    expect(events.map((e) => [e.kind, e.tick, e.note])).toEqual([
      ['noteOn', 0, CM[0]],
      ['noteOn', QUARTER, CM[1]],
      ['noteOff', QUARTER, CM[0]],
      ['noteOff', QUARTER + HALF_GATE, CM[1]],
    ]);
    expect(onsOf(events)[1]!.slide).toBe(true);
  });

  it('with nothing held it is a plain note', () => {
    const on = onsOf(run({ steps: cells({ 0: arpNote({ slide: true }) }) }, 1))[0]!;
    expect(on).not.toHaveProperty('slide');
    expect(on.note).toBe(CM[0]);
  });
});

describe('rest', () => {
  it('releases what is held and plays nothing', () => {
    const events = run({ gate: 1, steps: cells({ 1: REST }) }, 3);
    expect(events.map((e) => [e.kind, e.tick, e.note])).toEqual([
      ['noteOn', 0, CM[0]],
      ['noteOff', QUARTER, CM[0]],
      ['noteOn', 2 * QUARTER, CM[2]],
    ]);
  });

  it('never changes the pitches of later cells, under random and randomOther too', () => {
    for (const style of ['up', 'random', 'randomOther', 'randomOnce'] as const) {
      const plain = pitchByStep(run({ style, seed: 11, octaves: 2 }));
      const rested = pitchByStep(run({ style, seed: 11, octaves: 2, steps: cells({ 1: REST }) }));
      expect(rested, style).toEqual(plain.map((n, s) => (s % 6 === 1 ? null : n)));
    }
  });
});

describe('skip chance', () => {
  it('at 1 every note cell rests; a tie after one plays nothing either', () => {
    expect(onsOf(run({ skipChance: 1, steps: cells({ 1: TIE }) }))).toEqual([]);
  });

  it('at 0.5 some notes rest, and the walk under random plays the same pitches as at 0', () => {
    const at0 = pitchByStep(run({ style: 'random', seed: 3, octaves: 2 }, 32), 32);
    const half = pitchByStep(
      run({ style: 'random', seed: 3, octaves: 2, skipChance: 0.5 }, 32),
      32,
    );
    const skipped = half.filter((n) => n === null).length;
    expect(skipped).toBeGreaterThan(4);
    expect(skipped).toBeLessThan(28);
    expect(half).toEqual(at0.map((n, s) => (half[s] === null ? null : n)));
  });

  it('draws the same skips for the same seed and region', () => {
    const over = { skipChance: 0.5, seed: 4 };
    expect(pitchByStep(run(over, 32), 32)).toEqual(pitchByStep(run(over, 32), 32));
  });
});

describe('lanes', () => {
  it('a lane value reaches the note-on’s stepMod for its cell, each time round the cycle', () => {
    const values = Array.from({ length: 32 }, (_, k) => (k === 2 ? -0.5 : 0));
    const ons = onsOf(run({ style: 'upDown', lanes: [{ param: 'filter.cutoff', values }] }));
    const cutoff = VOICE_TARGET_PATHS.indexOf('filter.cutoff');
    expect(ons.filter((e) => e.stepMod).map((e) => e.tick / QUARTER)).toEqual([2, 6, 10]);
    expect(ons[2]!.stepMod![cutoff]).toBe(-0.5);
  });
});

describe('the cycle across a chord change, and the playhead', () => {
  const firstVi = (2 * BAR) / QUARTER;
  /** upDown: cycle 4 over the triad, 6 over the seventh. */
  const across = (retrigger: boolean) => {
    const arp = new Arpeggiator(sampler, arpConfig({ style: 'upDown', retrigger }));
    const events = drive(arp, I_VI7, (firstVi + 1) * QUARTER);
    return { arp, events };
  };

  it('retrigger on: the chord change restarts at cell 0', () => {
    const { arp } = across(true);
    expect(arp.stepAt(firstVi)).toBe(0);
    expect(arp.stepAt(firstVi + 5)).toBe(5);
    expect(arp.stepAt(firstVi + 6)).toBe(0);
  });

  it('retrigger off: the cell carries on modulo the new cycle', () => {
    const { arp } = across(false);
    expect(arp.stepAt(firstVi)).toBe(firstVi % 6);
    expect(arp.stepAt(firstVi + 4)).toBe((firstVi + 4) % 6);
  });

  it('the cell stepAt names is the one played: an accent on it lands on that onset', () => {
    for (const retrigger of [true, false]) {
      const cell = retrigger ? 0 : firstVi % 6;
      const config = arpConfig({ style: 'upDown', retrigger });
      const arp = new Arpeggiator(sampler, {
        ...config,
        steps: cells({ [cell]: arpNote({ accent: true }) }),
      });
      const events = drive(arp, I_VI7, (firstVi + 1) * QUARTER);
      expect(onsOf(events).at(-1)!.accent, `retrigger ${retrigger}`).toBeDefined();
    }
  });

  it('over the triad before the change, stepAt walks the 4-cell cycle', () => {
    const arp = new Arpeggiator(sampler, arpConfig({ style: 'upDown' }));
    drive(arp, I_VI7, QUARTER);
    expect([0, 1, 2, 3, 4, 5].map((s) => arp.stepAt(s))).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('is −1 before any onset, with no chord, and after a region entry', () => {
    const arp = new Arpeggiator(sampler, arpConfig());
    expect(arp.stepAt(0)).toBe(-1);
    drive(arp, { ...MINOR, events: [] }, BAR);
    expect(arp.stepAt(1)).toBe(-1);
    drive(arp, TONIC, QUARTER);
    expect(arp.stepAt(1)).toBe(1);
    arp.enter(1);
    expect(arp.stepAt(1)).toBe(-1);
  });
});

describe('the gate look-ahead at a retrigger that is not cycle-aligned', () => {
  /** i for two quarter steps, then iv (both triads): with retrigger on, step 2 restarts at cell 0 mid-cycle. */
  const I_IV: Harmony = {
    ...MINOR,
    events: [
      { start: 0, duration: 2 * QUARTER, degree: 0, size: 3 },
      { start: 2 * QUARTER, duration: SONG - 2 * QUARTER, degree: 3, size: 3 },
    ],
  };
  const play = (written: Record<number, ArpStep>): NoteEvent[] =>
    run({ style: 'upDown', retrigger: true, steps: cells(written) }, 4, I_IV);
  const offTicks = (events: readonly NoteEvent[]): number[] =>
    events.filter((e) => e.kind === 'noteOff').map((e) => e.tick);

  it('a tie on cell 0 at the change plays as a plain note, so the chord change sounds', () => {
    const events = play({ 0: TIE });
    // Step 0 is cell 0 at entry, not a reset: a tie with nothing held plays nothing.
    expect(onSteps(events)).toEqual([1, 2, 3]);
    const atChange = onsOf(events).find((e) => e.tick === 2 * QUARTER);
    expect(atChange!.slide).toBeUndefined();
    // Cell 1 follows it, a note, so its gate stands.
    expect(offTicks(events)).toContain(2 * QUARTER + QUARTER / 2);
  });

  it('a tie on cell 0 with a note held into the change releases it and strikes', () => {
    const events = play({ 0: TIE, 2: TIE });
    expect(offTicks(events)).toContain(2 * QUARTER);
    expect(onSteps(events)).toEqual([1, 2, 3]);
  });

  it('a slide on cell 0 at the change plays as a plain note, held into or not', () => {
    for (const written of [
      { 0: arpNote({ slide: true }) },
      { 0: arpNote({ slide: true }), 2: TIE },
    ]) {
      const events = play(written);
      const atChange = events.filter((e) => e.tick === 2 * QUARTER);
      const on = onsOf(atChange)[0];
      expect(on).toBeDefined();
      expect(on!.slide).toBeUndefined();
      // Not legato: any held note's off goes out before the strike.
      expect(atChange.at(-1)!.kind).toBe('noteOn');
    }
  });

  it('keeps an accent and an octave on a slide cell 0 at the change', () => {
    const plain = play({});
    const events = play({ 0: arpNote({ slide: true, accent: true, octave: 1 }) });
    const atChange = onsOf(events).find((e) => e.tick === 2 * QUARTER)!;
    const unshifted = onsOf(plain).find((e) => e.tick === 2 * QUARTER)!;
    expect(atChange.note).toBe(unshifted.note + SEMITONES_PER_OCTAVE);
    expect(atChange.accent).toBeDefined();
  });

  it('a tie on cell 0 when the cycle wraps with no chord change still ties, retrigger on', () => {
    const events = run({ style: 'upDown', retrigger: true, steps: cells({ 0: TIE }) }, 8);
    expect(onSteps(events)).toEqual([1, 2, 3, 5, 6, 7]);
  });

  it('a tie on the cycle’s next cell holds the note to the change, where cell 0 releases and restrikes', () => {
    const events = play({ 2: TIE });
    expect(offTicks(events)).toContain(2 * QUARTER);
    expect(onSteps(events)).toEqual([0, 1, 2, 3]);
  });
});
