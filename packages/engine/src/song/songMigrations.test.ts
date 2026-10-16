/**
 * Song format upgrades (record `2026-09-28-format-versions-refuse-never-destroy`):
 * a version this build cannot read is refused with both versions named, an
 * upgrade runs before the check and chains, and a song whose snapshot holds a
 * patch of an unreadable format is refused whole. Six upgrades ship, 5 → 6
 * (windsor#300: the snapshot's patches to patch format 3, pinned by
 * `songDriveUpgrade.test.ts`), 6 → 7 (windsor#590: to patch format 4,
 * the operators' `noiseLp` and `noiseHp` renamed), 7 → 8 (windsor#626:
 * the Filter's Reso lane on a log scale, an identity step pinned by
 * `songFilterResoUpgrade.test.ts`), 8 → 9 (RV-4: Retro Reverb's Size
 * lane on a log scale, an identity step pinned by
 * `songRetroSizeUpgrade.test.ts`), 9 → 10 (windsor#728: bloom's Scale
 * values renamed to Windsor's, pinned here) and 15 → 16 (windsor#818: the
 * Tape's Wow, Flutter and Wear on a square law, an identity step pinned
 * here, read through a stand-in 16 → 17); versions 2 (#705), 3 (record
 * `2026-10-01-retire-song-version-3`) and 4 (windsor#224, Tape's Drive
 * changed meaning) are refused. None ships from 10 to 11 (windsor#748, the
 * plate's Decay in seconds), from 11 to 12 (windsor#761, the plate's
 * Build), from 12 to 13 (windsor#764, the plate's modulation), from 13 to
 * 14 (windsor#746, the plate's voicing) or from 14 to 15 (windsor#771, the
 * `plate` insert kind renamed `reverb`) or from 16 to 17 (windsor#842, a
 * feedback step's span from 1 to 5), so 5 to 16 are refused too, and the
 * steps' own tests read through stand-ins 10 → 11 to 14 → 15 and 16 → 17
 * (`PAST_TEN`).
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

/**
 * The shipped steps and stand-ins 10 → 11 to 14 → 15 and 16 → 17: windsor#748,
 * windsor#761, windsor#764, windsor#746, windsor#771 and windsor#842 ship none, so
 * a version-10 to 14 or 16 song is refused, and
 * this reads a step's own work through to a version this build loads.
 */
const PAST_TEN = {
  songs: {
    ...SONG_MIGRATIONS,
    10: (doc: Record<string, unknown>) => doc,
    11: (doc: Record<string, unknown>) => doc,
    12: (doc: Record<string, unknown>) => doc,
    13: (doc: Record<string, unknown>) => doc,
    14: (doc: Record<string, unknown>) => doc,
    16: (doc: Record<string, unknown>) => doc,
  },
  patches: PATCH_MIGRATIONS,
};

