/**
 * The shared file serialiser (#563): one key order, one indent, one trailing
 * newline for every writer, and what it writes loads back through the loader.
 */
import { describe, expect, it } from 'vitest';

import { serialisePatchFile } from './patchFileSerialise';
import { PATCH_FILE_FORMAT, loadPatchFile } from './patchLibrary';
import { PATCH_LIBRARY } from './presets';

/** The contract spelled out: key order, indent, newline. */
const contractWrites = (entry: (typeof PATCH_LIBRARY)[string]): string =>
  JSON.stringify(
    {
      format: 4,
      name: entry.patch.name,
      category: entry.category,
      tags: [...entry.tags],
      description: entry.description,
      patch: entry.patch,
    },
    null,
    2,
  ) + '\n';

describe('serialisePatchFile', () => {
  const entry = PATCH_LIBRARY['kick'];
  if (!entry) throw new Error('kick is not in the library');

  it('writes format 4 and the contract key order, and nothing else', () => {
    const text = serialisePatchFile(entry);
    expect(PATCH_FILE_FORMAT).toBe(4);
    expect(text).toBe(contractWrites(entry));
    expect(Object.keys(JSON.parse(text))).toEqual([
      'format',
      'name',
      'category',
      'tags',
      'description',
      'patch',
    ]);
    expect(text).not.toContain('"id"');
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('writes the contract order whatever key order the input had', () => {
    // A file whose keys arrived shuffled (a hand edit) is still written in
    // the contract's order.
    const shuffled = Object.fromEntries(Object.entries(entry).reverse()) as typeof entry;
    expect(serialisePatchFile(shuffled)).toBe(contractWrites(entry));
  });

  it('round-trips through the loader', () => {
    const text = serialisePatchFile(entry);
    expect(loadPatchFile(entry.id, JSON.parse(text))).toEqual(entry);
  });
});
