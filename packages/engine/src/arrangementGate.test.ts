/**
 * The verify gate (issue #75, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §5): `npm run
 * verify` fails if the committed arrangement normalises to the fallback, or
 * names a preset, return or part the code does not define — proven on
 * committed fixture documents that are valid JSON and still not shippable.
 * The gate is what guarantees the fallback is never what ships.
 *
 * This is a vitest test rather than a script on purpose: it already runs
 * inside `npm run verify` (typechecked via `tsconfig.test.json`, executed by
 * `npm run test`) and it imports the committed JSON exactly the way the game
 * does — same resolver, same JSON semantics — so what the gate checks is what
 * ships, with no second loader to drift.
 */
import { describe, expect, it } from 'vitest';

import danglingPart from './__fixtures__/arrangementDocuments/dangling-part.json';
import danglingPreset from './__fixtures__/arrangementDocuments/dangling-preset.json';
import danglingReturn from './__fixtures__/arrangementDocuments/dangling-return.json';
import nothingUsable from './__fixtures__/arrangementDocuments/nothing-usable.json';
import { FALLBACK_ARRANGEMENT } from './arrangement';
import { isShippable, makeArrangement } from './arrangementDocument';
import { ArrangementPlayer, MUSIC_PART_IDS, type PlayablePart } from './arrangementPlayer';
import raw from './arrangements/bed-01.json';
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
    for (const id of MUSIC_PART_IDS) expect(result.document[id], id).toBeDefined();
    const parts = { kick: silentPart(), hat: silentPart(), arp: silentPart(), drone: silentPart() };
    expect(() => new ArrangementPlayer(new TickTransport(), parts, result.document)).not.toThrow();
  });
});

describe('fixture documents: valid JSON, still rejected', () => {
  it('rejects a document with nothing usable — it normalises to the fallback', () => {
    const r = makeArrangement(nothingUsable);
    expect(r.usable).toBe(false);
    expect(r.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(isShippable(r)).toBe(false);
  });

  it('rejects a dangling preset name', () => {
    const r = makeArrangement(danglingPreset);
    // The drone still plays — but the document must not ship.
    expect(r.usable).toBe(true);
    expect(r.dangling).toEqual(['kick.preset: no preset "kick-2" is defined']);
    expect(isShippable(r)).toBe(false);
  });

  it('rejects a dangling return name in a send', () => {
    const r = makeArrangement(danglingReturn);
    expect(r.usable).toBe(true);
    expect(r.dangling).toEqual(['mix.hat.sends.cave: no return "cave" is defined']);
    expect(isShippable(r)).toBe(false);
  });

  it('rejects a part name the MIX has no strip for', () => {
    const r = makeArrangement(danglingPart);
    expect(r.usable).toBe(true);
    expect(r.dangling).toEqual(['drone.part: the MIX defines no strip "bass"']);
    expect(isShippable(r)).toBe(false);
  });
});
