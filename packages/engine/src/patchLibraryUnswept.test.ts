/**
 * The unswept loader (#563): the editor's re-read of a folder it just wrote
 * to, where the file's record is missing or stale by construction. It relaxes
 * exactly the sweep's currency and nothing else.
 */
import { describe, expect, it } from 'vitest';

import type { Patch } from './patch';
import { loadPatchFile, loadUnsweptPatchFile } from './patchLibrary';
import { PATCH_FILES } from './patches/index';

const raw = (): Record<string, unknown> => structuredClone(PATCH_FILES['kick']) as never;

describe('loadUnsweptPatchFile', () => {
  it('accepts a file with no headroom record and returns it without one', () => {
    const file = raw();
    delete file['headroom'];
    const entry = loadUnsweptPatchFile('kick', file);
    expect(entry.id).toBe('kick');
    expect(entry.headroom).toBeUndefined();
    expect(() => loadPatchFile('kick', file)).toThrow('missing headroom record');
  });

  it('carries a stale record as written', () => {
    const file = raw();
    const patch = file['patch'] as Patch;
    patch.volume *= 0.5;
    const entry = loadUnsweptPatchFile('kick', file);
    expect(entry.headroom).toEqual(file['headroom']);
    expect(entry.patch.volume).toBe(patch.volume);
    expect(() => loadPatchFile('kick', file)).toThrow('stale headroom record');
  });

  it('agrees with the strict loader on a current file', () => {
    expect(loadUnsweptPatchFile('kick', raw())).toEqual(loadPatchFile('kick', raw()));
  });

  it('still refuses a malformed record, a bad id, a name mismatch and an unknown field', () => {
    const malformed = raw();
    malformed['headroom'] = { worstSeed: 'x' };
    expect(() => loadUnsweptPatchFile('kick', malformed)).toThrow('headroom');
    expect(() => loadUnsweptPatchFile('Kick', raw())).toThrow('not a slug');
    const renamed = raw();
    renamed['name'] = 'Other';
    expect(() => loadUnsweptPatchFile('kick', renamed)).toThrow('≠ patch.name');
    const extra = { ...raw(), colour: 'red' };
    expect(() => loadUnsweptPatchFile('kick', extra)).toThrow('unknown field colour');
  });
});
