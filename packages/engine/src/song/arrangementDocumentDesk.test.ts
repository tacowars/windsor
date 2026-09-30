/**
 * The three sections that make a document the whole piece of music (#435):
 * `patches` (named FM patches — since #562 the *only* place a part's preset
 * resolves), `returns` (the send buses over the code's `RETURNS`,
 * windsor#172) and their normalisation — never throws, every junk value
 * corrected by path, a bus name the code does not define dangling.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_SLOT, withPart } from '../__fixtures__/fullArrangement';
import { isShippable, makeArrangement } from './arrangementDocument';
import { ARRANGEMENT_VERSION, REVERB_SPACE_RANGES } from '../audioConstants';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';
import { DEFAULT_DRIVE } from '../inserts/driveInsert';
import { DEFAULT_ECHO } from '../inserts/echoInsert';
import { MAX_INSERTS } from '../inserts/insertConstants';
import { DEFAULT_PLATE_REVERB } from '../inserts/plateReverbInsert';
import { RETURNS } from '../mixer/mix';
import { makePatch } from '../patch/patch';
import { PRESETS } from '../patch/presets';

/** The four library ids `FULL_ARRANGEMENT`'s parts name, as silent `{}` fills. */
const PARTS_PATCHES = { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} };

/** The fixture as a self-contained song: since #562 a part resolves nowhere else. */
const SONG = { version: ARRANGEMENT_VERSION, ...FULL_ARRANGEMENT, patches: PARTS_PATCHES };

const arpOf = (r: ReturnType<typeof makeArrangement>) =>
  r.document.parts.find((p) => p.slot === FULL_SLOT.arp);

describe('the patches section', () => {
  it('completes a partial patch against makePatch() and names it after its key', () => {
    const r = makeArrangement({
      ...SONG,
      patches: { ...PARTS_PATCHES, lead: { volume: 0.3 } },
    });
    expect(r.corrections).toEqual([]);
    expect(r.document.patches?.lead).toEqual(makePatch({ name: 'lead', volume: 0.3 }));
  });

  it('keeps a name the patch carries', () => {
    const r = makeArrangement({
      ...SONG,
      patches: { ...PARTS_PATCHES, lead: { name: 'Lead Bell' } },
    });
    expect(r.document.patches?.lead?.name).toBe('Lead Bell');
  });

  it('resolves a part preset against the document and nowhere else', () => {
    const r = makeArrangement({
      ...SONG,
      ...withPart(FULL_ARRANGEMENT, 'arp', { preset: 'lead' }),
      patches: { ...PARTS_PATCHES, lead: { volume: 0.3 } },
    });
    expect(r.dangling).toEqual([]);
    expect(arpOf(r)?.preset).toBe('lead');
    expect(isShippable(r)).toBe(true);
    // The embedded snapshot is what plays, even when the library has a patch
    // of the same id: the document's `kick` is not the library's (#562).
    // Half the library's level: derived, so re-tuning `kick` never fails this.
    expect(PRESETS.kick?.volume).toBeGreaterThan(0);
    const forked = PRESETS.kick!.volume / 2;
    const shadow = makeArrangement({
      ...SONG,
      patches: { ...PARTS_PATCHES, kick: { volume: forked } },
    });
    expect(shadow.dangling).toEqual([]);
    expect(shadow.document.patches?.kick?.volume).toBe(forked);
    expect(forked).not.toBe(PRESETS.kick?.volume);
  });

  it('drops a part whose preset is in neither, reported as dangling', () => {
    const r = makeArrangement({
      ...SONG,
      ...withPart(FULL_ARRANGEMENT, 'arp', { preset: 'nope' }),
      patches: { ...PARTS_PATCHES, lead: {} },
    });
    expect(arpOf(r)).toBeUndefined();
    expect(r.dangling).toEqual(['parts[2].preset: no preset "nope" is defined']);
  });

  it('corrects junk fields by path, drops unknown keys, and keeps the array shapes', () => {
    const r = makeArrangement({
      ...SONG,
      patches: {
        ...PARTS_PATCHES,
        lead: {
          volume: 'loud',
          wat: 1,
          ops: [{ wave: 1, env: { attackTime: null } }, 'junk'],
          lfo: { toOp: [1, 2] },
          filter: { slope24: 'yes' },
        },
      },
    });
    expect(r.corrections).toEqual([
      'patches.lead.wat: unknown key dropped',
      'patches.lead.volume: "loud" is not a number — using 0.8',
      'patches.lead.ops: 2 entries for 4 — resized',
      'patches.lead.ops[0].env.attackTime: null is not a number — using 0.002',
      'patches.lead.ops[1]: "junk" is not an object — using defaults',
      'patches.lead.lfo.toOp: 2 entries for 4 — resized',
      'patches.lead.filter.slope24: "yes" is not a boolean — using false',
    ]);
    const lead = r.document.patches?.lead;
    expect(lead?.ops).toHaveLength(4);
    expect(lead?.ops[0]?.wave).toBe(1);
    expect(lead?.lfo.toOp).toEqual([1, 2, 0, 0]);
    expect(lead?.filter.slope24).toBe(false);
  });

  it('accepts user partials as a list of numbers and nothing else', () => {
    const r = makeArrangement({
      ...SONG,
      patches: {
        ...PARTS_PATCHES,
        a: { ops: [{ userPartials: [1, 0.5] }] },
        b: { ops: [{ userPartials: 'x' }] },
      },
    });
    expect(r.document.patches?.a?.ops[0]?.userPartials).toEqual([1, 0.5]);
    expect(r.document.patches?.b?.ops[0]?.userPartials).toBeNull();
    expect(r.corrections).toContain(
      'patches.b.ops[0].userPartials: "x" is not a list of partials — using none',
    );
  });

  it('drops a patch that is not an object, and a section that is not one', () => {
    const r = makeArrangement({ ...SONG, patches: { ...PARTS_PATCHES, lead: 3 } });
    expect(r.document.patches?.lead).toBeUndefined();
    expect(r.corrections).toEqual(['patches.lead: 3 is not a patch — dropped']);
    // A junk section leaves the song with no patches, and since #562 that is a
    // song no part can resolve: every part drops and nothing usable survives.
    const junk = makeArrangement({ ...SONG, patches: [] });
    expect(junk.usable).toBe(false);
    expect(junk.corrections[0]).toBe('patches: [] is not an object — using defaults');
  });
});

