import { describe, expect, it } from 'vitest';

import {
  CHORD_INVERSION_MAX,
  CHORD_REPEAT_MAX,
  CHORD_STEPS_MAX,
  CHORD_STEP_OCTAVE_MAX,
  REGISTER_OCTAVE_MAX,
} from '../audioConstants';
import type { Harmony, HarmonyEvent } from '../harmony/harmonyTimeline';
import {
  ChordSequencer,
  DEFAULT_CHORD_CONFIG,
  hitStep,
  layoutSegments,
  restStep,
  type ChordSequencerConfig,
  type ChordStep,
} from './chordSequencer';
import type { NoteEvent } from './noteEvent';
import { RegionGate } from './regionGate';
import { ScaleSampler } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR, TickTransport } from './scheduler';

/** C major (root pitch class 0) at register octave 4: I is 60 64 67, V is 67 71 74. */
const major = new ScaleSampler({ root: 0, scale: 'major' });
const C4 = { octave: 4 };

/** A bar per base step, so the fixture's tick numbers read straight off its durations. */
const BAR = DIVISORS.bar;

/** A triad on `degree` from `start` for `duration` ticks. */
const triad = (start: number, duration: number, degree: number): HarmonyEvent => ({
  start,
  duration,
  degree,
  size: 3,
});

/** The fixture's three-bar song (#705: the chord lives in the harmony, not the step): I for two bars, V for one. */
const SONG_TICKS = 3 * BAR;
const I_I_V: readonly HarmonyEvent[] = [triad(0, 2 * BAR, 0), triad(2 * BAR, BAR, 4)];

function make(
  steps: readonly ChordStep[],
  extra: Partial<ChordSequencerConfig> = {},
): ChordSequencer {
  return new ChordSequencer(major, {
    ...DEFAULT_CHORD_CONFIG,
    divisor: BAR,
    register: C4,
    steps,
    ...extra,
  });
}

/** A region gate over `transport`: one ∞ region, so local ticks are transport ticks, and the harmony's chord on each. */
function gate(
  transport: TickTransport,
  events: readonly HarmonyEvent[] = I_I_V,
  songTicks = SONG_TICKS,
): RegionGate {
  const harmony: Harmony = { root: 0, scale: 'major', events };
  return new RegionGate(transport, {
    regions: [{ start: 0, duration: songTicks }],
    songTicks,
    harmony,
  });
}

/** Advance `ticks` ticks from `from`, collecting every event the sequencer emits. */
function run(
  seq: ChordSequencer,
  ticks: number,
  from = 0,
  events: readonly HarmonyEvent[] = I_I_V,
): NoteEvent[] {
  const transport = new TickTransport(120);
  transport.reset(from);
  const out: NoteEvent[] = [];
  seq.onNote = (e) => out.push(e);
  seq.attach(gate(transport, events));
  for (let i = 0; i < ticks; i++) transport.advance(transport.transportSeconds);
  return out;
}

const ons = (events: NoteEvent[]): NoteEvent[] => events.filter((e) => e.kind === 'noteOn');

/** The ticket's fixture: a hit ×1 (C maj), a rest ×1, a hit ×0.5 twice (G maj) — three bars at a bar per step. */
const PATTERN: ChordStep[] = [hitStep(), restStep(), hitStep({ duration: 0.5, repeat: 2 })];

