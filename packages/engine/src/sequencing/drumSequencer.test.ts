/**
 * The Drum at the generator (windsor#948, record `2026-10-24-drum-sequencer`
 * decisions 2–4): what a hit plays and when it releases, driven tick by tick
 * as the region gate would. Step variation is
 * `drumSequencerVariation.test.ts`; through the player, ratchets and swing
 * are `arrangementPlayerDrum.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { GATE_MIN, MIDI_MIDDLE_C, RATCHET_MAX } from '../audioConstants';
import { DRUM_GATE_DEFAULT } from './drumConstants';
import {
  DEFAULT_DRUM_CONFIG,
  DrumSequencer,
  assertDrumConfig,
  drumGateTicks,
  type DrumSequencerConfig,
} from './drumSequencer';
import { DRUM_REST, defaultDrumSteps, drumHit, type DrumStep } from './drumSteps';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import type { SeqOverrides } from './regionGate';
import { DIVISORS, TICKS_PER_BAR } from './scheduler';

const SIXTEENTH = DIVISORS.sixteenth;
const SECONDS_PER_TICK = 0.005;

/** A Drum over the default config with `over` written in. */
const drum = (over: Partial<DrumSequencerConfig> = {}): DrumSequencer =>
  new DrumSequencer({ ...DEFAULT_DRUM_CONFIG, ...over });

/** Every event the Drum emits over `ticks` local ticks from its entry. */
function run(
  sequencer: DrumSequencer,
  ticks: number,
  overrides?: SeqOverrides,
  from = 0,
): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (let tick = from; tick < from + ticks; tick++) {
    events.push(
      ...sequencer.handleTick({
        tick,
        step: tick,
        bar: Math.floor(tick / TICKS_PER_BAR),
        tickInBar: tick % TICKS_PER_BAR,
        seconds: tick * SECONDS_PER_TICK,
        secondsPerTick: SECONDS_PER_TICK,
        time: tick * SECONDS_PER_TICK,
        overrides,
      }),
    );
  }
  return events;
}

const ons = (events: readonly NoteEvent[]): NoteOnEvent[] =>
  events.filter((e): e is NoteOnEvent => e.kind === 'noteOn');
const offs = (events: readonly NoteEvent[]): NoteEvent[] =>
  events.filter((e) => e.kind === 'noteOff');
/** The line `steps` written over 16 rests. */
const line = (written: Record<number, DrumStep>, count = 16): DrumStep[] =>
  Array.from({ length: count }, (_, i) => written[i] ?? DRUM_REST);

describe('a new Drum part (decision 2)', () => {
  it('is a bar of sixteenths, four on the floor, on middle C at gate 0.5', () => {
    const config = DEFAULT_DRUM_CONFIG;
    expect(config.steps).toHaveLength(16);
    expect(config.length).toBe(16);
    expect(config.note).toBe(MIDI_MIDDLE_C);
    expect(config.gate).toBe(DRUM_GATE_DEFAULT);
    const hits = config.steps.flatMap((s, i) => (s.kind === 'hit' ? [i] : []));
    expect(hits).toEqual([0, 4, 8, 12]);
    expect(config.steps[0]).toEqual({ kind: 'hit', accent: false });
  });

  it('keeps the default hits a shorter bar holds, in the song’s meter', () => {
    const steps = defaultDrumSteps('3/4');
    expect(steps).toHaveLength(12);
    expect(steps.flatMap((s, i) => (s.kind === 'hit' ? [i] : []))).toEqual([0, 4, 8]);
  });

  it('plays 60 on steps 0, 4, 8 and 12, each released at half its step', () => {
    const events = run(drum(), TICKS_PER_BAR);
    expect(ons(events).map((e) => [e.tick, e.note])).toEqual([
      [0, 60],
      [24, 60],
      [48, 60],
      [72, 60],
    ]);
    expect(offs(events).map((e) => e.tick)).toEqual([3, 27, 51, 75]);
    // A plain hit sends nothing beyond its pitch: the part's velocity as it is.
    expect(ons(events)[0]).toEqual({ kind: 'noteOn', tick: 0, time: 0, note: 60, degree: 0 });
  });
});

