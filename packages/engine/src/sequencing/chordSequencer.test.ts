import { describe, expect, it } from 'vitest';

import {
  CHORD_INVERSION_MAX,
  CHORD_REPEAT_MAX,
  CHORD_SEMITONE_MAX,
  CHORD_STEPS_MAX,
  CHORD_STEP_OCTAVE_MAX,
  OCTAVE_MAX,
} from '../audioConstants';
import {
  ChordSequencer,
  DEFAULT_CHORD_CONFIG,
  chordStep,
  layoutSegments,
  restStep,
  type ChordSequencerConfig,
  type ChordStep,
} from './chordSequencer';
import type { NoteEvent } from './noteEvent';
import { ScaleSampler } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR, TickTransport } from './scheduler';

/** C major from C4: I is 60 64 67, V is 67 71 74. */
const major = new ScaleSampler({ root: 60, scale: 'major' });

/** A bar per base step, so the fixture's tick numbers read straight off its durations. */
const BAR = DIVISORS.bar;

function make(
  steps: readonly ChordStep[],
  extra: Partial<ChordSequencerConfig> = {},
): ChordSequencer {
  return new ChordSequencer(major, { ...DEFAULT_CHORD_CONFIG, divisor: BAR, steps, ...extra });
}

/** Advance `ticks` ticks from `from`, collecting every event the sequencer emits. */
function run(seq: ChordSequencer, ticks: number, from = 0): NoteEvent[] {
  const transport = new TickTransport(120);
  transport.reset(from);
  const events: NoteEvent[] = [];
  seq.onNote = (e) => events.push(e);
  seq.attach(transport);
  for (let i = 0; i < ticks; i++) transport.advance(transport.transportSeconds);
  return events;
}

const ons = (events: NoteEvent[]): NoteEvent[] => events.filter((e) => e.kind === 'noteOn');

/** The ticket's fixture: C maj ×1, a rest ×1, G maj ×0.5 twice — three bars at a bar per step. */
const PATTERN: ChordStep[] = [chordStep(0), restStep(), chordStep(4, { duration: 0.5, repeat: 2 })];

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
    const seq = make([chordStep(0, { duration: 8 })], { gate: 0.5 });
    const transport = new TickTransport(120);
    const events: NoteEvent[] = [];
    seq.onNote = (e) => events.push(e);
    seq.attach(transport);
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
    seq.reconfigure({ ...seq.config, steps: [chordStep(4, { duration: 0.25 })] });
    for (let i = 2; i <= quarter; i++) transport.advance(0);
    expect(seq.heldNotes).toEqual([67, 71, 74]);
    seq.reconfigure({ ...seq.config, steps: [chordStep(4, { duration: 8 })] });
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
    const events = run(
      make([restStep(), chordStep(0, { size: 4 })], { voicing: 'octaves3rds' }),
      192,
    );
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
    seq.attach(transport);
    for (let i = 0; i < 10; i++) transport.advance(0);
    const minor = new ScaleSampler({
      root: 57,
      scale: 'naturalMinor',
    });
    seq.reconfigure(
      { ...seq.config, steps: [chordStep(0, { duration: 0.25 })], voicing: 'drop2' },
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

  it('refuses a bad config in the constructor and in reconfigure', () => {
    expect(() => make([], { divisor: DIVISORS.sixteenth })).toThrow(/divisor/);
    expect(() => make([], { gate: 0 })).toThrow(/gate/);
    expect(() => make([chordStep(0, { duration: 0.3 })])).toThrow(/duration/);
    expect(() => make([chordStep(0, { repeat: CHORD_REPEAT_MAX + 1 })])).toThrow(/repeat/);
    expect(() => make([chordStep(0, { inversion: CHORD_INVERSION_MAX + 1 })])).toThrow(/inversion/);
    expect(() => make([chordStep(0, { octave: CHORD_STEP_OCTAVE_MAX + 1 })])).toThrow(/octave/);
    expect(() => make([chordStep(0, { semitone: CHORD_SEMITONE_MAX + 1 })])).toThrow(/semitone/);
    expect(() => make([chordStep(-1)])).toThrow(/degree/);
    expect(() => make([chordStep(0, { size: 5 as 3 })])).toThrow(/size/);
    expect(() => make(Array.from({ length: CHORD_STEPS_MAX + 1 }, () => restStep()))).toThrow(
      /steps/,
    );
    expect(() => make([], { register: { octave: Number.NaN } })).toThrow(/register/);
    expect(() => make([], { register: { octave: OCTAVE_MAX + 1 } })).toThrow(/register/);
    expect(() => make([], { register: { octave: 0.5 } })).toThrow(/register/);
    const seq = make([]);
    expect(() => seq.reconfigure({ ...seq.config, voicing: 'nope' as 'close' })).toThrow(/voicing/);
    expect(seq.config.voicing).toBe('close');
  });
});
