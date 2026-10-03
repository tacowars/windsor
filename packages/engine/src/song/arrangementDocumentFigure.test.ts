/**
 * A Figure part in a document (windsor#484): at its defaults it loads clean
 * and round-trips byte for byte; a canon `source`, on the part or on a
 * region's pattern, survives only when it names another Figure part. How it
 * plays is `arrangementPlayerFigure.test.ts` (windsor#485).
 */
import { describe, expect, it } from 'vitest';

import { currentDocument } from '../__fixtures__/arrangementDocumentFiles';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { makeArrangement } from './arrangementDocument';

const BAR = TICKS_PER_BAR;

/** The fixture with its part on slot 0 and `others` beside it. */
function withParts(sequencer: Record<string, unknown>, ...others: object[]): unknown {
  const doc = currentDocument('figure-part');
  const [part] = doc.parts as Record<string, unknown>[];
  return { ...doc, parts: [{ ...part, sequencer }, ...others] };
}

const FIGURE = currentDocument('figure-part').parts as { sequencer: Record<string, unknown> }[];
const DEFAULT = FIGURE[0]!.sequencer;
const other = (slot: number, kind: string): object => ({
  slot,
  preset: 'init-0',
  regions: [{ start: 0, duration: BAR }],
  sequencer: { kind, seed: 0 },
});

describe('a Figure part (windsor#484)', () => {
  it('at its defaults loads with no correction and round-trips byte for byte', () => {
    const first = makeArrangement(currentDocument('figure-part'));
    expect(first.corrections).toEqual([]);
    expect(JSON.stringify(first.document.parts[0]?.sequencer)).toBe(JSON.stringify(DEFAULT));
    const text = JSON.stringify(first.document);
    expect(JSON.stringify(makeArrangement(JSON.parse(text)).document)).toBe(text);
  });

  it('drops a source naming its own slot, an empty slot or a Grid, and keeps one naming a Figure', () => {
    const cases: [number, string][] = [
      [0, "slot 0 is the part's own"],
      [5, 'slot 5 holds no part'],
      [1, 'slot 1 is a grid part, not a Figure'],
    ];
    for (const [slot, why] of cases) {
      const source = { slot, offset: 2, transpose: 7 };
      const result = makeArrangement(withParts({ ...DEFAULT, source }, other(1, 'grid')));
      expect(result.document.parts[0]?.sequencer).not.toHaveProperty('source');
      expect(result.corrections).toEqual([`parts[0].sequencer.source: ${why} — source dropped`]);
    }
    const source = { slot: 2, offset: 2, transpose: 7 };
    const kept = makeArrangement(withParts({ ...DEFAULT, source }, other(2, 'figure')));
    expect(kept.corrections).toEqual([]);
    expect(kept.document.parts[0]?.sequencer).toHaveProperty('source', source);
  });

  it("checks a region pattern's source the same way", () => {
    const pattern = (slot: number): object => ({
      ...DEFAULT,
      seed: undefined,
      source: { slot, offset: 0, transpose: 0 },
    });
    const doc = withParts(DEFAULT, other(1, 'grid'), other(2, 'figure')) as {
      parts: Record<string, unknown>[];
    };
    doc.parts[0] = {
      ...doc.parts[0],
      regions: [
        { start: 0, duration: BAR, pattern: pattern(1) },
        { start: BAR, duration: BAR, pattern: pattern(2) },
      ],
    };
    const result = makeArrangement(doc);
    expect(result.corrections).toEqual([
      'parts[0].regions[0].pattern.source: slot 1 is a grid part, not a Figure — source dropped',
    ]);
    const [first, second] = result.document.parts[0]!.regions;
    expect(first?.pattern).not.toHaveProperty('source');
    expect(second?.pattern).toHaveProperty('source', { slot: 2, offset: 0, transpose: 0 });
  });
});
