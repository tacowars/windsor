/**
 * A gate per Arp cell at the generator (windsor#933): the cell's gate
 * scales the part's (the Gate knob or the `seq.gate` lane), floored at
 * `GATE_MIN`; a tie or a slide next still runs the note to that onset; a
 * ratcheted cell's roll is held at the played gate. Driven tick by tick as
 * the region gate would, `up` over a C-minor triad at one octave. The rule
 * alone is `arpPlayedGate` in `arpCellPlay.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { GATE_MIN } from '../audioConstants';
import { chordAt, type Harmony } from '../harmony/harmonyTimeline';
import { DEFAULT_ARP_CONFIG, type ArpSequencerConfig } from './arpSequencer';
import { arpNote, defaultArpSteps, type ArpNoteStep, type ArpStep } from './arpSteps';
import { Arpeggiator } from './arpeggiator';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import type { SeqOverrides } from './regionGate';
import { ScaleSampler } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR } from './scheduler';

const QUARTER = DIVISORS.quarter;
const SONG = 4 * TICKS_PER_BAR;
const MINOR = { root: 0, scale: 'naturalMinor' } as const;
const sampler = new ScaleSampler(MINOR);
const TONIC: Harmony = { ...MINOR, events: [{ start: 0, duration: SONG, degree: 0, size: 3 }] };
const c4 = sampler.rootNote(DEFAULT_ARP_CONFIG.register.octave);
const CM = [0, 3, 7].map((o) => c4 + o);
const STEPS = 6;

/** The default cells with the given ones written over them. */
const cells = (written: Record<number, ArpStep>): ArpStep[] => {
  const steps = defaultArpSteps();
  for (const [k, cell] of Object.entries(written)) steps[Number(k)] = cell;
  return steps;
};
/** Every cell a plain note at `gate`. */
const gatedAll = (gate: number): ArpStep[] => defaultArpSteps().map(() => arpNote({ gate }));

function run(over: Partial<ArpSequencerConfig>, overrides?: SeqOverrides): NoteEvent[] {
  const arp = new Arpeggiator(sampler, {
    ...DEFAULT_ARP_CONFIG,
    style: 'up',
    divisor: QUARTER,
    octaves: 1,
    ...over,
  });
  const events: NoteEvent[] = [];
  for (let tick = 0; tick < STEPS * QUARTER; tick++) {
    events.push(
      ...arp.handleTick({
        tick,
        step: tick,
        bar: Math.floor(tick / TICKS_PER_BAR),
        tickInBar: tick % TICKS_PER_BAR,
        seconds: 0,
        secondsPerTick: 0,
        time: tick,
        chord: chordAt(TONIC, SONG, tick),
        regionIndex: 0,
        overrides,
      }),
    );
  }
  return events;
}
const offTick = (events: readonly NoteEvent[], note: number): number | undefined =>
  events.find((e) => e.kind === 'noteOff' && e.note === note)?.tick;
const firstOn = (events: readonly NoteEvent[]): NoteOnEvent | undefined =>
  events.find((e): e is NoteOnEvent => e.kind === 'noteOn');

describe('the played gate: the part’s gate times the cell’s', () => {
  it('cell gate 0.5 under part gate 0.8 releases at 0.4 of the step, as part gate 0.4 does', () => {
    const events = run({ gate: 0.8, steps: gatedAll(0.5) });
    expect(offTick(events, CM[0]!)).toBe(Math.round(0.4 * QUARTER));
    expect(events).toStrictEqual(run({ gate: 0.4 }));
  });

  it('scales the `seq.gate` lane where one plays, not the knob under it', () => {
    const events = run({ gate: 0.9, steps: gatedAll(0.5) }, { gate: 0.6 });
    expect(events).toStrictEqual(run({ gate: 0.3 }));
  });

  it('a product under GATE_MIN releases at GATE_MIN', () => {
    const events = run({ gate: 2 * GATE_MIN, steps: gatedAll(GATE_MIN) });
    expect(events).toStrictEqual(run({ gate: GATE_MIN }));
  });

  it('part gate 1 with cell gate 1 runs to the next onset, as today', () => {
    const events = run({ gate: 1, steps: gatedAll(1) });
    expect(offTick(events, CM[0]!)).toBe(QUARTER);
    expect(events).toStrictEqual(run({ gate: 1 }));
  });

  it('gates only its own cell: the neighbours ring at the part’s gate', () => {
    const events = run({ gate: 0.8, steps: cells({ 1: arpNote({ gate: 0.25 }) }) });
    expect(offTick(events, CM[0]!)).toBe(Math.round(0.8 * QUARTER));
    expect(offTick(events, CM[1]!)).toBe(QUARTER + Math.round(0.2 * QUARTER));
    expect(offTick(events, CM[2]!)).toBe(2 * QUARTER + Math.round(0.8 * QUARTER));
  });
});

describe('a tie or a slide next runs a gated note to its onset', () => {
  const short: ArpNoteStep = arpNote({ gate: 0.25 });

  it('before a tie: no release until the tie’s own step lets go at the part’s gate', () => {
    const events = run({ gate: 0.8, steps: cells({ 0: short, 1: { kind: 'tie' } }) });
    expect(offTick(events, CM[0]!)).toBe(QUARTER + Math.round(0.8 * QUARTER));
  });

  it('before a slide: the held note lets go only as the slide takes the voice', () => {
    const slide = arpNote({ slide: true });
    const events = run({ gate: 0.8, steps: cells({ 0: short, 1: slide }) });
    expect(offTick(events, CM[0]!)).toBe(QUARTER);
    expect(events.filter((e) => e.tick === QUARTER).map((e) => e.kind)).toEqual([
      'noteOn',
      'noteOff',
    ]);
  });
});

describe('a ratcheted cell’s roll at the played gate', () => {
  const rolled = arpNote({ ratchet: 3, gate: 0.5 });

  it('its closed hits are held at the part’s gate times the cell’s', () => {
    const on = firstOn(run({ gate: 0.8, steps: cells({ 0: rolled }) }));
    expect(on?.roll).toEqual({
      hits: 3,
      ticks: QUARTER,
      secondsPerTick: 0,
      gate: 0.4,
      open: false,
    });
  });

  it('floored at GATE_MIN, and left open before a tie', () => {
    const floored = arpNote({ ratchet: 3, gate: GATE_MIN });
    expect(firstOn(run({ gate: 0.5, steps: cells({ 0: floored }) }))?.roll?.gate).toBe(GATE_MIN);
    const tied = firstOn(run({ gate: 0.8, steps: cells({ 0: rolled, 1: { kind: 'tie' } }) }));
    expect(tied?.roll).toMatchObject({ gate: 0.4, open: true });
  });
});
