/**
 * Song format upgrades (record `2026-09-28-format-versions-refuse-never-destroy`):
 * a version this build cannot read is refused with both versions named, an
 * upgrade runs before the check and chains, and a song whose snapshot holds a
 * patch of an unreadable format is refused whole. Three upgrades ship, 5 → 6
 * (windsor#300: the snapshot's patches to patch format 3, pinned by
 * `songDriveUpgrade.test.ts`), 6 → 7 (windsor#590: to patch format 4,
 * the operators' `noiseLp` and `noiseHp` renamed) and 7 → 8 (windsor#626:
 * the Filter's Reso lane on a log scale, an identity step pinned by
 * `songFilterResoUpgrade.test.ts`); versions 2 (#705), 3 (record
 * `2026-10-01-retire-song-version-3`) and 4 (windsor#224, Tape's Drive
 * changed meaning) are refused.
 * Every expectation reads `ARRANGEMENT_VERSION`, so a bump changes one constant.
 */
import { describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION } from '../audioConstants';
import { PATCH_FILE_FORMAT, PATCH_MIGRATIONS } from '../patch/patchMigrations';
import { KICK, song } from '../__fixtures__/documentCases';
import { makeArrangement } from './arrangementDocument';
import { FALLBACK_ARRANGEMENT } from './fallbackArrangement';
import { SONG_MIGRATIONS, upgradeSong } from './songMigrations';

type Doc = Record<string, unknown>;
type Upgrade = (doc: Doc) => Doc;

const NEWER = ARRANGEMENT_VERSION + 1;
const BEHIND = ARRANGEMENT_VERSION - 1;

/** A song as a version-1 file might have held it: the same parts under an older key. */
const versionOne = (): Doc => {
  const { parts, ...rest } = song([KICK]);
  return { ...rest, version: 1, tracks: parts };
};

/** 1 → 2 renames `tracks` to `parts`. */
const rename: Upgrade = ({ tracks, ...doc }) => ({ ...doc, parts: tracks });
/** The last step records that it ran. */
const mark: Upgrade = (doc) => ({ ...doc, harmony: { root: 2 } });
const unchanged: Upgrade = (doc) => doc;

/** A chain from version 1 to this build's: rename first, mark last, and every step between changes nothing. */
const TABLE: Record<number, Upgrade> = Object.fromEntries(
  Array.from({ length: BEHIND }, (_, i) => i + 1).map((from) => [
    from,
    from === 1 ? rename : from === BEHIND ? mark : unchanged,
  ]),
);

