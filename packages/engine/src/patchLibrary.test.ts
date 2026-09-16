/**
 * The loader against the real files in `patches/` and against the ways a
 * hand-written or editor-written file can go wrong. The bit-identity of the
 * migrated bank was proved once, in PR #567, by a test #583 retired; this file
 * is the standing contract.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { seedRange, sweepHeadroom } from './__fixtures__/headroomSweep';
import { loadProcessor } from './__fixtures__/workletHarness';
import { makePatch } from './patch';
import type { Patch } from './patch';
import {
  PATCH_FILE_FORMAT,
  PATCH_ID_RULE,
  SWEEP_COMMAND,
  loadPatchFile,
  loadPatchLibrary,
  patchContentHash,
} from './patchLibrary';
import type { PatchFile } from './patchLibrary';
import { PATCH_FILES } from './patches/index';
import { PRESET_CATALOG } from './presetCatalog';
import { PATCH_LIBRARY, PRESETS } from './presets';

const PATCHES = join(dirname(fileURLToPath(import.meta.url)), 'patches');
const onDisk = readdirSync(PATCHES)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .sort();

/** `object` minus one key, so a "missing field" case reads as what it is. */
function without<T extends object>(object: T, key: keyof T): Omit<T, typeof key> {
  const copy = { ...object };
  delete copy[key];
  return copy;
}

/** A real file, parsed from disk the way a bundler feeds it. */
const fileOf = (id: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(PATCHES, `${id}.json`), 'utf8')) as Record<string, unknown>;

/** A fresh, valid file for a patch that is not in the library, with a tiny in-test sweep. */
function freshFile(patch: Patch, seeds = 8): PatchFile {
  const { worstSeed, peak } = sweepHeadroom(patch, seedRange(seeds), loadProcessor());
  return {
    format: PATCH_FILE_FORMAT,
    name: patch.name,
    category: 'Pads',
    tags: ['probe'],
    description: 'A temporary patch that exists only inside this test.',
    patch,
    headroom: { worstSeed, peak, seedsSwept: seeds, contentHash: patchContentHash(patch) },
  };
}

describe('the real library files', () => {
  it('are every file on disk, and the generated index names each one', () => {
    expect(onDisk.length).toBeGreaterThan(0);
    expect(Object.keys(PATCH_FILES).sort()).toEqual(onDisk);
    expect(Object.keys(PATCH_LIBRARY).sort()).toEqual(onDisk);
  });

  it.each(onDisk)('%s loads from disk to the entry the bundle holds', (id) => {
    const entry = loadPatchFile(id, fileOf(id));
    expect(entry).toEqual(PATCH_LIBRARY[id]);
    expect(entry.id).toBe(id);
    expect(entry.name).toBe(entry.patch.name);
    expect(entry.patch).toEqual(makePatch(entry.patch));
    expect(PRESETS[id]).toBe(PATCH_LIBRARY[id]?.patch);
  });

  it('carries the id rule the index generator applies', () => {
    // One definition: scripts/lib/patchLibraryIndex.mjs holds the same regex.
    expect(PATCH_ID_RULE.test('score-drowned-cellos')).toBe(true);
    expect(PATCH_ID_RULE.test('kick')).toBe(true);
    expect(PATCH_ID_RULE.test('Lead Bell')).toBe(false);
    expect(PATCH_ID_RULE.test('lead--bell')).toBe(false);
    expect(PATCH_ID_RULE.test('-lead')).toBe(false);
  });
});

