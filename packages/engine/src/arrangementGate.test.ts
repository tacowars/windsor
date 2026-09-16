/**
 * The verify gate (issue #75, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §5): `npm run
 * verify` fails if the committed arrangement normalises to the fallback, names
 * a preset or return the code does not define, or has nothing to play — proven
 * on committed fixture documents that are valid JSON and still not shippable.
 * A `none` part is inert and allowed beside sequenced ones (#597).
 * The gate is what guarantees the fallback is never what ships.
 *
 * This is a vitest test rather than a script on purpose: it already runs
 * inside `npm run verify` (typechecked via `tsconfig.test.json`, executed by
 * `npm run test`) and it imports the committed JSON exactly the way the game
 * does — same resolver, same JSON semantics — so what the gate checks is what
 * ships, with no second loader to drift.
 */
import { describe, expect, it } from 'vitest';

import danglingPreset from './__fixtures__/arrangementDocuments/dangling-preset.json';
import danglingReturn from './__fixtures__/arrangementDocuments/dangling-return.json';
import nothingUsable from './__fixtures__/arrangementDocuments/nothing-usable.json';
import retiredFourSlot from './__fixtures__/arrangementDocuments/retired-four-slot.json';
import silentSong from './__fixtures__/arrangementDocuments/silent-song.json';
import { FULL_PART_IDS, FULL_PARTS } from './__fixtures__/fullArrangement';
import { isShippable, makeArrangement } from './arrangementDocument';
import { ArrangementPlayer, type PlayablePart } from './arrangementPlayer';
import { FALLBACK_ARRANGEMENT } from './fallbackArrangement';
import { ARRANGEMENT_LIBRARY, ARRANGEMENT_NAMES } from './arrangementLibrary';
import raw from './arrangements/bed-01.json';
import { DEFAULT_ARRANGEMENT_NAME } from './audioConstants';
import { TickTransport } from './scheduler';

const silentPart = (): PlayablePart => ({
  noteOn: () => 0,
  noteOffByNote: () => {},
  trigger: () => 0,
  setPatch: () => {},
  allNotesOff: () => {},
});

describe('the committed arrangement (arrangements/bed-01.json)', () => {
  const result = makeArrangement(raw);

  it('is shippable: usable, nothing dangling, nothing repaired', () => {
    expect(result.usable).toBe(true);
    expect(result.dangling).toEqual([]);
    // Stricter than the gate strictly needs: the committed document is
    // normalised output (the #70 console exports normalised documents), so
    // any correction means the file has drifted from what actually plays.
    expect(result.corrections).toEqual([]);
    expect(isShippable(result)).toBe(true);
  });

  it('does not normalise to the fallback', () => {
    expect(result.document).not.toEqual(FALLBACK_ARRANGEMENT);
  });

  it('defines all four parts and constructs every generator', () => {
    expect(result.document.parts.map((p) => [p.slot, p.sequencer.kind])).toEqual(
      FULL_PART_IDS.map((id) => [FULL_PARTS[id].slot, FULL_PARTS[id].sequencer.kind]),
    );
    const parts = new Map(result.document.parts.map((p) => [p.slot, silentPart()]));
    expect(
      () =>
        new ArrangementPlayer(
          new TickTransport(),
          parts,
          result.document,
          result.document.patches ?? {},
        ),
    ).not.toThrow();
  });
});

describe('every committed arrangements/*.json (the library `?music=<name>` selects from)', () => {
  it('includes the default', () => {
    expect(ARRANGEMENT_NAMES).toContain(DEFAULT_ARRANGEMENT_NAME);
    expect(ARRANGEMENT_LIBRARY[DEFAULT_ARRANGEMENT_NAME]).toEqual(raw);
  });

  it.each(ARRANGEMENT_NAMES)('%s is shippable and correction-free', (name) => {
    const result = makeArrangement(ARRANGEMENT_LIBRARY[name]);
    expect(result.usable).toBe(true);
    expect(result.dangling).toEqual([]);
    expect(result.corrections).toEqual([]);
    expect(isShippable(result)).toBe(true);
  });
});

describe('fixture documents: valid JSON, still rejected', () => {
  it('rejects a document with nothing usable — it normalises to the fallback', () => {
    const r = makeArrangement(nothingUsable);
    expect(r.usable).toBe(false);
    expect(r.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(isShippable(r)).toBe(false);
  });

  it('rejects the retired four-slot format (#597): unusable, and says why', () => {
    const r = makeArrangement(retiredFourSlot);
    expect(r.usable).toBe(false);
    expect(r.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(r.corrections[0]).toMatch(/retired four-slot format \(#597\)/);
    expect(isShippable(r)).toBe(false);
  });

  it('rejects a dangling preset name', () => {
    const r = makeArrangement(danglingPreset);
    // The step part still plays — but the document must not ship.
    expect(r.usable).toBe(true);
    expect(r.dangling).toEqual(['parts[0].preset: no preset "kick-2" is defined']);
    expect(isShippable(r)).toBe(false);
  });

  it('rejects a dangling return name in a send', () => {
    const r = makeArrangement(danglingReturn);
    expect(r.usable).toBe(true);
    expect(r.dangling).toEqual(['parts[0].strip.sends.cave: no return "cave" is defined']);
    expect(isShippable(r)).toBe(false);
  });

  it('rejects a song whose parts are all none: usable in the console, silent in the game', () => {
    const r = makeArrangement(silentSong);
    expect(r.usable).toBe(true);
    expect(r.dangling).toEqual([]);
    expect(r.corrections).toEqual([]);
    expect(isShippable(r)).toBe(false);
  });

  it('ships a none part beside sequenced ones: inert, not rejected', () => {
    const r = makeArrangement({
      ...silentSong,
      patches: { ...silentSong.patches, kick: {} },
      parts: [
        ...silentSong.parts,
        { slot: 1, name: 'kick', preset: 'kick', sequencer: { kind: 'euclidean' } },
      ],
    });
    expect(r.corrections).toEqual([]);
    expect(isShippable(r)).toBe(true);
  });
});
