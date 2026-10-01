/**
 * A ratcheted arp cell at the generator (windsor#366): its note-on carries
 * the roll at the arp's gate, and the last hit is left open, held into the
 * next onset, exactly where a plain note would run there; the config check
 * refuses a ratchet out of 1–`RATCHET_MAX`. Through the player:
 * `song/arrangementPlayerArpRatchets.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { playArpCell, type ArpCellConfig, type ArpCellOutcome, type ArpOnset } from './arpCellPlay';
import { rollOutcome } from './arpeggiator';
import { assertArpGrid, arpNote, defaultArpSteps, type ArpStep } from './arpSteps';
import type { NoteEvent, NoteOnEvent } from './noteEvent';

const CONFIG: ArpCellConfig = {
  gate: 0.5,
  divisor: 12,
  accentVelocity: 0.3,
  accentMod: 0.7,
  lanes: [],
};
const CLOCK = { secondsPerTick: 0.02 };
const onset = (over: Partial<ArpOnset> = {}): ArpOnset => ({
  tick: 24,
  time: 1,
  degree: 0,
  cell: arpNote({ ratchet: 3 }),
  index: 0,
  pitch: 60,
  held: 55,
  holdsOn: false,
  ...over,
});
const rolled = (o: ArpOnset, config: ArpCellConfig = CONFIG): ArpCellOutcome =>
  rollOutcome(playArpCell(o, config), 3, config, CLOCK);
const noteOn = (events: readonly NoteEvent[]): NoteOnEvent | undefined =>
  events.find((e): e is NoteOnEvent => e.kind === 'noteOn');

describe('rollOutcome (windsor#366)', () => {
  it('a gated cell: the roll at the arp’s gate, nothing left held, no gate release', () => {
    const out = rolled(onset());
    expect(noteOn(out.events)?.roll).toEqual({
      hits: 3,
      ticks: 12,
      secondsPerTick: 0.02,
      gate: 0.5,
      open: false,
    });
    // The note held into the onset is still released there, before the roll's first hit.
    expect(out.events[0]).toMatchObject({ kind: 'noteOff', note: 55 });
    expect(out).toMatchObject({ held: null, releaseTick: null });
  });

  it('a tie or slide next, or a gate covering the step: the last hit is open and held', () => {
    for (const out of [rolled(onset({ holdsOn: true })), rolled(onset(), { ...CONFIG, gate: 1 })]) {
      expect(noteOn(out.events)?.roll?.open).toBe(true);
      expect(out).toMatchObject({ held: 60, releaseTick: null });
    }
  });

  it('a cell that strikes nothing is left as it played', () => {
    const tie = playArpCell(onset({ cell: { kind: 'tie' } }), CONFIG);
    expect(rollOutcome(tie, 3, CONFIG, CLOCK)).toBe(tie);
    const slide = arpNote({ slide: true, ratchet: 3 });
    const same = playArpCell(onset({ cell: slide, held: 60 }), CONFIG);
    expect(rollOutcome(same, 3, CONFIG, CLOCK)).toBe(same);
  });
});

describe('an arp cell’s ratchet in the config check (windsor#366)', () => {
  const grid = (cell: ArpStep): Parameters<typeof assertArpGrid>[0] => ({
    steps: [cell, ...defaultArpSteps().slice(1)],
    lanes: [],
    accentVelocity: 0,
    accentMod: 0,
    skipChance: 0,
  });

  it('takes 1–4 and refuses anything else', () => {
    for (const ratchet of [1, 2, 4]) {
      expect(() => assertArpGrid(grid(arpNote({ ratchet })))).not.toThrow();
    }
    for (const ratchet of [0, 5, 1.5]) {
      expect(() => assertArpGrid(grid(arpNote({ ratchet })))).toThrow(/ratchet/);
    }
  });
});
