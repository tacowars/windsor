/**
 * A Grid step's and an Arp cell's `ratchet` through the document normaliser
 * (windsor#366, decisions 2 and 8): absent stays absent, a 1 is dropped so an
 * export carries no default, a value out of 1–`RATCHET_MAX` or a fraction is
 * clamped or rounded with a report, a ratchet on a rest or a tie is dropped
 * with a report, and a song with ratchets round-trips.
 */
import { describe, expect, it } from 'vitest';

import { FieldNormaliser } from './arrangementFields';
import { isShippable, makeArrangement } from './arrangementDocument';
import { normaliseSequencer } from './sequencerNormalise';
import { ARRANGEMENT_VERSION, EUCLID_RATCHET_MAX, RATCHET_MAX } from '../audioConstants';
import { ARP_STEPS_MAX } from '../sequencing/arpStepConstants';
import { makePatch } from '../patch/patch';

const PATH = 'parts[0].sequencer';
const GRID = { kind: 'grid', seed: 0, divisor: 6 };
const ARP = { kind: 'arp', seed: 0, divisor: 6 };

function normalise(
  base: Record<string, unknown>,
  steps: unknown[],
): { steps: Array<Record<string, unknown>>; corrections: string[] } {
  const n = new FieldNormaliser();
  const spec = normaliseSequencer({ ...base, steps }, PATH, n) as unknown as {
    steps: Array<Record<string, unknown>>;
  };
  return { steps: spec.steps, corrections: n.corrections };
}

/** An Arp's cells padded to `ARP_STEPS_MAX` with plain notes, so only the cells under test report. */
const cells = (...written: unknown[]): unknown[] =>
  Array.from({ length: ARP_STEPS_MAX }, (_, i) => written[i] ?? { kind: 'note' });

describe('step ratchets through the normaliser (windsor#366)', () => {
  it('shares one ceiling with Euclid', () => {
    expect(RATCHET_MAX).toBe(4);
    expect(EUCLID_RATCHET_MAX).toBe(RATCHET_MAX);
  });

  for (const [name, base, wrap] of [
    ['Grid', GRID, (...s: unknown[]) => s],
    ['Arp', ARP, cells],
  ] as const) {
    describe(`a ${name} step`, () => {
      it('keeps 2–4, with nothing to report, and leaves an absent one absent', () => {
        const { steps, corrections } = normalise(
          base,
          wrap({ kind: 'note', ratchet: 2 }, { kind: 'note', ratchet: 4 }, { kind: 'note' }),
        );
        expect(corrections).toEqual([]);
        expect(steps[0]).toMatchObject({ kind: 'note', ratchet: 2 });
        expect(steps[1]).toMatchObject({ kind: 'note', ratchet: 4 });
        expect(steps[2]).not.toHaveProperty('ratchet');
      });

      it('drops a 1 silently', () => {
        const { steps, corrections } = normalise(base, wrap({ kind: 'note', ratchet: 1 }));
        expect(corrections).toEqual([]);
        expect(steps[0]).not.toHaveProperty('ratchet');
      });

      it('clamps 0 and 5 and rounds 2.5, each reported', () => {
        const { steps, corrections } = normalise(
          base,
          wrap(
            { kind: 'note', ratchet: 0 },
            { kind: 'note', ratchet: 5 },
            { kind: 'note', ratchet: 2.5 },
            { kind: 'note', ratchet: 'x' },
          ),
        );
        expect(steps[0]).not.toHaveProperty('ratchet');
        expect(steps[1]).toMatchObject({ ratchet: 4 });
        expect(steps[2]).toMatchObject({ ratchet: 3 });
        expect(steps[3]).not.toHaveProperty('ratchet');
        expect(corrections).toEqual([
          `${PATH}.steps[0].ratchet: clamped 0 to 1`,
          `${PATH}.steps[1].ratchet: clamped 5 to 4`,
          `${PATH}.steps[2].ratchet: rounded 2.5 to 3`,
          `${PATH}.steps[3].ratchet: "x" is not a number — using 1`,
        ]);
      });

      it('drops a ratchet on a rest or a tie, reported', () => {
        const { steps, corrections } = normalise(
          base,
          wrap({ kind: 'rest', ratchet: 3 }, { kind: 'tie', ratchet: 2 }),
        );
        expect(steps[0]).toEqual({ kind: 'rest' });
        expect(steps[1]).toEqual({ kind: 'tie' });
        expect(corrections).toEqual([
          `${PATH}.steps[0].ratchet: a rest plays no hit — ratchet dropped`,
          `${PATH}.steps[1].ratchet: a tie plays no hit — ratchet dropped`,
        ]);
      });
    });
  }
});

const GRID_STEPS = [
  { kind: 'note', degree: 0, octave: 0, accent: true, slide: false, ratchet: 3 },
  { kind: 'tie' },
  { kind: 'note', degree: 2, octave: 0, accent: false, slide: true, ratchet: 2 },
  { kind: 'rest' },
];
const ARP_CELLS = cells(
  { kind: 'note', octave: 1, accent: false, slide: false, ratchet: 4 },
  { kind: 'tie' },
);

/** A two-part song, a Grid and an Arp, each with ratchets on its sequencer and on a region's pattern. */
function song(): Record<string, unknown> {
  const regions = (pattern: Record<string, unknown>): unknown[] => [
    { start: 0, duration: 96 },
    { start: 96, duration: 96, pattern },
  ];
  return {
    version: ARRANGEMENT_VERSION,
    transport: { bpm: 120, bars: 2 },
    harmony: { root: 0, scale: 'naturalMinor' },
    patches: { lead: makePatch({ name: 'lead' }) },
    parts: [
      {
        slot: 0,
        name: 'grid',
        preset: 'lead',
        regions: regions({ kind: 'grid', divisor: 6, steps: GRID_STEPS.slice(0, 2) }),
        sequencer: { ...GRID, steps: GRID_STEPS },
      },
      {
        slot: 1,
        name: 'arp',
        preset: 'lead',
        regions: regions({ kind: 'arp', divisor: 6, steps: ARP_CELLS }),
        sequencer: { ...ARP, steps: ARP_CELLS },
      },
    ],
  };
}

describe('a song with step ratchets round trips (windsor#366)', () => {
  it('keeps every ratchet on a part and on a region’s pattern through export and import', () => {
    const first = makeArrangement(song());
    expect(isShippable(first)).toBe(true);
    const [grid, arp] = first.document.parts;
    expect(grid?.sequencer).toMatchObject({ steps: GRID_STEPS });
    expect(grid?.regions[1]?.pattern).toMatchObject({ steps: GRID_STEPS.slice(0, 2) });
    expect(arp?.sequencer).toMatchObject({ steps: ARP_CELLS });
    expect(arp?.regions[1]?.pattern).toMatchObject({ steps: ARP_CELLS });
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });
});
