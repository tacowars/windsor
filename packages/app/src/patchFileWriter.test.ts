/**
 * What Save writes (#563): a file byte-identical to the #561 migration's for
 * the same data, loading through #561's loader, and the download Blob that
 * carries it when no folder is connected.
 */
import { describe, expect, it } from 'vitest';

import { PATCH_LIBRARY, loadPatchFile, loadUnsweptPatchFile } from '@windsor/engine';
import { buildPatchFile, patchFileBlob, patchFileName, patchFileText } from './patchFileWriter';

const entry = PATCH_LIBRARY['lead-bell']!;
const meta = {
  name: entry.name,
  category: entry.category,
  tags: [...entry.tags],
  description: entry.description,
};

describe('buildPatchFile', () => {
  it('writes the migration bytes for a library entry saved unchanged, and it loads', () => {
    const file = buildPatchFile(meta, entry.patch, entry.headroom);
    const text = patchFileText(file);
    expect(text).toBe(
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
      ) + '\n',
    );
    expect(loadPatchFile(entry.id, JSON.parse(text))).toEqual(entry);
  });

  it('renames the patch to the display name and leaves a new patch without a record', () => {
    const file = buildPatchFile({ ...meta, name: 'Renamed Bell' }, entry.patch);
    expect(file.name).toBe('Renamed Bell');
    expect(file.patch.name).toBe('Renamed Bell');
    expect(file.headroom).toBeUndefined();
    expect(entry.patch.name).toBe(entry.name);
    const loaded = loadUnsweptPatchFile('renamed-bell', JSON.parse(patchFileText(file)));
    expect(loaded.patch).toEqual({ ...entry.patch, name: 'Renamed Bell' });
  });
});

describe('the download', () => {
  it('is a JSON Blob of exactly the file bytes, named <id>.json', async () => {
    const text = patchFileText(buildPatchFile(meta, entry.patch, entry.headroom));
    const blob = patchFileBlob(text);
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe(text);
    expect(blob.size).toBe(new TextEncoder().encode(text).byteLength);
    expect(patchFileName(entry.id)).toBe('lead-bell.json');
  });
});