describe('the loader rejects', () => {
  const real = fileOf('lead-bell');
  const patch = real['patch'] as Patch;

  it('an unknown field at the top level, in the patch and in the headroom record', () => {
    expect(() => loadPatchFile('lead-bell', { ...real, author: 'tacowars' })).toThrow(
      /unknown field author/,
    );
    expect(() => loadPatchFile('lead-bell', { ...real, patch: { ...patch, sparkle: 1 } })).toThrow(
      /patch: unknown field sparkle/,
    );
    expect(() =>
      loadPatchFile('lead-bell', {
        ...real,
        patch: { ...patch, ops: [{ ...patch.ops[0], gain: 1 }, ...patch.ops.slice(1)] },
      }),
    ).toThrow(/patch\.ops\[0\]: unknown field gain/);
    expect(() =>
      loadPatchFile('lead-bell', {
        ...real,
        headroom: { ...(real['headroom'] as object), note: 60 },
      }),
    ).toThrow(/headroom: unknown field note/);
  });

  it('a missing patch field and a leaf of the wrong type', () => {
    expect(() => loadPatchFile('lead-bell', { ...real, patch: without(patch, 'lfo') })).toThrow(
      /patch: missing field lfo/,
    );
    expect(() =>
      loadPatchFile('lead-bell', { ...real, patch: { ...patch, volume: '0.5' } }),
    ).toThrow(/patch\.volume: expected a number/);
    expect(() =>
      loadPatchFile('lead-bell', { ...real, patch: { ...patch, volume: Infinity } }),
    ).toThrow(/patch\.volume: expected a finite number/);
  });

  it('a name that is not the patch name, and an empty one', () => {
    expect(() => loadPatchFile('lead-bell', { ...real, name: 'Lead Bell' })).toThrow(
      /name "Lead Bell" ≠ patch\.name "Bell Lead"/,
    );
    expect(() =>
      loadPatchFile('lead-bell', { ...real, name: '', patch: { ...patch, name: '' } }),
    ).toThrow(/name: empty/);
  });

  it('an id that is not a filename slug', () => {
    for (const id of ['Lead Bell', 'lead_bell', 'lead--bell', '']) {
      expect(() => loadPatchFile(id, real)).toThrow(/is not a slug/);
    }
  });

  it('a format it does not know', () => {
    expect(() => loadPatchFile('lead-bell', { ...real, format: 2 })).toThrow(
      /format: expected 1, got 2/,
    );
  });

  it('a missing headroom record, naming the sweep command', () => {
    expect(() => loadPatchFile('lead-bell', without(real, 'headroom'))).toThrow(
      `missing headroom record — run \`${SWEEP_COMMAND} lead-bell\``,
    );
  });

  it('a stale headroom hash after an edit, naming the sweep command', () => {
    const edited = structuredClone(patch);
    edited.ops[1]!.level += Number.EPSILON;
    expect(() => loadPatchFile('lead-bell', { ...real, patch: edited })).toThrow(
      `stale headroom record: the patch changed since its sweep — run \`${SWEEP_COMMAND} lead-bell\``,
    );
    expect(() =>
      loadPatchFile('lead-bell', {
        ...real,
        headroom: { ...(real['headroom'] as object), contentHash: 'deadbeef' },
      }),
    ).toThrow(/stale headroom record/);
  });

  it('a malformed headroom record', () => {
    const headroom = real['headroom'] as Record<string, unknown>;
    expect(() =>
      loadPatchFile('lead-bell', { ...real, headroom: { ...headroom, peak: '0.7' } }),
    ).toThrow(/headroom\.peak: expected a finite number/);
    expect(() =>
      loadPatchFile('lead-bell', { ...real, headroom: without(headroom, 'seedsSwept') }),
    ).toThrow(/headroom: missing field seedsSwept/);
  });
});

describe('the content hash', () => {
  it('is the same for the same patch in any key order, and differs for one ulp', () => {
    const patch = PRESETS['lead-bell']!;
    const reordered = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(patch).reverse())),
    ) as Patch;
    expect(patchContentHash(reordered)).toBe(patchContentHash(patch));
    expect(patchContentHash(reordered)).toBe(PATCH_LIBRARY['lead-bell']?.headroom.contentHash);
    const drifted = structuredClone(patch);
    drifted.ops[1]!.level += Number.EPSILON;
    expect(patchContentHash(drifted)).not.toBe(patchContentHash(patch));
    expect(patchContentHash(patch)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('a new patch file', () => {
  it('joins the library, its catalogue and its checks without touching any old test', () => {
    // Written to disk and read back so the temporary file takes the same
    // path a committed one does: JSON on disk, parsed, validated by id.
    const dir = mkdtempSync(join(tmpdir(), '561-patch-'));
    try {
      const fresh = freshFile(makePatch({ name: 'Probe 561', ops: [{ level: 0.5 }] }));
      writeFileSync(join(dir, 'probe-561.json'), JSON.stringify(fresh, null, 2));
      const raw: unknown = JSON.parse(readFileSync(join(dir, 'probe-561.json'), 'utf8'));
      const library = loadPatchLibrary({ ...PATCH_FILES, 'probe-561': raw });
      expect(Object.keys(library)).toHaveLength(Object.keys(PATCH_FILES).length + 1);
      expect(library['probe-561']?.patch).toEqual(fresh.patch);
      expect(library['probe-561']?.headroom.seedsSwept).toBe(8);
      // Every committed entry is untouched by the newcomer.
      for (const id of onDisk) expect(library[id]).toEqual(PATCH_LIBRARY[id]);
      // The catalogue derives from the entries, so the newcomer lists like any other.
      const listing = Object.fromEntries(
        Object.values(library).map(({ id, category, tags, description }) => [
          id,
          { category, tags, description },
        ]),
      );
      expect(listing['probe-561']).toEqual({
        category: 'Pads',
        tags: ['probe'],
        description: fresh.description,
      });
      for (const id of onDisk) expect(listing[id]).toEqual(PRESET_CATALOG[id]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
