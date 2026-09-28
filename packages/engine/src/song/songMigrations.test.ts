/**
 * Song format upgrades (record `2026-09-28-format-versions-refuse-never-destroy`):
 * a version this build cannot read is refused with both versions named, an
 * upgrade runs before the check and chains, and a song whose snapshot holds a
 * patch of an unreadable format is refused whole.
 */
import { describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION } from '../audioConstants';
import { KICK, song } from '../__fixtures__/documentCases';
import { makeArrangement } from './arrangementDocument';
import { FALLBACK_ARRANGEMENT } from './fallbackArrangement';
import { SONG_MIGRATIONS, upgradeSong } from './songMigrations';

type Doc = Record<string, unknown>;

/** A song as a version-1 file might have held it: the same parts under an older key. */
const versionOne = (): Doc => {
  const { parts, ...rest } = song([KICK]);
  return { ...rest, version: 1, tracks: parts };
};

/** 1→2 renames `tracks` to `parts`; 2→3 records that it ran. */
const TABLE = {
  1: ({ tracks, ...doc }: Doc): Doc => ({ ...doc, version: 2, parts: tracks }),
  2: (doc: Doc): Doc => ({ ...doc, version: 3, harmony: { root: 2 } }),
};

describe('upgradeSong', () => {
  it('ships no upgrade: version 2 was retired by #705 without one', () => {
    expect(ARRANGEMENT_VERSION).toBe(3);
    expect(SONG_MIGRATIONS).toEqual({});
  });

  it('refuses a newer version, naming both, and hands the document back untouched', () => {
    const raw = { ...song([KICK]), version: 99 };
    const { document, refused } = upgradeSong(raw);
    expect(document).toBe(raw);
    expect(refused).toEqual({
      format: 'song',
      found: 99,
      reads: 3,
      message: 'saved with song format 99, this build reads 3',
    });
  });

  it('refuses a newer version through makeArrangement: unusable, the fallback, the refusal', () => {
    const result = makeArrangement({ ...song([KICK]), version: 99 });
    expect(result.usable).toBe(false);
    expect(result.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(result.refused?.message).toBe('saved with song format 99, this build reads 3');
    expect(result.corrections[0]).toBe('version: 99 is not 3');
  });

  it('refuses version 2 with the reason #705 gave', () => {
    const result = makeArrangement({ ...song([KICK]), version: 2 });
    expect(result.refused).toMatchObject({ found: 2, reads: 3 });
    expect(result.corrections[0]).toBe(
      'version: 2 is not 3 — version 2 is not supported since #705',
    );
  });

  it('leaves a document with no integer version to the normaliser, unrefused', () => {
    for (const version of [undefined, '3', 1.5]) {
      const raw = { ...song([KICK]), version };
      expect(upgradeSong(raw)).toEqual({ document: raw });
      const result = makeArrangement(raw);
      expect(result.usable).toBe(false);
      expect(result.refused).toBeUndefined();
    }
  });

  it('upgrades a song one version behind, before the check', () => {
    const two = { ...song([KICK]), version: 2 };
    const { document, refused } = upgradeSong(two, { songs: { 2: TABLE[2] }, patches: {} });
    expect(refused).toBeUndefined();
    expect(document).toMatchObject({ version: 3, harmony: { root: 2 } });
  });

  it('chains 1→2→3, and the result normalises clean', () => {
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
    expect(refused?.message).toBe('saved with song format 1, this build reads 3');
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
    const result = makeArrangement(withPatch({ format: 1, volume: 0.5 }));
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
      reads: 1,
      patch: 'kick',
      message: 'saved with patch format 99 in patch "kick", this build reads 1',
    });
    const result = makeArrangement(raw);
    expect(result.usable).toBe(false);
    expect(result.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(result.refused).toEqual(refused);
    expect(result.corrections[0]).toBe(`patches.kick: ${refused?.message}`);
  });

  it('upgrades an embedded patch through the patch table', () => {
    const upgrade = (patch: Doc): Doc => ({ ...patch, volume: 0.25 });
    const { document } = upgradeSong(withPatch({ format: 0, volume: 0.5 }), {
      songs: {},
      patches: { 0: upgrade },
    });
    expect((document as { patches: Record<string, Doc> }).patches['kick']).toEqual({
      volume: 0.25,
    });
  });
});