describe('a hit (decision 4)', () => {
  it('sends its velocity as the fraction of the part’s, a ghost at 0.3 and a silent hit at 0', () => {
    const steps = line({ 0: drumHit({ velocity: 0.3 }), 4: drumHit({ velocity: 0 }) });
    const [ghost, silent] = ons(run(drum({ steps }), TICKS_PER_BAR));
    expect(ghost?.velocity).toBe(0.3);
    expect(silent?.velocity).toBe(0);
  });

  it('carries the accent’s bump and mod when accented', () => {
    const steps = line({ 0: drumHit({ accent: true }) });
    const [on] = ons(run(drum({ steps, accentVelocity: 0.3, accentMod: 0.7 }), SIXTEENTH));
    expect(on?.accent).toEqual({ velocity: 0.3, mod: 0.7 });
  });

  it('moves the played note by its pitch, and by octaves into MIDI when the sum leaves it', () => {
    const steps = line({ 0: drumHit({ pitch: 7 }), 1: drumHit({ pitch: -12 }) });
    expect(ons(run(drum({ steps }), 2 * SIXTEENTH)).map((e) => e.note)).toEqual([67, 48]);
    const high = ons(run(drum({ steps: line({ 0: drumHit({ pitch: 24 }) }), note: 120 }), 1));
    expect(high[0]?.note).toBe(144 - 24);
    const low = ons(run(drum({ steps: line({ 0: drumHit({ pitch: -24 }) }), note: 5 }), 1));
    expect(low[0]?.note).toBe(5 - 24 + 24);
  });

  it('rides the step-mod lanes’ offsets at its step, and sends none where they read 0', () => {
    const values = Array.from({ length: 16 }, (_, i) => (i === 4 ? 0.5 : 0));
    const lanes = [{ param: 'filter.cutoff' as const, values }];
    const events = ons(run(drum({ lanes }), TICKS_PER_BAR));
    expect(events[0]?.stepMod).toBeUndefined();
    expect(events[1]?.stepMod?.some((v) => v === 0.5)).toBe(true);
  });

  it('a rest plays nothing and releases nothing', () => {
    expect(run(drum({ steps: line({}) }), TICKS_PER_BAR)).toEqual([]);
  });
});

describe('the gate', () => {
  it('holds a hit its gate of the step, in whole ticks from one to the step', () => {
    expect(drumGateTicks(GATE_MIN, SIXTEENTH)).toBe(1);
    expect(drumGateTicks(0.5, SIXTEENTH)).toBe(3);
    expect(drumGateTicks(1, SIXTEENTH)).toBe(SIXTEENTH);
    const at = (gate: number): number[] =>
      offs(run(drum({ gate, steps: line({ 0: drumHit() }) }), 2 * SIXTEENTH)).map((e) => e.tick);
    expect(at(GATE_MIN)).toEqual([1]);
  });

  it('at 1 releases on the next step’s tick, before that step’s hit', () => {
    const steps = line({ 0: drumHit(), 1: drumHit({ pitch: 1 }) });
    const events = run(drum({ gate: 1, steps }), 2 * SIXTEENTH + 1);
    expect(events.map((e) => [e.kind, e.tick, e.note])).toEqual([
      ['noteOn', 0, 60],
      ['noteOff', SIXTEENTH, 60],
      ['noteOn', SIXTEENTH, 61],
      ['noteOff', 2 * SIXTEENTH, 61],
    ]);
  });

  it('reads the `seq.gate` lane on the step, over the Gate knob', () => {
    const at = (lane: number): number[] => {
      const sequencer = drum({ gate: 0.5, steps: line({ 0: drumHit() }) });
      return offs(run(sequencer, SIXTEENTH + 1, { gate: lane })).map((e) => e.tick);
    };
    expect(at(1)).toEqual([SIXTEENTH]);
    expect(at(0.25)).toEqual([2]);
  });

  it('a region end releases a held hit', () => {
    const sequencer = drum();
    run(sequencer, 1);
    expect(sequencer.heldNote).toBe(60);
    expect(sequencer.release(2, 0.01)).toEqual([
      { kind: 'noteOff', tick: 2, time: 0.01, note: 60 },
    ]);
    expect(sequencer.heldNote).toBeNull();
  });
});