describe('ChordSequencer', () => {
  it('lays the steps out as segments and sums them into the pattern length', () => {
    const seq = make(PATTERN);
    expect(seq.lengthTicks).toBe(3 * BAR);
    expect(layoutSegments(seq.config)).toEqual([
      { step: 0, repeat: 0, start: 0, ticks: BAR },
      { step: 1, repeat: 0, start: BAR, ticks: BAR },
      { step: 2, repeat: 0, start: 2 * BAR, ticks: BAR / 2 },
      { step: 2, repeat: 1, start: 2.5 * BAR, ticks: BAR / 2 },
    ]);
    expect(seq.stepAt(2.5 * BAR + 10)).toEqual({ step: 2, repeat: 1 });
    expect(seq.stepAt(3 * BAR)).toEqual({ step: 0, repeat: 0 });
    expect(seq.stepAt(-1)).toEqual({ step: 2, repeat: 1 });
  });

  it('plays onsets at the segment starts, offs before ons at a boundary, and loops', () => {
    const events = run(make(PATTERN), 289);
    const onTicks = [...new Set(ons(events).map((e) => e.tick))];
    expect(onTicks).toEqual([0, 192, 240, 288]);
    expect(
      ons(events)
        .filter((e) => e.tick === 0)
        .map((e) => e.note),
    ).toEqual([60, 64, 67]);
    expect(
      ons(events)
        .filter((e) => e.tick === 192)
        .map((e) => e.note),
    ).toEqual([67, 71, 74]);
    expect(
      ons(events)
        .filter((e) => e.tick === 288)
        .map((e) => e.note),
    ).toEqual([60, 64, 67]);
    // The rest at 96 releases the C chord and plays nothing.
    const at96 = events.filter((e) => e.tick === 96);
    expect(at96.map((e) => e.kind)).toEqual(['noteOff', 'noteOff', 'noteOff']);
    expect(at96.map((e) => e.note)).toEqual([60, 64, 67]);
    // At 240 the first G is released before the second G starts.
    const at240 = events.filter((e) => e.tick === 240).map((e) => e.kind);
    expect(at240).toEqual(['noteOff', 'noteOff', 'noteOff', 'noteOn', 'noteOn', 'noteOn']);
    // Every noteOn carries the chord's degree.
    for (const on of ons(events)) expect(on.kind === 'noteOn' && on.degree).toBeTypeOf('number');
    expect(ons(events).filter((e) => e.tick === 192)[0]).toMatchObject({ degree: 4 });
  });

  it('gate below 1 emits the offs on the tick the gate ends, not ahead at the onset', () => {
    const seq = make(PATTERN, { gate: 0.5 });
    const events = run(seq, BAR + 1);
    const half = BAR / 2;
    expect(events.filter((e) => e.tick < half).map((e) => e.kind)).toEqual([
      'noteOn',
      'noteOn',
      'noteOn',
    ]);
    const atHalf = events.filter((e) => e.tick === half);
    expect(atHalf.map((e) => e.kind)).toEqual(['noteOff', 'noteOff', 'noteOff']);
    expect(atHalf[0]!.time).toBeCloseTo(half * new TickTransport(120).secondsPerTick, 9);
    expect(seq.heldNotes).toEqual([]);
    // Nothing is held, so the rest at bar 2 has nothing to release.
    expect(events.filter((e) => e.tick === BAR)).toEqual([]);
  });

  it('a gated chord still sounding is released by a live edit that clears or shortens the pattern', () => {
    const seq = make([hitStep({ duration: 8 })], { gate: 0.5 });
    const transport = new TickTransport(120);
    const events: NoteEvent[] = [];
    seq.onNote = (e) => events.push(e);
    // I for the first quarter, V after it: the hit at the quarter voices V.
    seq.attach(gate(transport, [triad(0, BAR / 4, 0), triad(BAR / 4, (3 * BAR) / 4, 4)], BAR));
    transport.advance(0);
    expect(seq.heldNotes).toEqual([60, 64, 67]);
    // Cleared: the empty pattern's first tick releases it.
    seq.reconfigure({ ...seq.config, steps: [] });
    transport.advance(0);
    expect(events.filter((e) => e.tick === 1).map((e) => e.kind)).toEqual([
      'noteOff',
      'noteOff',
      'noteOff',
    ]);
    // Shortened: the new pattern's next onset releases it, then plays.
    const quarter = BAR / 4;
    seq.reconfigure({ ...seq.config, steps: [hitStep({ duration: 0.25 })] });
    for (let i = 2; i <= quarter; i++) transport.advance(0);
    expect(seq.heldNotes).toEqual([67, 71, 74]);
    seq.reconfigure({ ...seq.config, steps: [hitStep({ duration: 8 })] });
    for (let i = quarter + 1; i <= quarter * 1.5; i++) transport.advance(0);
    // Its own gate end (a quarter plus half of it) still releases it under the longer pattern.
    expect(events.filter((e) => e.tick === quarter * 1.5).map((e) => e.kind)).toEqual([
      'noteOff',
      'noteOff',
      'noteOff',
    ]);
    expect(seq.heldNotes).toEqual([]);
  });

  it('a rest at step 0 with nothing held emits nothing; each onset emits the voicing’s note count', () => {
    // #705: the chord's size is the harmony event's — a seventh on I.
    const events = run(make([restStep(), hitStep()], { voicing: 'octaves3rds' }), 192, 0, [
      { start: 0, duration: SONG_TICKS, degree: 0, size: 4 },
    ]);
    expect(events.filter((e) => e.tick === 0)).toEqual([]);
    expect(
      ons(events)
        .filter((e) => e.tick === 96)
        .map((e) => e.note),
    ).toEqual([60, 64, 72, 76]);
  });

  it('built mid-segment, it emits its first events at the next segment start', () => {
    const events = run(make(PATTERN), BAR / 2, 2.5 * BAR + 10);
    expect(events.map((e) => e.tick)).toEqual([3 * BAR, 3 * BAR, 3 * BAR]);
    expect(events.map((e) => e.kind)).toEqual(['noteOn', 'noteOn', 'noteOn']);
  });

  it('release() emits an off per held note and clears them; an empty pattern is silent', () => {
    const seq = make(PATTERN);
    run(seq, 1);
    expect(seq.heldNotes).toEqual([60, 64, 67]);
    const released = seq.release(7, 0.5);
    expect(released.map((e) => e.note)).toEqual([60, 64, 67]);
    expect(released[0]).toMatchObject({ kind: 'noteOff', tick: 7, time: 0.5 });
    expect(seq.heldNotes).toEqual([]);
    expect(seq.release(8, 0.6)).toEqual([]);

    const empty = make([]);
    expect(empty.lengthTicks).toBe(0);
    expect(empty.stepAt(5)).toBeNull();
    expect(run(empty, 4 * TICKS_PER_BAR)).toEqual([]);
  });

  it('reconfigure keeps the held chord until the next onset and takes a new sampler', () => {
    const seq = make(PATTERN);
    const transport = new TickTransport(120);
    const events: NoteEvent[] = [];
    seq.onNote = (e) => events.push(e);
    const regionGate = gate(transport);
    seq.attach(regionGate);
    for (let i = 0; i < 10; i++) transport.advance(0);
    // A minor at register octave 3 (A3 = 57); the harmony's i is now A minor.
    const minor = new ScaleSampler({
      root: 9,
      scale: 'naturalMinor',
    });
    // A key change reaches the gate's harmony with the sampler, as the player sends it: the
    // chord's stack is the timeline's (windsor#330), the sampler only places it.
    regionGate.reconfigure({
      regions: [{ start: 0, duration: SONG_TICKS }],
      songTicks: SONG_TICKS,
      harmony: { root: 9, scale: 'naturalMinor', events: I_I_V },
    });
    seq.reconfigure(
      {
        ...seq.config,
        steps: [hitStep({ duration: 0.25 })],
        voicing: 'drop2',
        register: { octave: 3 },
      },
      minor,
    );
    expect(seq.heldNotes).toEqual([60, 64, 67]);
    const quarter = BAR / 4;
    expect(seq.lengthTicks).toBe(quarter);
    for (let i = 10; i <= quarter; i++) transport.advance(0);
    // The quarter is the new pattern's onset: the old C chord goes, A minor drop2 (C3 A3 E4) comes.
    const at24 = events.filter((e) => e.tick === quarter);
    expect(at24.map((e) => e.kind)).toEqual([
      'noteOff',
      'noteOff',
      'noteOff',
      'noteOn',
      'noteOn',
      'noteOn',
    ]);
    expect(at24.filter((e) => e.kind === 'noteOn').map((e) => e.note)).toEqual([48, 57, 64]);

    // An empty pattern releases what was held on its first tick.
    seq.reconfigure({ ...seq.config, steps: [] });
    transport.advance(0);
    expect(events.at(-1)).toMatchObject({ kind: 'noteOff', tick: quarter + 1 });
    expect(seq.heldNotes).toEqual([]);
  });

  it('a hit voices the harmony chord at its transport tick; a chord change never cuts a sounding hit (#705)', () => {
    // One whole-bar hit per bar over I | V: the change at bar 1 lands on an onset.
    const events = run(make([hitStep()]), 2 * BAR + 1, 0, [triad(0, BAR, 0), triad(BAR, BAR, 4)]);
    expect(
      ons(events)
        .filter((e) => e.tick === BAR)
        .map((e) => e.note),
    ).toEqual([67, 71, 74]);
    // A two-bar hit sustains across the I → V boundary: nothing happens at the change.
    const held = run(make([hitStep({ duration: 2 })]), 2 * BAR, 0, [
      triad(0, BAR, 0),
      triad(BAR, BAR, 4),
    ]);
    expect(held.filter((e) => e.tick === BAR)).toEqual([]);
    expect(ons(held).map((e) => e.note)).toEqual([60, 64, 67]);
  });

  it('a hit with no chord (an empty harmony) plays nothing', () => {
    expect(run(make([hitStep()]), 2 * BAR, 0, [])).toEqual([]);
  });

  it('refuses a bad config in the constructor and in reconfigure', () => {
    expect(() => make([], { divisor: DIVISORS.sixteenth })).toThrow(/divisor/);
    expect(() => make([], { gate: 0 })).toThrow(/gate/);
    expect(() => make([hitStep({ duration: 0.3 })])).toThrow(/duration/);
    expect(() => make([hitStep({ repeat: CHORD_REPEAT_MAX + 1 })])).toThrow(/repeat/);
    expect(() => make([hitStep({ inversion: CHORD_INVERSION_MAX + 1 })])).toThrow(/inversion/);
    expect(() => make([hitStep({ octave: CHORD_STEP_OCTAVE_MAX + 1 })])).toThrow(/octave/);
    expect(() => make(Array.from({ length: CHORD_STEPS_MAX + 1 }, () => restStep()))).toThrow(
      /steps/,
    );
    expect(() => make([], { register: { octave: Number.NaN } })).toThrow(/register/);
    expect(() => make([], { register: { octave: REGISTER_OCTAVE_MAX + 1 } })).toThrow(/register/);
    expect(() => make([], { register: { octave: 0.5 } })).toThrow(/register/);
    const seq = make([]);
    expect(() => seq.reconfigure({ ...seq.config, voicing: 'nope' as 'close' })).toThrow(/voicing/);
    expect(seq.config.voicing).toBe('close');
  });
});
