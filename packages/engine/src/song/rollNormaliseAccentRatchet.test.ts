/**
 * A Roll note's accent and ratchet through the normaliser (windsor#753,
 * record `2026-10-12-roll-note-accent-and-ratchet`): a roll without them
 * loads, plays and writes exactly as before; with them it round-trips byte
 * for byte and passes the check; a plain value leaves no key; junk is
 * dropped and an amount clamped, reported; and a chord's notes lose both
 * marks and a note under `ROLL_RATCHET_MIN_TICKS` its ratchet, reported.
 */
import { describe, expect, it } from 'vitest';

import { currentDocument } from '../__fixtures__/arrangementDocumentFiles';
import type { NoteEvent } from '../sequencing/noteEvent';
import { ROLL_RATCHET_MIN_TICKS } from '../sequencing/rollNoteTables';
import { RollSequencer, assertRollConfig } from '../sequencing/rollSequencer';
import type { RollSpec } from './arrangement';
import { makeArrangement } from './arrangementDocument';
import { FieldNormaliser } from './arrangementFields';
import { normaliseSequencer } from './sequencerNormalise';

const PATH = 'parts[0].sequencer';
const NOTES = `${PATH}.notes`;

function roll(raw: Record<string, unknown>): { spec: RollSpec; corrections: string[] } {
  const n = new FieldNormaliser();
  const spec = normaliseSequencer({ kind: 'roll', ...raw }, PATH, n) as RollSpec;
  return { spec, corrections: n.corrections };
}

/** What a roll plays over its loop, every key of every event. */
function performed(spec: RollSpec): NoteEvent[] {
  const performer = new RollSequencer(spec);
  const out: NoteEvent[] = [];
  for (let tick = 0; tick <= spec.loopTicks; tick++) {
    const event = { tick, step: tick, bar: 0, tickInBar: tick, seconds: tick };
    out.push(
      ...performer.handleTick({
        ...event,
        secondsPerTick: 1,
        time: tick,
        chord: null,
        regionIndex: 0,
      }),
    );
  }
  return out;
}

describe('a roll without accents or ratchets (windsor#753)', () => {
  it('normalises, plays and writes exactly as before', () => {
    const fixture = currentDocument('roll-part');
    const written = fixture.parts as { sequencer: RollSpec }[];
    const loaded = makeArrangement(fixture);
    expect(loaded.corrections).toEqual([]);
    for (const [i, part] of written.entries()) {
      const spec = loaded.document.parts[i]?.sequencer as RollSpec;
      expect(JSON.stringify(spec)).toBe(JSON.stringify(part.sequencer));
      // Every note-on is as it was: no accent and no roll.
      for (const event of performed(spec)) {
        expect(event).not.toHaveProperty('accent');
        expect(event).not.toHaveProperty('roll');
      }
    }
    expect(performed(loaded.document.parts[1]?.sequencer as RollSpec).length).toBeGreaterThan(0);
  });
});