describe('a ratchet', () => {
  it('rides the note-on as a closed roll over the step, each hit held the gate of its slice', () => {
    for (let hits = 2; hits <= RATCHET_MAX; hits++) {
      const sequencer = drum({ gate: 0.6, steps: line({ 0: drumHit({ ratchet: hits }) }) });
      const events = run(sequencer, SIXTEENTH);
      expect(ons(events)[0]?.roll).toEqual({
        hits,
        ticks: SIXTEENTH,
        secondsPerTick: SECONDS_PER_TICK,
        gate: 0.6,
        open: false,
      });
      // The player holds every hit: nothing is left for the Drum to release.
      expect(offs(events)).toEqual([]);
      expect(sequencer.heldNote).toBeNull();
    }
  });
});

describe('the loop', () => {
  it('length 1 plays step 0 every step', () => {
    const steps = line({ 0: drumHit() });
    const events = ons(run(drum({ steps, length: 1 }), TICKS_PER_BAR));
    expect(events.map((e) => e.tick)).toEqual(Array.from({ length: 16 }, (_, i) => i * SIXTEENTH));
  });

  it('a length shorter than the steps never sounds the steps past it', () => {
    const steps = line({ 0: drumHit(), 6: drumHit({ pitch: 5 }) });
    const events = ons(run(drum({ steps, length: 4 }), 2 * TICKS_PER_BAR));
    expect(events.every((e) => e.note === 60)).toBe(true);
    expect(events).toHaveLength(8);
  });

  it('plays 32 steps, and its playhead is the local step mod the length', () => {
    const steps = Array.from({ length: 32 }, (_, i) => drumHit({ pitch: i % 12 }));
    const sequencer = drum({ steps, length: 32, divisor: DIVISORS.thirtySecond });
    const events = ons(run(sequencer, 2 * TICKS_PER_BAR));
    expect(events).toHaveLength(64);
    expect(events[31]?.note).toBe(60 + (31 % 12));
    expect(sequencer.stepAt(33)).toBe(1);
    expect(drum({ length: 5 }).stepAt(12)).toBe(2);
  });
});

describe('the config check', () => {
  it('refuses a hit out of range and a note past MIDI', () => {
    const bad = (step: DrumStep): DrumSequencerConfig => ({
      ...DEFAULT_DRUM_CONFIG,
      steps: line({ 0: step }),
    });
    expect(() => assertDrumConfig(bad(drumHit({ pitch: 25 })))).toThrow(/pitch/);
    expect(() => assertDrumConfig(bad(drumHit({ pitch: 0.5 })))).toThrow(/pitch/);
    expect(() => assertDrumConfig(bad(drumHit({ velocity: 1.5 })))).toThrow(/velocity/);
    expect(() => assertDrumConfig(bad(drumHit({ ratchet: 5 })))).toThrow(/ratchet/);
    expect(() => assertDrumConfig({ ...DEFAULT_DRUM_CONFIG, note: 128 })).toThrow(/note/);
    expect(() => assertDrumConfig({ ...DEFAULT_DRUM_CONFIG, gate: 0 })).toThrow(/gate/);
    expect(() => assertDrumConfig({ ...DEFAULT_DRUM_CONFIG, length: 17 })).toThrow(/length/);
  });

  it('a live edit keeps the held hit and the stream; a divisor or seed change refuses', () => {
    const sequencer = drum();
    run(sequencer, 1);
    sequencer.reconfigure({ ...DEFAULT_DRUM_CONFIG, gate: 1 });
    expect(sequencer.heldNote).toBe(60);
    expect(() => sequencer.reconfigure({ ...DEFAULT_DRUM_CONFIG, divisor: 12 })).toThrow();
    expect(() => sequencer.reconfigure({ ...DEFAULT_DRUM_CONFIG, seed: 1 })).toThrow();
  });
});