describe('the returns section: the send buses (windsor#172)', () => {
  const plate = { ...DEFAULT_PLATE_REVERB, mix: 1 };
  const echo = { ...DEFAULT_ECHO, mix: 1 };

  it("fills a bus from the code's: a named level, and the default chain when none is given", () => {
    const r = makeArrangement({ ...SONG, returns: { a: { level: 0.5 } } });
    expect(r.corrections).toEqual([]);
    expect(r.document.returns).toEqual({ a: { level: 0.5, inserts: RETURNS.a.inserts } });
    expect(RETURNS.a.inserts).toEqual([plate]);
  });

  it('round-trips a chain of any kinds: an empty one, a full one and a mixed one', () => {
    const full = Array.from({ length: MAX_INSERTS }, () => DEFAULT_DRIVE);
    for (const returns of [
      { a: { level: 0.9, inserts: [] }, b: { level: 0.6, inserts: [echo, DEFAULT_CHORUS] } },
      { a: { level: 0.2, inserts: full }, b: { level: 0.6, inserts: [] } },
      { b: { level: 1, inserts: [DEFAULT_CHORUS, echo, plate] } },
    ]) {
      const first = makeArrangement({ ...SONG, returns });
      expect(first.corrections).toEqual([]);
      expect(first.document.returns).toEqual(returns);
      const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
      expect(again.corrections).toEqual([]);
      expect(again.document).toEqual(first.document);
    }
  });

  it('keeps an empty chain empty, where an absent or junk one is the default', () => {
    const r = makeArrangement({ ...SONG, returns: { a: { inserts: [] }, b: { inserts: 'x' } } });
    expect(r.document.returns?.a?.inserts).toEqual([]);
    expect(r.document.returns?.b?.inserts).toEqual(RETURNS.b.inserts);
    expect(r.corrections).toEqual([
      "returns.b.inserts: not a list — using the bus's default chain",
    ]);
  });

  it('corrects a chain as a strip is corrected: clamps, unknown kinds and the insert limit', () => {
    const over = Array.from({ length: MAX_INSERTS + 1 }, () => ({ kind: 'drive' }));
    const r = makeArrangement({
      ...SONG,
      returns: {
        a: { level: 3, inserts: [{ kind: 'plate', size: 99, mix: 2 }, { kind: 'wah' }] },
        b: { inserts: over, wet: 1 },
      },
    });
    expect(r.document.returns?.a).toEqual({
      level: 1,
      inserts: [{ ...DEFAULT_PLATE_REVERB, size: REVERB_SPACE_RANGES.size[1], mix: 1 }],
    });
    expect(r.document.returns?.b?.inserts).toHaveLength(MAX_INSERTS);
    expect(r.corrections).toEqual([
      'returns.a.level: clamped 3 to 1',
      'returns.a.inserts[0].size: clamped 99 to 4',
      'returns.a.inserts[0].mix: clamped 2 to 1',
      'returns.a.inserts[1]: dropped',
      'returns.b.wet: unknown key dropped',
      `returns.b.inserts[${MAX_INSERTS}]: past the ${MAX_INSERTS}-insert limit — dropped`,
    ]);
    expect(r.dangling).toEqual(['returns.a.inserts[1].kind: no insert kind "wah" is defined']);
  });

  it('keys a compressor on a bus from its own input: an external sidechain is corrected', () => {
    const r = makeArrangement({
      ...SONG,
      returns: { a: { inserts: [{ kind: 'compressor', sidechain: { track: 0 } }] } },
    });
    const [comp] = r.document.returns?.a?.inserts ?? [];
    expect(comp?.kind === 'compressor' && comp.sidechain).toBe('internal');
    expect(r.corrections).toEqual([
      'returns.a.inserts[0].sidechain: a send bus keys from its own input — internal',
    ]);
  });

  it('drops the old return shape: a v4 bus holds no space or delay fields', () => {
    const r = makeArrangement({
      ...SONG,
      returns: { a: { kind: 'reverb', space: { size: 2 } }, b: { delayTime: 1 } },
    });
    expect(r.document.returns).toEqual({ a: RETURNS.a, b: RETURNS.b });
    expect(r.corrections).toEqual([
      'returns.a.kind: unknown key dropped',
      'returns.a.space: unknown key dropped',
      'returns.b.delayTime: unknown key dropped',
    ]);
  });

  it('reports a bus the code does not define as dangling, which fails the gate', () => {
    const r = makeArrangement({ ...SONG, returns: { room: { level: 1 }, c: { level: 1 } } });
    expect(r.document.returns).toBeUndefined();
    expect(r.dangling).toEqual([
      'returns.room: no send bus "room" is defined',
      'returns.c: no send bus "c" is defined',
    ]);
    expect(isShippable(r)).toBe(false);
  });

  it('treats an inherited object name as no bus at all (review finding 2)', () => {
    const r = makeArrangement({ ...SONG, returns: { constructor: { level: 0.5 } } });
    expect(r.document.returns).toBeUndefined();
    expect(r.dangling).toEqual(['returns.constructor: no send bus "constructor" is defined']);
  });

  it('reports a send to a bus the code does not define as dangling', () => {
    const parts = SONG.parts.map((part) =>
      part.slot === FULL_SLOT.arp ? { ...part, strip: { sends: { room: 0.3, a: 0.2 } } } : part,
    );
    const r = makeArrangement({ ...SONG, parts });
    expect(arpOf(r)?.strip.sends).toEqual({ a: 0.2 });
    expect(r.dangling).toEqual(['parts[2].strip.sends.room: no send bus "room" is defined']);
  });

  it('round-trips: the normalised document normalises to itself with no corrections', () => {
    const first = makeArrangement({
      ...SONG,
      patches: { ...PARTS_PATCHES, lead: { volume: 0.3 } },
      returns: { a: { inserts: [{ kind: 'plate', decay: 0.5, mix: 1 }] } },
    });
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });
});