describe('upgradeSong', () => {
  it('ships six upgrades, 5 → 6 to 9 → 10 and 15 → 16, and none to 11, 12, 13, 14, 15 or 17: versions 2, 3 and 4 were retired without one', () => {
    expect(Object.keys(SONG_MIGRATIONS)).toEqual(['5', '6', '7', '8', '9', '15']);
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

  it.each([3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16])(
    'refuses version %i, which no upgrade brings to this build, with the standard message',
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
    const { document, refused } = upgradeSong(raw, PAST_TEN);
    expect(refused).toBeUndefined();
    const patches = (document as { patches: Record<string, Doc> }).patches;
    expect(patches['kick']).toEqual({
      ops: [{ wave: 1, opLp: 0 }, {}, { wave: 4, level: 0.8, opLp: 10089.5, opHp: 2370.25 }, {}],
    });
    // A patch that declares its own format is upgraded from that format
    // instead; its Sine (default wave) operator never heard the hidden 900.
    expect(patches['hat']).toEqual({ ops: [{ opHp: 0 }, {}, {}, {}] });
    const result = makeArrangement(document);
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

describe("a version-9 song's blooms (windsor#728)", () => {
  const bloom = (scale: string, extra: Doc = {}): Doc => ({
    kind: 'bloom',
    key: 'F#',
    scale,
    ...extra,
  });
  const chain = (doc: unknown, ...path: (string | number)[]): Doc[] =>
    path.reduce<unknown>((at, key) => (at as Record<string | number, unknown>)[key], doc) as Doc[];

  it('renames minor and the pentatonics on every chain, a host’s child included', () => {
    const raw: Doc = {
      ...song([{ ...KICK, strip: { inserts: [bloom('pentatonic-minor'), { kind: 'eq' }] } }]),
      version: 9,
      groups: [{ id: 'g', inserts: [bloom('minor')] }],
      returns: { a: { inserts: [bloom('pentatonic-major', { slot: bloom('minor') })] } },
      master: { inserts: [bloom('dorian'), bloom('pentatonic-minor')] },
    };
    const { document, refused } = upgradeSong(raw, PAST_TEN);
    expect(refused).toBeUndefined();
    expect(chain(document, 'parts', 0, 'strip', 'inserts')).toEqual([
      bloom('pentatonicMinor'),
      { kind: 'eq' },
    ]);
    expect(chain(document, 'groups', 0, 'inserts')).toEqual([bloom('naturalMinor')]);
    expect(chain(document, 'returns', 'a', 'inserts')).toEqual([
      bloom('pentatonicMajor', { slot: bloom('naturalMinor') }),
    ]);
    expect(chain(document, 'master', 'inserts')).toEqual([
      bloom('dorian'),
      bloom('pentatonicMinor'),
    ]);
  });

  it('leaves another kind’s scale-named field alone', () => {
    const raw: Doc = {
      ...song([KICK]),
      version: 9,
      master: { inserts: [{ kind: 'x', scale: 'minor' }] },
    };
    expect(chain(upgradeSong(raw, PAST_TEN).document, 'master', 'inserts')).toEqual([
      { kind: 'x', scale: 'minor' },
    ]);
  });

  it('loads a pentatonic-minor bloom on a part strip and the master as pentatonicMinor, with no correction', () => {
    const raw: Doc = {
      ...song([{ ...KICK, strip: { inserts: [bloom('pentatonic-minor')] } }]),
      version: 9,
      master: { inserts: [bloom('pentatonic-minor')] },
    };
    const result = makeArrangement(upgradeSong(raw, PAST_TEN).document);
    expect(result.corrections).toEqual([]);
    expect(result.document.version).toBe(ARRANGEMENT_VERSION);
    expect(result.document.parts[0]!.strip!.inserts[0]).toMatchObject({
      key: 'F#',
      scale: 'pentatonicMinor',
    });
    expect(result.document.master!.inserts[0]).toMatchObject({
      key: 'F#',
      scale: 'pentatonicMinor',
    });
  });

  it("keeps key and scale through a round trip at this build's version", () => {
    const raw: Doc = { ...song([KICK]), master: { inserts: [bloom('wholeTone', { key: 'A#' })] } };
    const once = makeArrangement(raw).document;
    const twice = makeArrangement(JSON.parse(JSON.stringify(once))).document;
    expect(twice.master!.inserts[0]).toMatchObject({ key: 'A#', scale: 'wholeTone' });
    expect(twice).toEqual(once);
  });
});

describe("a version-15 song's Tape (windsor#818)", () => {
  const tape = {
    kind: 'tape',
    id: 'tp',
    wear: 30,
    split: true,
    wow: 5,
    flutter: 10,
    dropouts: 30,
  };
  const lane = {
    target: 'insert.tp.wow',
    on: true,
    points: [
      { tick: 0, value: 5, bend: 0 },
      { tick: 96, value: 40, bend: 0 },
    ],
  };
  const withTape = (): Doc => ({
    ...song([{ ...KICK, strip: { inserts: [tape] }, automation: [lane] }]),
    version: 15,
    master: { inserts: [{ ...tape, id: 'mt', split: false }] },
  });

  it('passes the document through unchanged, its Tape fields and lanes as saved', () => {
    const raw = withTape();
    const before = structuredClone(raw);
    const { document, refused } = upgradeSong(raw, PAST_TEN);
    expect(refused).toBeUndefined();
    expect(raw).toEqual(before);
    expect(document).toEqual({ ...before, version: ARRANGEMENT_VERSION });
  });

  it("loads at this build's version with its Tape's numbers and lane kept, and a song with no Tape unchanged", () => {
    const open = (raw: Doc) => makeArrangement(upgradeSong(raw, PAST_TEN).document);
    const result = open(withTape());
    expect(result.refused).toBeUndefined();
    expect(result.document.version).toBe(ARRANGEMENT_VERSION);
    expect(result.document.parts[0]!.strip!.inserts[0]).toMatchObject(tape);
    expect(result.document.parts[0]!.automation).toEqual([lane]);
    expect(result.document.master!.inserts[0]).toMatchObject({ wear: 30, split: false });
    const upgraded = open({ ...song([KICK]), version: 15 });
    const current = makeArrangement({ ...song([KICK]), version: ARRANGEMENT_VERSION });
    expect(upgraded.corrections).toEqual(current.corrections);
    expect(upgraded.document).toEqual(current.document);
  });
});
