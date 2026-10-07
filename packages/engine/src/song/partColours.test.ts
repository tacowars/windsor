/**
 * Each part's colour (windsor#641, record `2026-10-07-part-colours`
 * decisions 1–4): a valid one is kept, any other is assigned the colour the
 * song uses least, and a wrong value — not an absent one — is reported.
 */
import { describe, expect, it } from 'vitest';

import { FULL_DOCUMENT, FULL_SLOT } from '../__fixtures__/fullArrangement';
import { makeArrangement } from './arrangementDocument';
import { removePart } from './documentParts';
import { assignPartColours } from './partColours';

/** A copy of the fixture with each part's `colour` set from `colours`, or removed for undefined. */
function withColours(colours: readonly unknown[]): unknown {
  const raw = JSON.parse(JSON.stringify(FULL_DOCUMENT)) as { parts: Record<string, unknown>[] };
  raw.parts.forEach((part, i) => {
    if (colours[i] === undefined) delete part.colour;
    else part.colour = colours[i];
  });
  return raw;
}

const coloursOf = (raw: unknown): number[] =>
  makeArrangement(raw).document.parts.map((part) => part.colour);

describe('assignPartColours', () => {
  it('runs down the palette in list order, and round again past its end', () => {
    expect(assignPartColours([undefined, undefined, undefined])).toEqual([0, 1, 2]);
    expect(assignPartColours(new Array(16).fill(undefined))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1,
    ]);
  });

  it('gives a part without one the colour used least, after counting the valid ones', () => {
    expect(assignPartColours([0, 2, undefined])).toEqual([0, 2, 1]);
    expect(assignPartColours([0, 1, 2, undefined])).toEqual([0, 1, 2, 3]);
    // The part first in the list does not take 1, which a later part holds.
    expect(assignPartColours([undefined, 0, 1])).toEqual([2, 0, 1]);
  });

  it('keeps two parts on the same valid colour', () => {
    expect(assignPartColours([5, 5, undefined])).toEqual([5, 5, 0]);
  });
});

describe('a part colour in a song', () => {
  it('fills a song written without colours, reporting nothing', () => {
    const result = makeArrangement(withColours([]));
    expect(result.document.parts.map((part) => part.colour)).toEqual([0, 1, 2, 3]);
    expect(result.corrections).toEqual([]);
  });

  it('reassigns and reports a value that is not a palette index', () => {
    for (const junk of [14, -1, 2.5, 'red', null]) {
      const result = makeArrangement(withColours([junk, 0]));
      // Part 0 takes 1, the least-used colour once part 1 keeps its 0.
      expect(result.document.parts.map((part) => part.colour)).toEqual([1, 0, 2, 3]);
      expect(result.corrections).toEqual([
        `parts[0].colour: ${JSON.stringify(junk)} is not a part colour 0–13 — assigned 1`,
      ]);
    }
  });

  it('gives an added part the colour a removed one freed, and keeps every other', () => {
    const removed = removePart(FULL_DOCUMENT, FULL_SLOT.hat);
    expect(coloursOf(removed)).toEqual([0, 2, 3]);
    // The app's add writes a raw part with no colour; the normaliser assigns it.
    const kick: Record<string, unknown> = { ...FULL_DOCUMENT.parts[0], slot: 9 };
    delete kick.colour;
    const added = { ...removed, parts: [...removed.parts, kick] };
    expect(coloursOf(added)).toEqual([0, 2, 3, 1]);
  });

  it('survives an export and import', () => {
    const exported = JSON.stringify(makeArrangement(withColours([7, 7, 12, 3])).document);
    expect(coloursOf(JSON.parse(exported))).toEqual([7, 7, 12, 3]);
  });
});
