/**
 * Capture-to-fixed, generator half (issue #70, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §6): a captured
 * pattern plays verbatim and never regenerates, and the `BarRecorder` reads
 * what a pitched part actually sounded. The player and document halves are in
 * `captureFlow.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { Arpeggiator, DEFAULT_ARPEGGIATOR_CONFIG } from './arpeggiator';
import { BarRecorder } from './capturedPattern';
import { patternFromString } from './euclid';
import { EuclideanSequencer } from './euclideanSequencer';
import type { NoteEvent } from './noteEvent';
import { ScaleSampler } from './scaleSampler';
import { TICKS_PER_BAR, TickTransport } from './scheduler';
import { StepSequencer } from './stepSequencer';

const sampler = (): ScaleSampler => new ScaleSampler({ root: 60, scale: [0], weights: [1] });

const run = (transport: TickTransport, bars: number): void => {
  for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(0);
};

describe('fixed patterns in the generators', () => {
  it('euclidean: plays the literal figure every bar, never regenerating', () => {
    const sequencer = new EuclideanSequencer({
      steps: 8,
      divisor: 12,
      pulses: { min: 0, max: 8, start: 3 },
      rotate: 0,
      // stepChance 1: a generative walk would move k every bar.
      density: { kind: 'walk', stepChance: 1 },
      seed: 5,
      generatorIndex: 0,
      pattern: patternFromString('x..x..x.'),
    });
    const transport = new TickTransport();
    const steps: number[] = [];
    sequencer.onOnset = (e) => steps.push(e.step);
    sequencer.attach(transport);
    run(transport, 4);
    expect(steps).toEqual([0, 3, 6, 0, 3, 6, 0, 3, 6, 0, 3, 6]);
    expect(sequencer.currentK).toBe(3);
    expect(sequencer.currentPattern).toEqual(patternFromString('x..x..x.'));
  });

  it('euclidean: refuses a pattern that does not match steps', () => {
    expect(
      () =>
        new EuclideanSequencer({
          steps: 8,
          divisor: 12,
          pulses: { min: 0, max: 8, start: 3 },
          rotate: 0,
          density: { kind: 'lfoBars', bars: 8, shape: 'tri' },
          seed: 0,
          generatorIndex: 0,
          pattern: [true, false],
        }),
    ).toThrow(/pattern must have 8 steps/);
  });

  it('arp: plays the captured bar, rests on null, gate preserved', () => {
    const events: NoteEvent[] = [];
    const arp = new Arpeggiator(sampler(), {
      ...DEFAULT_ARPEGGIATOR_CONFIG,
      divisor: 24,
      gate: 0.5,
      seed: 1,
      generatorIndex: 2,
      pattern: [60, null, 62, 64],
    });
    arp.onNote = (e) => events.push(e);
    const transport = new TickTransport();
    arp.attach(transport);
    run(transport, 2);
    const ons = events.filter((e) => e.kind === 'noteOn');
    expect(ons.map((e) => [e.tick % TICKS_PER_BAR, e.note])).toEqual([
      [0, 60],
      [48, 62],
      [72, 64],
      [0, 60],
      [48, 62],
      [72, 64],
    ]);
    const offs = events.filter((e) => e.kind === 'noteOff');
    // gate 0.5 of a 24-tick step: every off lands 12 ticks after its on.
    ons.forEach((on, i) => expect(offs[i]?.tick).toBe(on.tick + 12));
  });

  it('drone: a one-note captured bar ties across bars under gate 1', () => {
    const events: NoteEvent[] = [];
    const drone = new StepSequencer(sampler(), {
      divisor: 96,
      gate: 1,
      register: { octave: 0, span: 1 },
      seed: 3,
      generatorIndex: 3,
      pattern: [50],
    });
    drone.onNote = (e) => events.push(e);
    const transport = new TickTransport();
    drone.attach(transport);
    run(transport, 4);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'noteOn', note: 50 });
    expect(drone.heldNote).toBe(50);
  });

  it('drone: a captured rest releases the held note', () => {
    const events: NoteEvent[] = [];
    const drone = new StepSequencer(sampler(), {
      divisor: 48,
      gate: 1,
      register: { octave: 0, span: 1 },
      seed: 3,
      generatorIndex: 3,
      pattern: [50, null],
    });
    drone.onNote = (e) => events.push(e);
    const transport = new TickTransport();
    drone.attach(transport);
    run(transport, 2);
    expect(events.map((e) => [e.kind, e.tick])).toEqual([
      ['noteOn', 0],
      ['noteOff', 48],
      ['noteOn', 96],
      ['noteOff', 144],
    ]);
  });
});

describe('BarRecorder', () => {
  it('keeps the last completed bar; fill carries the sounding note over rests', () => {
    const rec = new BarRecorder(24);
    rec.record(0, 60);
    rec.record(48, 62);
    expect(rec.capture(false, null)).toBeNull();
    rec.record(96, 64);
    expect(rec.capture(false, null)).toEqual([60, null, 62, null]);
    expect(rec.capture(true, null)).toEqual([60, 60, 62, 62]);
  });

  it('treats a gap as silent bars and fills them from the last note', () => {
    const rec = new BarRecorder(24);
    rec.record(0, 60);
    rec.record(3 * TICKS_PER_BAR, 70);
    expect(rec.capture(false, null)).toEqual([null, null, null, null]);
    expect(rec.capture(true, null)).toEqual([60, 60, 60, 60]);
  });

  it('captures an all-tie stretch from the held note before any bar completes', () => {
    const rec = new BarRecorder(48);
    expect(rec.capture(true, null)).toBeNull();
    expect(rec.capture(true, 36)).toEqual([36, 36]);
  });
});
