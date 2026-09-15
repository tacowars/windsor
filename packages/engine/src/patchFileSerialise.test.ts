/**
 * The shared file serialiser (#563) writes exactly what the #561 migration
 * wrote, so a file from the editor, the sweep and the migration are the same
 * bytes for the same data, and what it writes loads through the loader.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { serialisePatchFile } from './patchFileSerialise';
import { loadPatchFile, loadUnsweptPatchFile } from './patchLibrary';
import { PATCH_LIBRARY } from './presets';

/** The entry minus its headroom record: what a file looks like before its sweep. */
const withoutHeadroom = <T extends { headroom?: unknown }>(entry: T): Omit<T, 'headroom'> =>
  Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'headroom')) as Omit<
    T,
    'headroom'
  >;

/** Verbatim the migration's expression (`migrate-patches-561.mjs`): key order, indent, newline. */
const migrationWrites = (entry: (typeof PATCH_LIBRARY)[string]): string =>
  JSON.stringify(
    {
      format: 1,
      name: entry.patch.name,
      category: entry.category,
      tags: [...entry.tags],
      description: entry.description,
      patch: entry.patch,
      headroom: entry.headroom,
    },
    null,
    2,
  ) + '\n';

describe('serialisePatchFile', () => {
  const entry = PATCH_LIBRARY['kick'];
  if (!entry) throw new Error('kick is not in the library');

  it('is byte-identical to the migration for a real library entry', () => {
    expect(serialisePatchFile(entry)).toBe(migrationWrites(entry));
  });

  it('is byte-identical to what the sweep writes, whatever key order the input had', () => {
    // The sweep serialises the file it read plus the record it computed; a
    // file whose keys arrived shuffled (a hand edit) is still written in the
    // contract's order.
    const shuffled = { headroom: entry.headroom, patch: entry.patch, ...entry };
    expect(serialisePatchFile(shuffled)).toBe(migrationWrites(entry));
  });

  it('round-trips through the loader, and the sweep script reads it back as JSON', () => {
    const text = serialisePatchFile(entry);
    expect(loadPatchFile(entry.id, JSON.parse(text))).toEqual(entry);
    // The sweep's own reader is a plain `JSON.parse` of the file (`readFile`).
    const sweep = readFileSync('tools/patch-editor/sweep-headroom.mjs', 'utf8');
    expect(sweep).toContain('serialisePatchFile(file)');
    expect(sweep).not.toContain("JSON.stringify(file, null, 2) + '\\n'");
  });

  it('omits the headroom key for an unswept file, which the unswept loader accepts', () => {
    const unswept = withoutHeadroom(entry);
    const text = serialisePatchFile(unswept);
    expect(text).not.toContain('"headroom"');
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual([
      'format',
      'name',
      'category',
      'tags',
      'description',
      'patch',
    ]);
    expect(loadUnsweptPatchFile(entry.id, JSON.parse(text)).headroom).toBeUndefined();
    expect(() => loadPatchFile(entry.id, JSON.parse(text))).toThrow('missing headroom record');
  });
});