describe('upgradeSong', () => {
  it('ships three upgrades, 5 → 6, 6 → 7 and 7 → 8: versions 2, 3 and 4 were retired without one', () => {
    expect(Object.keys(SONG_MIGRATIONS)).toEqual(['5', '6', '7']);
  });

  it('refuses a newer version, naming both, and hands the document back untouched', () => {
    const raw = { ...song([KICK]), version: NEWER };
    const { document, refused } = upgradeSong(raw);
    expect(document).toBe(raw);
    expect(refused).toEqual({
      format: 'song',
      found: NEWER,
      reads: ARRANGEMENT_VERSION,
      message: `saved with song format ${NEWER}, this build reads ${ARRANGEMENT_VERSION}`,
    });
  });

  it('refuses a newer version through makeArrangement: unusable, the fallback, the refusal', () => {
    const result = makeArrangement({ ...song([KICK]), version: NEWER });
    expect(result.usable).toBe(false);
    expect(result.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(result.refused?.message).toBe(
      `saved with song format ${NEWER}, this build reads ${ARRANGEMENT_VERSION}`,
    );
    expect(result.corrections[0]).toBe(`version: ${NEWER} is not ${ARRANGEMENT_VERSION}`);
  });

  it('refuses version 2 with the reason #705 gave', () => {
    const result = makeArrangement({ ...song([KICK]), version: 2 });
    expect(result.refused).toMatchObject({ found: 2, reads: ARRANGEMENT_VERSION });
    expect(result.corrections[0]).toBe(
      `version: 2 is not ${ARRANGEMENT_VERSION} — version 2 is not supported since #705`,
    );
  });

  it.each([3, 4])(
    'refuses version %i, retired with no upgrade, with the standard message',
    (version) => {
      const raw = { ...song([KICK]), version };
      const { document, refused } = upgradeSong(raw);
      expect(document).toBe(raw);
      expect(refused).toEqual({
        format: 'song',
        found: version,
        reads: ARRANGEMENT_VERSION,
        message: `saved with song format ${version}, this build reads ${ARRANGEMENT_VERSION}`,
      });
      const result = makeArrangement(raw);
      expect(result.usable).toBe(false);
      expect(result.document).toEqual(FALLBACK_ARRANGEMENT);
      expect(result.refused).toEqual(refused);
      expect(result.corrections[0]).toBe(`version: ${version} is not ${ARRANGEMENT_VERSION}`);
    },
  );

  it('leaves a document with no integer version to the normaliser, unrefused', () => {
    for (const version of [undefined, String(ARRANGEMENT_VERSION), 1.5]) {
      const raw = { ...song([KICK]), version };
      expect(upgradeSong(raw)).toEqual({ document: raw });
      const result = makeArrangement(raw);
      expect(result.usable).toBe(false);
      expect(result.refused).toBeUndefined();
    }
  });

  it('upgrades a song one version behind, before the check', () => {
    const behind = { ...song([KICK]), version: BEHIND };
    const table = { songs: { [BEHIND]: mark }, patches: {} };
    const { document, refused } = upgradeSong(behind, table);
    expect(refused).toBeUndefined();
    expect(document).toMatchObject({ version: ARRANGEMENT_VERSION, harmony: { root: 2 } });
  });

  it("chains from version 1 to this build's, and the result normalises clean", () => {
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
    const { document, refused } = upgradeSong(raw, { songs: { 1: rename }, patches: {} });
    expect(document).toBe(raw);
    expect(refused?.message).toBe(
      `saved with song format 1, this build reads ${ARRANGEMENT_VERSION}`,
    );
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
    const result = makeArrangement(withPatch({ format: PATCH_FILE_FORMAT, volume: 0.5 }));
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
      reads: PATCH_FILE_FORMAT,
      patch: 'kick',
      message: `saved with patch format 99 in patch "kick", this build reads ${PATCH_FILE_FORMAT}`,
    });
    const result = makeArrangement(raw);
    expect(result.usable).toBe(false);
    expect(result.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(result.refused).toEqual(refused);
    expect(result.corrections[0]).toBe(`patches.kick: ${refused?.message}`);
  });

  it("renames a version-6 song's operator filters, a Noise operator's values kept, any other wave's 0 (windsor#590)", () => {
    const snare = {
      ops: [
        { wave: 1, noiseLp: 5000 },
        {},
        { wave: 4, level: 0.8, noiseLp: 10089.5, noiseHp: 2370.25 },
        {},
      ],
    };
    const declared = { format: 3, ops: [{ noiseHp: 900 }, {}, {}, {}] };
    const raw: Doc = { ...withPatch(snare), version: 6 };
    (raw['patches'] as Record<string, Doc>)['hat'] = declared;
    const { document, refused } = upgradeSong(raw);
    expect(refused).toBeUndefined();
    const patches = (document as { patches: Record<string, Doc> }).patches;
    expect(patches['kick']).toEqual({
      ops: [{ wave: 1, opLp: 0 }, {}, { wave: 4, level: 0.8, opLp: 10089.5, opHp: 2370.25 }, {}],
    });
    // A patch that declares its own format is upgraded from that format
    // instead; its Sine (default wave) operator never heard the hidden 900.
    expect(patches['hat']).toEqual({ ops: [{ opHp: 0 }, {}, {}, {}] });
    const result = makeArrangement(raw);
    expect(result.corrections).toEqual([]);
    expect(result.document.version).toBe(ARRANGEMENT_VERSION);
    expect(result.document.patches?.['kick']?.ops[2]).toMatchObject({
      opLp: 10089.5,
      opHp: 2370.25,
      opTrack: 0,
    });
    expect(result.document.patches?.['kick']?.ops[2]).not.toHaveProperty('noiseLp');
  });

  it('upgrades an embedded patch through the patch table', () => {
    const upgrade = (patch: Doc): Doc => ({ ...patch, volume: 0.25 });
    const { document } = upgradeSong(withPatch({ format: 1, volume: 0.5 }), {
      songs: {},
      patches: { ...PATCH_MIGRATIONS, 1: upgrade },
    });
    expect((document as { patches: Record<string, Doc> }).patches['kick']).toEqual({
      volume: 0.25,
    });
  });
});
