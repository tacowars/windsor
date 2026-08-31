import { describe, expect, it } from 'vitest';

import type { NoteEvent } from './noteEvent';
import { ScaleSampler } from './scaleSampler';
import { TICKS_PER_BAR, TickTransport } from './scheduler';
import {
  DEFAULT_STEP_SEQUENCER_CONFIG,
  StepSequencer,
  type StepSequencerConfig,
} from './stepSequencer';

/** One degree with all the weight: every draw is the same note, so every step ties. */
const oneNote = new ScaleSampler({ root: 36, scale: 'major', weights: [1, 0, 0, 0, 0, 0, 0] });
const twoNotes = new ScaleSampler({ root: 36, scale: [0, 7], weights: [1, 1] });

function make(sampler: ScaleSampler, extra: Partial<StepSequencerConfig> = {}): StepSequencer {
  return new StepSequencer(sampler, { ...DEFAULT_STEP_SEQUENCER_CONFIG, ...extra });
}

function run(seq: StepSequencer, bars: number): NoteEvent[] {
  const transport = new TickTransport(120);
  const events: NoteEvent[] = [];
  seq.onNote = (e) => events.push(e);
  seq.attach(transport);
  for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(i * transport.secondsPerTick);
  return events;
}

describe('StepSequencer', () => {
  it('at 96 ticks per step with gate 1.0 holds one note across repeated bars with no retrigger', () => {
    const seq = make(oneNote, { divisor: 96, gate: 1 });
    const events = run(seq, 8);
    expect(events).toEqual([{ kind: 'noteOn', tick: 0, time: 0, note: 24, degree: 0 }]);
    expect(seq.heldNote).toBe(24);
    const off = seq.release(8 * TICKS_PER_BAR, 16);
    expect(off).toEqual({ kind: 'noteOff', tick: 768, time: 16, note: 24 });
    expect(seq.heldNote).toBeNull();
    expect(seq.release(800, 17)).toBeNull();
  });

  it('with gate 1.0 a pitch change releases the held note on the same tick, before the new note-on', () => {
    const events = run(make(twoNotes, { divisor: 96, gate: 1, seed: 11 }), 32);
    const ons = events.filter((e) => e.kind === 'noteOn');
    const offs = events.filter((e) => e.kind === 'noteOff');
    expect(ons.length).toBeGreaterThan(1);
    expect(offs).toHaveLength(ons.length - 1);
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!;
      const cur = events[i]!;
      if (cur.kind === 'noteOn') {
        expect(prev.kind).toBe('noteOff');
        expect(prev.tick).toBe(cur.tick);
        expect(prev.note).not.toBe(cur.note);
        expect(cur.tick % 96).toBe(0);
      }
    }
    // No two consecutive note-ons share a pitch: that would have been a tie.
    for (let i = 1; i < ons.length; i++) expect(ons[i]!.note).not.toBe(ons[i - 1]!.note);
  });

  it('with a gate below 1.0 every step retriggers, off a gate fraction of the step later', () => {
    const events = run(make(oneNote, { divisor: 24, gate: 0.25 }), 2);
    expect(events).toHaveLength(16);
    for (let i = 0; i < events.length; i += 2) {
      const on = events[i]!;
      const off = events[i + 1]!;
      expect(on.kind).toBe('noteOn');
      expect(off.kind).toBe('noteOff');
      expect(on.tick).toBe((i / 2) * 24);
      expect(off.tick - on.tick).toBe(6);
      expect(off.time - on.time).toBeCloseTo(6 / 48, 12);
    }
  });

  it('never rounds the gate down to nothing', () => {
    const seq = make(oneNote, { divisor: 3, gate: 0.01 });
    expect(seq.durationTicks).toBe(1);
  });

  it('is reproducible for a seed and moves with it', () => {
    const a = run(make(twoNotes, { divisor: 12, gate: 0.5, seed: 1 }), 8);
    const b = run(make(twoNotes, { divisor: 12, gate: 0.5, seed: 1 }), 8);
    const c = run(make(twoNotes, { divisor: 12, gate: 0.5, seed: 2 }), 8);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('rejects a gate outside (0, 1] and a divisor that does not nest in the bar', () => {
    expect(() => make(oneNote, { gate: 0 })).toThrow(RangeError);
    expect(() => make(oneNote, { gate: 1.5 })).toThrow(RangeError);
    expect(() => make(oneNote, { divisor: 10 })).toThrow(RangeError);
  });
});