describe('Roll accents and ratchets in a document (windsor#753)', () => {
  it('keep their marks and amounts, round-trip byte for byte and pass the check', () => {
    const raw = {
      loopTicks: 96,
      notes: [
        { tick: 0, ticks: 12, pitch: 60, velocity: 0.5, accent: true, ratchet: 4 },
        { tick: 12, ticks: ROLL_RATCHET_MIN_TICKS, pitch: 62, ratchet: 2 },
        { tick: 24, ticks: 12, pitch: 64, accent: true },
      ],
      accentVelocity: 0.4,
      accentMod: 0.5,
    };
    const { spec, corrections } = roll(raw);
    expect(corrections).toEqual([]);
    expect(spec).toEqual({ kind: 'roll', ...raw });
    const text = JSON.stringify(spec);
    expect(JSON.stringify(roll(JSON.parse(text) as Record<string, unknown>).spec)).toBe(text);
    expect(() => assertRollConfig(spec)).not.toThrow();
  });

  it('writes a plain accent, a single hit and the default amounts as no key, with no report', () => {
    const { spec, corrections } = roll({
      loopTicks: 96,
      notes: [{ tick: 0, ticks: 12, pitch: 60, accent: false, ratchet: 1 }],
      accentVelocity: 0.2,
      accentMod: 1,
    });
    expect(spec).toEqual({
      kind: 'roll',
      loopTicks: 96,
      notes: [{ tick: 0, ticks: 12, pitch: 60 }],
    });
    expect(corrections).toEqual([]);
  });

  it('drops a ratchet of 5, 0 or 1.5 and an accent of "yes", and clamps an amount, each reported', () => {
    const { spec, corrections } = roll({
      loopTicks: 96,
      notes: [
        { tick: 0, ticks: 12, pitch: 60, ratchet: 5 },
        { tick: 12, ticks: 12, pitch: 60, ratchet: 0 },
        { tick: 24, ticks: 12, pitch: 60, ratchet: 1.5 },
        { tick: 36, ticks: 12, pitch: 60, accent: 'yes' },
      ],
      accentVelocity: -1,
      accentMod: 2,
    });
    expect(spec.notes).toEqual([
      { tick: 0, ticks: 12, pitch: 60 },
      { tick: 12, ticks: 12, pitch: 60 },
      { tick: 24, ticks: 12, pitch: 60 },
      { tick: 36, ticks: 12, pitch: 60 },
    ]);
    // An amount clamped to its default leaves no key; one clamped elsewhere stays.
    expect(spec.accentVelocity).toBe(0);
    expect(spec).not.toHaveProperty('accentMod');
    expect(corrections).toEqual([
      `${NOTES}[0].ratchet: 5 is not a whole number 1..4 — dropped`,
      `${NOTES}[1].ratchet: 0 is not a whole number 1..4 — dropped`,
      `${NOTES}[2].ratchet: 1.5 is not a whole number 1..4 — dropped`,
      `${NOTES}[3].accent: "yes" is not a boolean — dropped`,
      `${PATH}.accentVelocity: clamped -1 to 0`,
      `${PATH}.accentMod: clamped 2 to 1`,
    ]);
    expect(() => assertRollConfig(spec)).not.toThrow();
  });
});

describe('the marks a note may not carry (windsor#753)', () => {
  it("clears both from a chord's notes, and leaves a lone note's, each clear reported", () => {
    const { spec, corrections } = roll({
      loopTicks: 96,
      notes: [
        { tick: 0, ticks: 12, pitch: 64, ratchet: 2 },
        { tick: 0, ticks: 12, pitch: 60, accent: true },
        { tick: 0, ticks: 12, pitch: 67 },
        { tick: 12, ticks: 12, pitch: 62, accent: true, ratchet: 3 },
      ],
    });
    expect(spec.notes).toEqual([
      { tick: 0, ticks: 12, pitch: 60 },
      { tick: 0, ticks: 12, pitch: 64 },
      { tick: 0, ticks: 12, pitch: 67 },
      { tick: 12, ticks: 12, pitch: 62, accent: true, ratchet: 3 },
    ]);
    expect(corrections).toEqual([
      `${NOTES}: the note at tick 0 pitch 60 shares its onset with another — its accent and ratchet cleared`,
      `${NOTES}: the note at tick 0 pitch 64 shares its onset with another — its accent and ratchet cleared`,
    ]);
  });

  it(`clears a ratchet from a 2-tick note, keeps one on a ${ROLL_RATCHET_MIN_TICKS}-tick note, and keeps the short note's accent`, () => {
    const { spec, corrections } = roll({
      loopTicks: 96,
      notes: [
        { tick: 0, ticks: 2, pitch: 60, accent: true, ratchet: 2 },
        { tick: 6, ticks: 3, pitch: 60, ratchet: 3 },
      ],
    });
    expect(spec.notes).toEqual([
      { tick: 0, ticks: 2, pitch: 60, accent: true },
      { tick: 6, ticks: 3, pitch: 60, ratchet: 3 },
    ]);
    expect(corrections).toEqual([
      `${NOTES}: the note at tick 0 pitch 60 is shorter than 3 ticks — its ratchet cleared`,
    ]);
  });

  it('clears a ratchet from a note trimmed short by the next one at its pitch', () => {
    const { spec, corrections } = roll({
      loopTicks: 96,
      notes: [
        { tick: 0, ticks: 12, pitch: 60, ratchet: 4 },
        { tick: 2, ticks: 12, pitch: 60 },
      ],
    });
    expect(spec.notes[0]).toEqual({ tick: 0, ticks: 2, pitch: 60 });
    expect(corrections).toEqual([
      `${NOTES}: the note at tick 0 pitch 60 runs into the next — trimmed to 2 ticks`,
      `${NOTES}: the note at tick 0 pitch 60 is shorter than 3 ticks — its ratchet cleared`,
    ]);
  });
});
