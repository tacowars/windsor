/**
 * Song format upgrades (record `2026-09-28-format-versions-refuse-never-destroy`):
 * a version this build cannot read is refused with both versions named, an
 * upgrade runs before the check and chains, and a song whose snapshot holds a
 * patch of an unreadable format is refused whole. The one shipped upgrade,
 * 3 → 4 (windsor#172), turns the fixed returns into the send buses.
 */
import { describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION, DELAY_RESONANCE_DEFAULT_DB } from '../audioConstants';
import { KICK, song } from '../__fixtures__/documentCases';
import { DEFAULT_ECHO } from '../inserts/echoInsert';
import { DEFAULT_PLATE_REVERB } from '../inserts/plateReverbInsert';
import { RETURNS } from '../mixer/mix';
import { SPACES } from '../mixer/reverbSpace';
import { makeArrangement } from './arrangementDocument';
import { FALLBACK_ARRANGEMENT } from './fallbackArrangement';
import { SONG_MIGRATIONS, upgradeSong } from './songMigrations';

type Doc = Record<string, unknown>;

/** A song as a version-1 file might have held it: the same parts under an older key. */
const versionOne = (): Doc => {
  const { parts, ...rest } = song([KICK]);
  return { ...rest, version: 1, tracks: parts };
};

/** 1→2 renames `tracks` to `parts`; 2→3 records that it ran; 3→4 changes nothing. */
const TABLE = {
  1: ({ tracks, ...doc }: Doc): Doc => ({ ...doc, version: 2, parts: tracks }),
  2: (doc: Doc): Doc => ({ ...doc, version: 3, harmony: { root: 2 } }),
  3: (doc: Doc): Doc => doc,
};

