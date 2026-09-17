import { describe, expect, it } from 'vitest';

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
const major = new ScaleSampler({ root: 60, scale: 'major', weights: [1, 1, 1, 1, 1, 1, 1] });

function make(
  steps: readonly ChordStep[],
  extra: Partial<ChordSequencerConfig> = {},
): ChordSequencer {
  return new ChordSequencer(major, { ...DEFAULT_CHORD_CONFIG, steps, ...extra });
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
const offs = (events: NoteEvent[]): NoteEvent[] => events.filter((e) => e.kind === 'noteOff');

/** The ticket's fixture: C maj ×1, a rest ×1, G maj ×0.5 twice — 288 ticks at a bar per step. */
const PATTERN: ChordStep[] = [chordStep(0), restStep(), chordStep(4, { duration: 0.5, repeat: 2 })];

describe('ChordSequencer', () => {
  it('lays the steps out as segments and sums them into the pattern length', () => {
    const seq = make(PATTERN);
    expect(seq.lengthTicks).toBe(288);
    expect(layoutSegments(seq.config)).toEqual([
      { step: 0, repeat: 0, start: 0, ticks: 96 },
      { step: 1, repeat: 0, start: 96, ticks: 96 },
      { step: 2, repeat: 0, start: 192, ticks: 48 },
      { step: 2, repeat: 1, start: 240, ticks: 48 },
    ]);
    expect(seq.stepAt(250)).toEqual({ step: 2, repeat: 1 });
    expect(seq.stepAt(288)).toEqual({ step: 0, repeat: 0 });
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

  it('gate below 1 emits the offs at the onset with a future tick and time', () => {
    const seq = make(PATTERN, { gate: 0.5 });
    const events = run(seq, 97);
    const first = events.filter((e) => e.tick === 0 || (e.kind === 'noteOff' && e.tick === 48));
    expect(first.map((e) => e.kind)).toEqual([
      'noteOn',
      'noteOn',
      'noteOn',
      'noteOff',
      'noteOff',
      'noteOff',
    ]);
    const off = offs(first)[0]!;
    expect(off.tick).toBe(48);
    expect(off.time).toBeCloseTo(48 * new TickTransport(120).secondsPerTick, 9);
    expect(seq.heldNotes).toEqual([]);
    // Nothing is held, so the rest at 96 has nothing to release.
    expect(events.filter((e) => e.tick === 96)).toEqual([]);
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
    const events = run(make(PATTERN), 40, 250);
    expect(events.map((e) => e.tick)).toEqual([288, 288, 288]);
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
      weights: [1, 1, 1, 1, 1, 1, 1],
    });
    seq.reconfigure(
      { ...seq.config, steps: [chordStep(0, { duration: 0.25 })], voicing: 'drop2' },
      minor,
    );
    expect(seq.heldNotes).toEqual([60, 64, 67]);
    expect(seq.lengthTicks).toBe(24);
    for (let i = 10; i < 25; i++) transport.advance(0);
    // Tick 24 is the new pattern's onset: the old C chord goes, A minor drop2 (C3 A3 E4) comes.
    const at24 = events.filter((e) => e.tick === 24);
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
    expect(events.at(-1)).toMatchObject({ kind: 'noteOff', tick: 25 });
    expect(seq.heldNotes).toEqual([]);
  });

  it('refuses a bad config in the constructor and in reconfigure', () => {
    expect(() => make([], { divisor: DIVISORS.sixteenth })).toThrow(/divisor/);
    expect(() => make([], { gate: 0 })).toThrow(/gate/);
    expect(() => make([chordStep(0, { duration: 0.3 })])).toThrow(/duration/);
    expect(() => make([chordStep(0, { repeat: 9 })])).toThrow(/repeat/);
    expect(() => make([chordStep(0, { inversion: 4 })])).toThrow(/inversion/);
    expect(() => make([chordStep(0, { octave: 3 })])).toThrow(/octave/);
    expect(() => make([chordStep(0, { semitone: 12 })])).toThrow(/semitone/);
    expect(() => make([chordStep(-1)])).toThrow(/degree/);
    expect(() => make([chordStep(0, { size: 5 as 3 })])).toThrow(/size/);
    expect(() => make(Array.from({ length: 33 }, () => restStep()))).toThrow(/steps/);
    const seq = make([]);
    expect(() => seq.reconfigure({ ...seq.config, voicing: 'nope' as 'close' })).toThrow(/voicing/);
    expect(seq.config.voicing).toBe('close');
  });
});
