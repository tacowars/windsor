import { describe, expect, it } from 'vitest';

import { GRID_STEPS_MAX } from '../audioConstants';
import {
  DEFAULT_GRID_CONFIG,
  GridSequencer,
  defaultGridSteps,
  gridNote,
  type GridSequencerConfig,
  type GridStep,
} from './gridSequencer';
import type { NoteEvent } from './noteEvent';
import { ScaleSampler } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR, TickTransport } from './scheduler';

/** C minor (root pitch class 0); at register octave 3, degree 0 is C3 = 48, degree 2 is 51, degree 6 is 58. */
const minor = new ScaleSampler({ root: 0, scale: 'naturalMinor' });
const penta = new ScaleSampler({ root: 0, scale: 'pentatonicMinor' });
/** The register every line here is written at (#705: an absolute MIDI octave). */
const C3 = { octave: 3 };

const REST: GridStep = { kind: 'rest' };
const TIE: GridStep = { kind: 'tie' };

function make(steps: readonly GridStep[], extra: Partial<GridSequencerConfig> = {}): GridSequencer {
  return new GridSequencer(minor, {
    ...DEFAULT_GRID_CONFIG,
    register: C3,
    steps,
    length: steps.length,
    ...extra,
  });
}

function run(seq: GridSequencer, bars: number): NoteEvent[] {
  const transport = new TickTransport(120);
  const events: NoteEvent[] = [];
  seq.onNote = (e) => events.push(e);
  seq.attach(transport);
  for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(i * transport.secondsPerTick);
  return events;
}

const ons = (events: NoteEvent[]): NoteEvent[] => events.filter((e) => e.kind === 'noteOn');

