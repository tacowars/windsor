/**
 * The Roll kind through the normaliser (windsor#599): a document at its
 * defaults and one with chords, extreme pitches and a note past the loop
 * both load clean and round-trip byte for byte, and nothing plays; the
 * notes are sorted silently, and every other repair is reported, on the
 * part's sequencer and on a region's pattern alike.
 */
import { describe, expect, it } from 'vitest';

import { currentDocument } from '../__fixtures__/arrangementDocumentFiles';
import { silentPart } from '../__fixtures__/documentCases';
import { ROLL_NOTES_MAX } from '../audioConstants';
import { TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import type { RollSpec } from './arrangement';
import { makeArrangement } from './arrangementDocument';
import { FieldNormaliser } from './arrangementFields';
import { ArrangementPlayer } from './arrangementPlayer';
import { normaliseRegionPattern, normaliseSequencer } from './sequencerNormalise';

const PATH = 'parts[0].sequencer';

function roll(raw: Record<string, unknown>): { spec: RollSpec; corrections: string[] } {
  const n = new FieldNormaliser();
  const spec = normaliseSequencer({ kind: 'roll', ...raw }, PATH, n) as RollSpec;
  return { spec, corrections: n.corrections };
}

const FIXTURE = currentDocument('roll-part');
const WRITTEN = FIXTURE.parts as { sequencer: object; regions: object[] }[];

describe('a Roll part in a document (windsor#599)', () => {
  it('loads with no correction, round-trips byte for byte and plays nothing', () => {
    const first = makeArrangement(FIXTURE);
    expect(first.corrections).toEqual([]);
    const parts = first.document.parts;
    for (const [i, written] of WRITTEN.entries()) {
      expect(JSON.stringify(parts[i]?.sequencer)).toBe(JSON.stringify(written.sequencer));
      expect(JSON.stringify(parts[i]?.regions)).toBe(JSON.stringify(written.regions));
    }
    // The note at tick 300 lies past the 192-tick loop, and is kept.
    expect((parts[1]?.sequencer as RollSpec).notes.at(-1)).toEqual({
      tick: 300,
      ticks: 6,
      pitch: 72,
    });
    const text = JSON.stringify(first.document);
    expect(JSON.stringify(makeArrangement(JSON.parse(text)).document)).toBe(text);

    let played = 0;
    const part = { ...silentPart(), noteOn: () => ++played, trigger: () => ++played };
    const transport = new TickTransport();
    const doc = first.document;
    const playing = new Map(doc.parts.map((p) => [p.slot, part]));
    const player = new ArrangementPlayer(transport, playing, doc, doc.patches ?? {});
    for (let i = 0; i < 4 * TICKS_PER_BAR; i++) transport.advance(0);
    player.dispose();
    expect(played).toBe(0);
  });
});

describe('Roll normalisation (windsor#599)', () => {
  it('defaults an absent loop to one bar of the meter, and asks for no seed', () => {
    const n = new FieldNormaliser();
    n.meter = '7/8';
    expect(normaliseSequencer({ kind: 'roll' }, PATH, n)).toEqual({
      kind: 'roll',
      loopTicks: 84,
      notes: [],
    });
    expect(n.corrections).toEqual([]);
  });

  it('sorts the notes by tick, then pitch, with no report', () => {
    const { spec, corrections } = roll({
      notes: [
        { tick: 24, ticks: 6, pitch: 60 },
        { tick: 0, ticks: 6, pitch: 67 },
        { tick: 0, ticks: 6, pitch: 60 },
      ],
    });
    expect(spec.notes.map((note) => [note.tick, note.pitch])).toEqual([
      [0, 60],
      [0, 67],
      [24, 60],
    ]);
    expect(corrections).toEqual([]);
  });

  it('trims a same-pitch overlap and drops an exact duplicate, each reported', () => {
    const { spec, corrections } = roll({
      notes: [
        { tick: 0, ticks: 48, pitch: 60 },
        { tick: 24, ticks: 24, pitch: 60 },
        { tick: 24, ticks: 12, pitch: 60, velocity: 0.5 },
        { tick: 0, ticks: 48, pitch: 64 },
      ],
    });
    expect(spec.notes).toEqual([
      { tick: 0, ticks: 24, pitch: 60 },
      { tick: 0, ticks: 48, pitch: 64 },
      { tick: 24, ticks: 24, pitch: 60 },
    ]);
    expect(corrections).toEqual([
      `${PATH}.notes: the note at tick 0 pitch 60 runs into the next — trimmed to 24 ticks`,
      `${PATH}.notes: a second note at tick 24 pitch 60 — dropped`,
    ]);
  });

  it('clamps or rounds each number, and drops junk and a velocity of 1, each reported but the last', () => {
    const { spec, corrections } = roll({
      loopTicks: 0,
      notes: [
        { tick: 1.5, ticks: 0, pitch: 130, velocity: 1.4, slide: true },
        { tick: 4, ticks: 6, pitch: 60, velocity: 1 },
        'C4',
      ],
      seed: 3,
    });
    expect(spec).toEqual({
      kind: 'roll',
      loopTicks: 1,
      notes: [
        { tick: 2, ticks: 1, pitch: 127 },
        { tick: 4, ticks: 6, pitch: 60 },
      ],
    });
    expect(corrections).toEqual([
      `${PATH}.seed: unknown key dropped`,
      `${PATH}.loopTicks: clamped 0 to 1`,
      `${PATH}.notes[0].slide: unknown key dropped`,
      `${PATH}.notes[0].tick: rounded 1.5 to 2`,
      `${PATH}.notes[0].ticks: clamped 0 to 1`,
      `${PATH}.notes[0].pitch: clamped 130 to 127`,
      `${PATH}.notes[0].velocity: clamped 1.4 to 1`,
      `${PATH}.notes[2]: "C4" is not a note — dropped`,
    ]);
  });

  it(`trims the notes past ${ROLL_NOTES_MAX}, reported`, () => {
    const notes = Array.from({ length: ROLL_NOTES_MAX + 1 }, (_, i) => ({
      tick: i,
      ticks: 1,
      pitch: 60,
    }));
    const { spec, corrections } = roll({ notes });
    expect(spec.notes).toHaveLength(ROLL_NOTES_MAX);
    expect(spec.notes.at(-1)?.tick).toBe(ROLL_NOTES_MAX - 1);
    expect(corrections).toEqual([
      `${PATH}.notes: ${ROLL_NOTES_MAX + 1} notes trimmed to ${ROLL_NOTES_MAX}`,
    ]);
  });

  it("normalises a region's pattern by the same rules", () => {
    const raw = {
      kind: 'roll',
      loopTicks: 192,
      notes: [
        { tick: 24, ticks: 6, pitch: 60 },
        { tick: 0, ticks: 48, pitch: 60, velocity: 1.4 },
      ],
    };
    const n = new FieldNormaliser();
    const pattern = normaliseRegionPattern(raw, 'roll', 'parts[0].regions[0].pattern', n);
    const part = roll(raw);
    expect(pattern).toEqual(part.spec);
    expect(n.corrections).toEqual(
      part.corrections.map((c) => c.replace(PATH, 'parts[0].regions[0].pattern')),
    );
    expect(n.corrections).toHaveLength(2);
  });
});
