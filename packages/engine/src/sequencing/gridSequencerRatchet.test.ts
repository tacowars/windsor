/**
 * A ratcheted Grid step at the generator (windsor#366): its note-on carries
 * the roll the player spends, the grid still holds the note as it would a
 * plain one, a slide to the pitch held stays a tie, and the config check
 * refuses a ratchet out of 1–`RATCHET_MAX`. Through the player:
 * `song/arrangementPlayerGridRatchets.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GRID_CONFIG,
  GridSequencer,
  gridNote,
  type GridSequencerConfig,
  type GridStep,
} from './gridSequencer';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import { ScaleSampler } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR, TickTransport } from './scheduler';

/** C minor at register octave 3: degree 0 is 48, degree 2 is 51. */
const minor = new ScaleSampler({ root: 0, scale: 'naturalMinor' });
const REST: GridStep = { kind: 'rest' };
const TIE: GridStep = { kind: 'tie' };
const SIXTEENTH = DIVISORS.sixteenth;

function make(steps: readonly GridStep[], extra: Partial<GridSequencerConfig> = {}): GridSequencer {
  return new GridSequencer(minor, {
    ...DEFAULT_GRID_CONFIG,
    register: { octave: 3 },
    steps,
    length: steps.length,
    ...extra,
  });
}

function run(seq: GridSequencer): NoteEvent[] {
  const transport = new TickTransport(120);
  const events: NoteEvent[] = [];
  seq.onNote = (e) => events.push(e);
  seq.attach(transport);
  for (let i = 0; i < TICKS_PER_BAR; i++) transport.advance(i * transport.secondsPerTick);
  return events;
}

const ons = (events: NoteEvent[]): NoteOnEvent[] =>
  events.filter((e): e is NoteOnEvent => e.kind === 'noteOn');

describe('GridSequencer ratchets (windsor#366)', () => {
  it('a ratcheted note step’s note-on carries its roll; a plain one carries none', () => {
    const events = run(make([gridNote(0, { ratchet: 3 }), gridNote(2), REST, TIE]));
    const [rolled, plain] = ons(events);
    expect(rolled).toMatchObject({ note: 48, tick: 0 });
    expect(rolled?.roll).toEqual({
      hits: 3,
      ticks: SIXTEENTH,
      secondsPerTick: new TickTransport(120).secondsPerTick,
      gate: 1,
      open: true,
    });
    expect(plain).not.toHaveProperty('roll');
    // The grid still holds the note: the next step releases it as it would a plain one.
    expect(events[1]).toMatchObject({ kind: 'noteOff', note: 48, tick: SIXTEENTH });
  });

  it('a slide to the pitch held stays a tie, its ratchet unheard', () => {
    const events = run(make([gridNote(0), gridNote(0, { slide: true, ratchet: 4 }), REST]));
    expect(events.slice(0, 2).map((e) => [e.kind, e.tick])).toEqual([
      ['noteOn', 0],
      ['noteOff', 2 * SIXTEENTH],
    ]);
  });

  it('rejects a ratchet the normaliser should never hand it', () => {
    for (const ratchet of [0, 5, 2.5]) {
      expect(() => make([gridNote(0, { ratchet })])).toThrow(/ratchet/);
    }
    expect(() => make([gridNote(0, { ratchet: 1 })])).not.toThrow();
  });
});
