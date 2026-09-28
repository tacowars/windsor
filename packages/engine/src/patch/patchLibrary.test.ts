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

import { makePatch } from './patch';
import type { Patch } from './patch';
import { PATCH_FILE_FORMAT, PATCH_ID_RULE, loadPatchFile, loadPatchLibrary } from './patchLibrary';
import type { PatchFile } from './patchLibrary';
import { PatchFormatError } from './patchMigrations';
import { PATCH_FILES } from '../patches/index';
import { PATCH_LIBRARY, PRESETS } from './presets';

const PATCHES = join(dirname(fileURLToPath(import.meta.url)), '../patches');
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

/** A fresh, valid file for a patch that is not in the library. */
const freshFile = (patch: Patch): PatchFile => ({
  format: PATCH_FILE_FORMAT,
  name: patch.name,
  category: 'Pads',
  tags: ['probe'],
  description: 'A temporary patch that exists only inside this test.',
  patch,
});

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

  it.each(onDisk)('%s is format 2, with no retired key', (id) => {
    const raw = fileOf(id);
    expect(raw['format']).toBe(2);
    expect(Object.keys(raw)).toEqual([
      'format',
      'name',
      'category',
      'tags',
      'description',
      'patch',
    ]);
    const patch = raw['patch'] as Patch;
    for (const op of patch.ops) expect(Object.keys(op)).not.toContain('userKey');
    // The file on disk is the patch it plays wherever it speaks. A field added
    // after it was written is filled by the loader, not written into the bank
    // (record `2026-09-28-retire-the-headroom-record`, "Consequences").
    expect(makePatch(patch)).toMatchObject(patch);
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

describe('the loader fills', () => {
  const real = fileOf('lead-bell');
  const patch = real['patch'] as Patch;
  const expected = loadPatchFile('lead-bell', real);

  it('a missing patch section with its defaults, returning the completed patch', () => {
    const entry = loadPatchFile('lead-bell', { ...real, patch: without(patch, 'lfo') });
    expect(entry.patch.lfo).toEqual(makePatch().lfo);
    expect(entry.patch).toEqual(makePatch(without(patch, 'lfo')));
    expect(entry.patch.ops).toEqual(expected.patch.ops);
  });

  it("one operator's missing field, and nothing else", () => {
    const ops = patch.ops.map((op, i) => (i === 2 ? without(op, 'velSens') : op));
    const entry = loadPatchFile('lead-bell', { ...real, patch: { ...patch, ops } });
    const filled = structuredClone(expected);
    filled.patch.ops[2]!.velSens = makePatch().ops[2]!.velSens;
    expect(entry).toEqual(filled);
  });

  it('a missing envelope field, and a missing envelope', () => {
    const filter = { ...patch.filter, env: without(patch.filter.env, 'keyScale') };
    const entry = loadPatchFile('lead-bell', {
      ...real,
      patch: { ...without(patch, 'pitchEnv'), filter },
    });
    expect(entry.patch.filter.env.keyScale).toBe(makePatch().filter.env.keyScale);
    expect(entry.patch.pitchEnv).toEqual(makePatch().pitchEnv);
  });

  it('nothing for a missing format: the file is format 1 and upgrades', () => {
    expect(loadPatchFile('lead-bell', without(real, 'format'))).toEqual(expected);
  });
});

describe('the loader rejects', () => {
  const real = fileOf('lead-bell');
  const patch = real['patch'] as Patch;

  it('an unknown field at the top level, in the patch and in an operator', () => {
    expect(() => loadPatchFile('lead-bell', { ...real, author: 'Pat' })).toThrow(
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
        patch: { ...patch, filter: { ...patch.filter, env: { ...patch.filter.env, hold: 1 } } },
      }),
    ).toThrow(/patch\.filter\.env: unknown field hold/);
  });

  it('a key format 2 retired, when the file says it is format 2', () => {
    expect(() =>
      loadPatchFile('lead-bell', { ...real, headroom: { worstSeed: 0, peak: 0.5 } }),
    ).toThrow(/unknown field headroom/);
    const ops = patch.ops.map((op) => ({ ...op, userKey: '' }));
    expect(() => loadPatchFile('lead-bell', { ...real, patch: { ...patch, ops } })).toThrow(
      /patch\.ops\[0\]: unknown field userKey/,
    );
  });

  it('a leaf of the wrong type, and an array of the wrong length', () => {
    expect(() =>
      loadPatchFile('lead-bell', { ...real, patch: { ...patch, volume: '0.5' } }),
    ).toThrow(/patch\.volume: expected a number/);
    expect(() =>
      loadPatchFile('lead-bell', { ...real, patch: { ...patch, volume: Infinity } }),
    ).toThrow(/patch\.volume: expected a finite number/);
    expect(() => loadPatchFile('lead-bell', { ...real, patch: { ...patch, lfo: 'slow' } })).toThrow(
      /patch\.lfo: expected an object/,
    );
    expect(() =>
      loadPatchFile('lead-bell', { ...real, patch: { ...patch, ops: patch.ops.slice(0, 3) } }),
    ).toThrow(/patch\.ops: length 3, expected 4/);
  });

  it('a missing file field: only the patch is filled', () => {
    expect(() => loadPatchFile('lead-bell', without(real, 'category'))).toThrow(
      /missing field category/,
    );
    expect(() => loadPatchFile('lead-bell', without(real, 'patch'))).toThrow(/missing field patch/);
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

  it('a format it does not know, as a PatchFormatError naming both formats', () => {
    expect(() => loadPatchFile('lead-bell', { ...real, format: 3 })).toThrow(PatchFormatError);
    expect(() => loadPatchFile('lead-bell', { ...real, format: 3 })).toThrow(
      'patches/lead-bell.json: saved with patch format 3, this build reads 2',
    );
    expect(() => loadPatchFile('lead-bell', { ...real, format: '2' })).toThrow(
      /format: expected 2, got 2/,
    );
  });
});

describe('a new patch file', () => {
  it('joins the library, its catalogue and its checks without touching any old test', () => {
    // Written to disk and read back so the temporary file takes the same
    // path a committed one does: JSON on disk, parsed, loaded by id.
    const dir = mkdtempSync(join(tmpdir(), '561-patch-'));
    try {
      const fresh = freshFile(makePatch({ name: 'Probe 561', ops: [{ level: 0.5 }] }));
      writeFileSync(join(dir, 'probe-561.json'), JSON.stringify(fresh, null, 2));
      const raw: unknown = JSON.parse(readFileSync(join(dir, 'probe-561.json'), 'utf8'));
      const library = loadPatchLibrary({ ...PATCH_FILES, 'probe-561': raw });
      expect(Object.keys(library)).toHaveLength(Object.keys(PATCH_FILES).length + 1);
      expect(library['probe-561']?.patch).toEqual(fresh.patch);
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
      for (const id of onDisk) {
        const { category, tags, description } = PATCH_LIBRARY[id]!;
        expect(listing[id]).toEqual({ category, tags, description });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