describe('upgradeSong', () => {
  it('ships one upgrade, 3 → 4: version 2 was retired by #705 without one', () => {
    expect(ARRANGEMENT_VERSION).toBe(4);
    expect(Object.keys(SONG_MIGRATIONS)).toEqual(['3']);
  });

  it('refuses a newer version, naming both, and hands the document back untouched', () => {
    const raw = { ...song([KICK]), version: 5 };
    const { document, refused } = upgradeSong(raw);
    expect(document).toBe(raw);
    expect(refused).toEqual({
      format: 'song',
      found: 5,
      reads: 4,
      message: 'saved with song format 5, this build reads 4',
    });
  });

  it('refuses a newer version through makeArrangement: unusable, the fallback, the refusal', () => {
    const result = makeArrangement({ ...song([KICK]), version: 5 });
    expect(result.usable).toBe(false);
    expect(result.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(result.refused?.message).toBe('saved with song format 5, this build reads 4');
    expect(result.corrections[0]).toBe('version: 5 is not 4');
  });

  it('refuses version 2 with the reason #705 gave', () => {
    const result = makeArrangement({ ...song([KICK]), version: 2 });
    expect(result.refused).toMatchObject({ found: 2, reads: 4 });
    expect(result.corrections[0]).toBe(
      'version: 2 is not 4 — version 2 is not supported since #705',
    );
  });

  it('leaves a document with no integer version to the normaliser, unrefused', () => {
    for (const version of [undefined, '4', 1.5]) {
      const raw = { ...song([KICK]), version };
      expect(upgradeSong(raw)).toEqual({ document: raw });
      const result = makeArrangement(raw);
      expect(result.usable).toBe(false);
      expect(result.refused).toBeUndefined();
    }
  });

  it('upgrades a song one version behind, before the check', () => {
    const two = { ...song([KICK]), version: 2 };
    const table = { songs: { 2: TABLE[2], 3: TABLE[3] }, patches: {} };
    const { document, refused } = upgradeSong(two, table);
    expect(refused).toBeUndefined();
    expect(document).toMatchObject({ version: 4, harmony: { root: 2 } });
  });

  it('chains 1→2→3→4, and the result normalises clean', () => {
    const { document, refused } = upgradeSong(versionOne(), { songs: TABLE, patches: {} });
    expect(refused).toBeUndefined();
    expect(document).toEqual({ ...song([KICK]), harmony: { root: 2 } });
    const result = makeArrangement(document);
    expect(result.usable).toBe(true);
    expect(result.document.harmony.root).toBe(2);
    expect(result.document.parts.map((part) => part.preset)).toEqual(['kick']);
  });

  it('refuses a version whose chain breaks part way, never half-upgraded', () => {
    const raw = versionOne();
    const { document, refused } = upgradeSong(raw, { songs: { 1: TABLE[1] }, patches: {} });
    expect(document).toBe(raw);
    expect(refused?.message).toBe('saved with song format 1, this build reads 4');
  });
});

describe('the 3 → 4 upgrade: the returns become the send buses (windsor#172)', () => {
  const ROOM = { kind: 'reverb', level: 0.5, space: { ...SPACES.cathedral, size: 2 } };
  const ECHO = {
    kind: 'delay',
    level: 0.4,
    delayTime: 0.375,
    feedback: 0.5,
    damp: 2400,
    resonance: 6,
  };
  const withSends = (sends: Doc): Doc => ({ ...KICK, strip: { level: 0.8, sends } });
  const v3 = (rest: Doc = {}, sends: Doc = { room: 0.25, echo: 1 }): Doc => ({
    ...song([withSends(sends)], rest),
    version: 3,
  });

  it('turns room into Send A holding its plate, and echo into Send B holding its line, at Mix 1', () => {
    const result = makeArrangement(v3({ returns: { room: ROOM, echo: ECHO } }));
    expect(result.corrections).toEqual([]);
    expect(result.document.version).toBe(4);
    expect(result.document.returns).toEqual({
      a: {
        level: 0.5,
        inserts: [{ ...DEFAULT_PLATE_REVERB, ...SPACES.cathedral, size: 2, mix: 1 }],
      },
      b: {
        level: 0.4,
        inserts: [
          { ...DEFAULT_ECHO, delayTime: 0.375, feedback: 0.5, damp: 2400, resonance: 6, mix: 1 },
        ],
      },
    });
    expect(result.document.parts[0]?.strip.sends).toEqual({ a: 0.25, b: 1 });
  });

  it("fills what a v3 return left out from the v3 return's own base", () => {
    const result = makeArrangement(v3({ returns: { room: {}, echo: { level: 0.3 } } }));
    expect(result.corrections).toEqual([]);
    expect(result.document.returns).toEqual({
      a: RETURNS.a,
      b: { level: 0.3, inserts: RETURNS.b.inserts },
    });
    const [echo] = RETURNS.b.inserts;
    expect(echo).toMatchObject({ delayTime: 0.28, feedback: 0.3, damp: 3200 });
    expect(echo).toMatchObject({ resonance: DELAY_RESONANCE_DEFAULT_DB });
  });

  it('leaves an absent returns absent, and a missing return to the code', () => {
    expect(makeArrangement(v3()).document.returns).toBeUndefined();
    const echoOnly = makeArrangement(v3({ returns: { echo: { level: 0.3 } } }));
    expect(Object.keys(echoOnly.document.returns ?? {})).toEqual(['b']);
  });

  it('drops the returns and sends v3 dropped, and hands a junk room on as v3 read it', () => {
    const upgraded = upgradeSong(v3({ returns: { room: 7, cave: { level: 1 } } }, { hall: 0.5 }));
    expect(upgraded.document).toMatchObject({
      version: 4,
      returns: { a: 7 },
      parts: [{ strip: { sends: {} } }],
    });
    const result = makeArrangement(upgraded.document);
    expect(result.dangling).toEqual([]);
    expect(result.document.returns).toEqual({ a: RETURNS.a });
  });

  it('carries only the space fields v3 read: an unknown or colliding key cannot turn Send A', () => {
    const space = { ...SPACES.cathedral, kind: 'echo', mix: 0, bogus: 1 };
    const result = makeArrangement(v3({ returns: { room: { level: 0.5, space } } }));
    expect(result.corrections).toEqual([]);
    expect(result.document.returns?.['a']).toEqual({
      level: 0.5,
      inserts: [{ ...DEFAULT_PLATE_REVERB, ...SPACES.cathedral, mix: 1 }],
    });
  });

  it('carries only the line fields v3 read from the echo return', () => {
    const echo = { ...ECHO, mix: 0, bogus: 1 };
    const result = makeArrangement(v3({ returns: { echo } }));
    expect(result.corrections).toEqual([]);
    expect(result.document.returns?.['b']).toEqual({
      level: 0.4,
      inserts: [
        { ...DEFAULT_ECHO, delayTime: 0.375, feedback: 0.5, damp: 2400, resonance: 6, mix: 1 },
      ],
    });
  });

  it('lets room and echo win over a v3 send already named a or b', () => {
    const sends = { room: 0.25, a: 1, b: 0.1, echo: 0.5 };
    const result = makeArrangement(v3({ returns: { room: ROOM, echo: ECHO } }, sends));
    expect(result.document.parts[0]?.strip.sends).toEqual({ a: 0.25, b: 0.5 });
  });

  it('drops a lone v3 a, which v3 never read, rather than making it a send', () => {
    const result = makeArrangement(v3({ returns: { room: ROOM } }, { a: 1 }));
    expect(result.document.parts[0]?.strip.sends).toEqual({});
  });

  it('upgrades a v3 song once: a v4 song saved from it reads back unchanged', () => {
    const first = makeArrangement(v3({ returns: { room: ROOM, echo: ECHO } }));
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });
});

describe("a song's patch snapshot", () => {
  const withPatch = (patch: Doc): Doc =>
    song([KICK], { patches: { kick: patch, hat: {}, 'saw-arp': {}, 'drone-sqr': {} } });

  it('reads an embedded patch with no format at the version the song implies', () => {
    const result = makeArrangement(withPatch({ volume: 0.5 }));
    expect(result.refused).toBeUndefined();
    expect(result.corrections).toEqual([]);
    expect(result.document.patches?.['kick']?.volume).toBe(0.5);
  });

  it('takes an embedded patch that declares the current format, dropping the key', () => {
    const result = makeArrangement(withPatch({ format: 2, volume: 0.5 }));
    expect(result.corrections).toEqual([]);
    expect(result.document.patches?.['kick']).not.toHaveProperty('format');
  });

  it('refuses the whole song for an embedded patch of an unreadable format', () => {
    const raw = withPatch({ format: 99, volume: 0.5 });
    const { document, refused } = upgradeSong(raw);
    expect(document).toBe(raw);
    expect(refused).toEqual({
      format: 'patch',
      found: 99,
      reads: 2,
      patch: 'kick',
      message: 'saved with patch format 99 in patch "kick", this build reads 2',
    });
    const result = makeArrangement(raw);
    expect(result.usable).toBe(false);
    expect(result.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(result.refused).toEqual(refused);
    expect(result.corrections[0]).toBe(`patches.kick: ${refused?.message}`);
  });

  it('upgrades an embedded patch through the patch table', () => {
    const upgrade = (patch: Doc): Doc => ({ ...patch, volume: 0.25 });
    const { document } = upgradeSong(withPatch({ format: 1, volume: 0.5 }), {
      songs: {},
      patches: { 1: upgrade },
    });
    expect((document as { patches: Record<string, Doc> }).patches['kick']).toEqual({
      volume: 0.25,
    });
  });
});