describe('GridSequencer', () => {
  it('plays each note step in turn, releasing the previous note on the same tick', () => {
    const events = run(make([gridNote(0), gridNote(2), gridNote(4), gridNote(6)]), 1);
    // Sixteenths: 16 steps in the bar, the 4-step line four times over.
    expect(ons(events).map((e) => e.note)).toEqual([
      48, 51, 55, 58, 48, 51, 55, 58, 48, 51, 55, 58, 48, 51, 55, 58,
    ]);
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!;
      const cur = events[i]!;
      if (cur.kind === 'noteOn' && cur.tick > 0) {
        expect(prev.kind).toBe('noteOff');
        expect(prev.tick).toBe(cur.tick);
      }
    }
    // Plain notes carry no accent and no slide.
    for (const on of ons(events)) {
      expect(on.kind === 'noteOn' && on.accent).toBeUndefined();
      expect(on.kind === 'noteOn' && on.slide).toBeUndefined();
    }
  });

  it('loops on its own length, not the bar: a 12-step line replays step 0 mid-bar', () => {
    const steps = Array.from({ length: 12 }, (_, i) => gridNote(i % 7));
    const seq = make(steps);
    const events = run(seq, 2);
    const firstNotes = ons(events).map((e) => e.note);
    // Step 12 (tick 72, three quarters through bar 1) is step 0 again.
    expect(firstNotes[12]).toBe(firstNotes[0]);
    expect(ons(events)[12]!.tick).toBe(12 * DIVISORS.sixteenth);
    expect(seq.stepAt(12)).toBe(0);
    expect(seq.stepAt(25)).toBe(1);
  });

  it('ties extend the held note, and the off arrives at the next non-tie step', () => {
    const events = run(make([gridNote(0), TIE, TIE, gridNote(2)]), 1);
    const first = events.slice(0, 3);
    expect(first).toEqual([
      { kind: 'noteOn', tick: 0, time: 0, note: 48, degree: 0 },
      { kind: 'noteOff', tick: 3 * DIVISORS.sixteenth, time: expect.any(Number), note: 48 },
      {
        kind: 'noteOn',
        tick: 3 * DIVISORS.sixteenth,
        time: expect.any(Number),
        note: 51,
        degree: 2,
      },
    ]);
  });

  it('a rest releases the held note and plays nothing', () => {
    const events = run(make([gridNote(0), REST, REST, REST]), 1);
    expect(events.slice(0, 2)).toEqual([
      { kind: 'noteOn', tick: 0, time: 0, note: 48, degree: 0 },
      { kind: 'noteOff', tick: DIVISORS.sixteenth, time: expect.any(Number), note: 48 },
    ]);
    // Nothing between the rest and the next pass: one on and one off per pass.
    expect(events).toHaveLength(8);
  });

  it('a slide emits the new note-on flagged slide before the old note-off at the same tick', () => {
    const events = run(make([gridNote(0), gridNote(4, { slide: true }), REST, REST]), 1);
    expect(events.slice(0, 4)).toEqual([
      { kind: 'noteOn', tick: 0, time: 0, note: 48, degree: 0 },
      { kind: 'noteOn', tick: 6, time: expect.any(Number), note: 55, degree: 4, slide: true },
      { kind: 'noteOff', tick: 6, time: expect.any(Number), note: 48 },
      { kind: 'noteOff', tick: 12, time: expect.any(Number), note: 55 },
    ]);
  });

  it('a slide with nothing held is an ordinary note-on, and a slide to the held pitch is a tie', () => {
    const events = run(
      make([gridNote(0, { slide: true }), gridNote(0, { slide: true }), REST, REST]),
      1,
    );
    expect(events.slice(0, 2)).toEqual([
      { kind: 'noteOn', tick: 0, time: 0, note: 48, degree: 0 },
      { kind: 'noteOff', tick: 12, time: expect.any(Number), note: 48 },
    ]);
  });

  it('an accented step carries the velocity bump and the mod value; a plain step carries neither', () => {
    const seq = make([gridNote(0, { accent: true }), gridNote(0)], {
      accentVelocity: 0.25,
      accentMod: 0.7,
    });
    const [accented, plain] = ons(run(seq, 1));
    expect(accented).toMatchObject({ note: 48, accent: { velocity: 0.25, mod: 0.7 } });
    expect(plain).toEqual({
      kind: 'noteOn',
      tick: 6,
      time: expect.any(Number),
      note: 48,
      degree: 0,
    });
  });

  it('a tie on step 0 continues the previous pass across the loop', () => {
    const events = run(make([TIE, gridNote(0), TIE, TIE]), 2);
    // Pass 1: nothing on the leading tie, a note on step 1 held to the end;
    // pass 2: the leading tie holds it on, step 1 is the same pitch so it
    // releases and retriggers there. So exactly one off per pass after the first.
    expect(ons(events).map((e) => e.tick)).toEqual([6, 30, 54, 78, 102, 126, 150, 174]);
    const offs = events.filter((e) => e.kind === 'noteOff');
    expect(offs.map((e) => e.tick)).toEqual([30, 54, 78, 102, 126, 150, 174]);
  });

  it('a step octave adds to the register octave', () => {
    const seq = make([gridNote(0, { octave: 1 }), gridNote(0, { octave: -2 })], {
      register: { octave: 2 },
    });
    expect(
      ons(run(seq, 1))
        .slice(0, 2)
        .map((e) => e.note),
    ).toEqual([48, 48 - 36]);
  });

  it('resolves degrees through the sampler, wrapping past the end with octave carry', () => {
    const seq = new GridSequencer(penta, {
      ...DEFAULT_GRID_CONFIG,
      register: C3,
      steps: [gridNote(6), gridNote(4)],
      length: 2,
    });
    // Pentatonic minor has five degrees: 6 is degree 1 (3 semitones) an octave up.
    expect(
      ons(run(seq, 1))
        .slice(0, 2)
        .map((e) => e.note),
    ).toEqual([48 + 3 + 12, 48 + 10]);
  });

  it('skipChance is deterministic per seed and a skipped step rests', () => {
    const line = Array.from({ length: 16 }, () => gridNote(0));
    const a = run(make(line, { skipChance: 0.5, seed: 7 }), 4);
    const b = run(make(line, { skipChance: 0.5, seed: 7 }), 4);
    const c = run(make(line, { skipChance: 0.5, seed: 8 }), 4);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const played = ons(a).length;
    expect(played).toBeGreaterThan(0);
    expect(played).toBeLessThan(64);
    // A skipped step released the note before it: every on is followed by its
    // own off, and a skipped step is silence (no on at that tick).
    const onTicks = new Set(ons(a).map((e) => e.tick));
    for (let step = 0; step < 64; step++) {
      const tick = step * DIVISORS.sixteenth;
      if (!onTicks.has(tick)) {
        expect(a.some((e) => e.kind === 'noteOn' && e.tick === tick)).toBe(false);
      }
    }
    // With no skip every step plays.
    expect(ons(run(make(line, { skipChance: 0 }), 4))).toHaveLength(64);
  });

  it('loops over the first `length` steps and keeps the rest written (#603)', () => {
    const seq = make([gridNote(0), gridNote(2), gridNote(4), gridNote(6)], { length: 3 });
    expect(seq.length).toBe(3);
    expect(seq.stepAt(3)).toBe(0);
    expect(
      ons(run(seq, 1))
        .slice(0, 6)
        .map((e) => e.note),
    ).toEqual([48, 51, 55, 48, 51, 55]);
    expect(() => make([gridNote()], { length: 2 })).toThrow(RangeError);
    expect(() => make([gridNote()], { length: 0 })).toThrow(RangeError);
  });

  it('reconfigures live: the held note and the skip stream carry on, a new sampler re-pitches (#603)', () => {
    const line = Array.from({ length: 8 }, (_, i) => gridNote(i % 3));
    const uninterrupted = run(make(line, { skipChance: 0.5, seed: 3 }), 4);
    // The same line, with a mid-run reconfigure that changes nothing audible.
    const seq = make(line, { skipChance: 0.5, seed: 3 });
    const transport = new TickTransport(120);
    const events: NoteEvent[] = [];
    seq.onNote = (e) => events.push(e);
    seq.attach(transport);
    for (let i = 0; i < 2 * TICKS_PER_BAR; i++) transport.advance(i * transport.secondsPerTick);
    seq.reconfigure({ ...seq.config, accentMod: 0.5 });
    for (let i = 2 * TICKS_PER_BAR; i < 4 * TICKS_PER_BAR; i++) {
      transport.advance(i * transport.secondsPerTick);
    }
    expect(events).toEqual(uninterrupted);

    // A held tie survives; the next note releases it by its old pitch, and the
    // new sampler pitches what follows.
    const tied = make([gridNote(2), TIE, TIE, TIE]);
    run(tied, 1);
    expect(tied.heldNote).toBe(51);
    tied.reconfigure({ ...tied.config, steps: [gridNote(2), gridNote(0), TIE, TIE] }, penta);
    expect(tied.heldNote).toBe(51);
    const after = tied.handleTick({
      tick: 96,
      step: 16,
      bar: 1,
      tickInBar: 0,
      seconds: 0,
      secondsPerTick: 0,
      time: 0,
    });
    expect(after.map((e) => [e.kind, e.note])).toEqual([
      ['noteOff', 51],
      ['noteOn', 48 + 5],
    ]);
    expect(() => tied.reconfigure({ ...tied.config, divisor: 12 })).toThrow(RangeError);
    // #705: a seed change rebuilds the part (the stream restarts at once), never live.
    expect(() => tied.reconfigure({ ...tied.config, seed: 12 })).toThrow(/seed/);
    expect(() => tied.reconfigure({ ...tied.config, length: 9 })).toThrow(RangeError);
  });

  it('releases the held note on demand — what a transport stop calls', () => {
    const seq = make([gridNote(0), TIE, TIE, TIE]);
    run(seq, 1);
    expect(seq.heldNote).toBe(48);
    expect(seq.release(96, 2)).toEqual({ kind: 'noteOff', tick: 96, time: 2, note: 48 });
    expect(seq.heldNote).toBeNull();
    expect(seq.release(97, 2.1)).toBeNull();
  });

  it('rejects a config the normaliser should never hand it', () => {
    expect(() => make([])).toThrow(RangeError);
    expect(() => make(Array.from({ length: GRID_STEPS_MAX + 1 }, () => gridNote()))).toThrow(
      RangeError,
    );
    expect(() => make([gridNote(-1)])).toThrow(RangeError);
    expect(() => make([gridNote(0, { octave: 3 })])).toThrow(RangeError);
    expect(() => make([gridNote()], { divisor: 5 })).toThrow(RangeError);
    expect(() => make([gridNote()], { skipChance: 1.5 })).toThrow(RangeError);
    expect(() => make([gridNote()], { accentVelocity: -0.1 })).toThrow(RangeError);
    expect(() => make([gridNote()], { accentMod: 2 })).toThrow(RangeError);
    expect(defaultGridSteps()).toHaveLength(16);
  });
});
