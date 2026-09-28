/**
 * Patch format upgrades (record `2026-09-28-format-versions-refuse-never-destroy`):
 * a file with no `format` is format 1, a format the chain reaches is upgraded,
 * and any other is refused with the formats named — never half-read. Format
 * 2 retired the headroom record and `userKey` (record
 * `2026-09-28-retire-the-headroom-record`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Patch } from './patch';
import { loadPatchFile } from './patchLibrary';
import {
  PATCH_FILE_FORMAT,
  PATCH_FILE_MIGRATIONS,
  PATCH_MIGRATIONS,
  PatchFormatError,
  upgradePatch,
  upgradePatchFile,
} from './patchMigrations';

const PATCHES = join(dirname(fileURLToPath(import.meta.url)), '../patches');
const real = JSON.parse(readFileSync(join(PATCHES, 'lead-bell.json'), 'utf8')) as Record<
  string,
  unknown
>;
const realPatch = real['patch'] as Patch;

/** The same file as format 1 wrote it: `userKey` after `userPartials` in every operator, and a headroom record. */
const formatOne = (): Record<string, unknown> => {
  const ops = realPatch.ops.map((op) => {
    const { wave, userPartials, ...rest } = op;
    return { wave, userPartials, userKey: '', ...rest };
  });
  return {
    ...real,
    format: 1,
    patch: { ...realPatch, ops },
    headroom: { worstSeed: 8808, peak: 0.7224734425544739, seedsSwept: 16384, contentHash: 'x' },
  };
};

describe('patch format upgrades', () => {
  it('reads format 2, and upgrades 1 → 2 with one step each for the patch and the file', () => {
    expect(PATCH_FILE_FORMAT).toBe(2);
    expect(Object.keys(PATCH_MIGRATIONS)).toEqual(['1']);
    expect(Object.keys(PATCH_FILE_MIGRATIONS)).toEqual(['1']);
  });

  it('loads a format-1 file with a headroom record and userKey to the same entry', () => {
    const old = formatOne();
    expect(loadPatchFile('lead-bell', old)).toEqual(loadPatchFile('lead-bell', real));
    const upgraded = upgradePatchFile(old);
    expect(upgraded).toEqual({ value: real });
    // Key order kept, so the rewrite through the serialiser moves no byte.
    expect(Object.keys((upgraded as { value: object }).value)).toEqual(Object.keys(real));
  });

  it('loads a format-1 file with neither, and one with no format at all', () => {
    expect(loadPatchFile('lead-bell', { ...real, format: 1 })).toEqual(
      loadPatchFile('lead-bell', real),
    );
    const unversioned = formatOne();
    delete unversioned['format'];
    expect(upgradePatchFile(unversioned)).toEqual({ value: real });
  });

  it('still refuses an unknown key in a format-1 file, naming it', () => {
    expect(() => loadPatchFile('lead-bell', { ...formatOne(), colour: 'red' })).toThrow(
      /unknown field colour/,
    );
  });

  it('drops userKey from a partial patch as a song embeds it, and leaves the rest', () => {
    const partial = { volume: 0.5, ops: [{ userKey: 'x', ratio: 2 }, 'junk'] };
    expect(upgradePatch(partial, 1)).toEqual({
      value: { volume: 0.5, ops: [{ ratio: 2 }, 'junk'] },
    });
    expect(upgradePatch({ volume: 0.5 }, 1)).toEqual({ value: { volume: 0.5 } });
  });

  it('refuses a newer format, naming both', () => {
    expect(upgradePatchFile({ ...real, format: 3 })).toEqual({
      refused: {
        format: 'patch',
        found: 3,
        reads: 2,
        message: 'saved with patch format 3, this build reads 2',
      },
    });
    expect(() => loadPatchFile('lead-bell', { ...real, format: 3 })).toThrow(PatchFormatError);
  });

  it('refuses an older format no upgrade reaches', () => {
    expect(upgradePatchFile({ ...real, format: 0 })).toMatchObject({
      refused: { found: 0, reads: 2 },
    });
  });

  it('upgrades a format two steps behind through the chain, the file steps included', () => {
    const table = {
      ...PATCH_MIGRATIONS,
      0: (patch: Record<string, unknown>) => ({ ...patch, steps: ['0→1'] }),
    };
    expect(upgradePatch({ volume: 1 }, 0, table)).toEqual({
      value: { volume: 1, steps: ['0→1'] },
    });
    const file = upgradePatchFile({ ...formatOne(), format: 0 }, table);
    expect(file).toEqual({ value: { ...real, patch: { ...realPatch, steps: ['0→1'] } } });
  });

  it('leaves a format that is not an integer for the validator to report', () => {
    const junk = { ...real, format: 'one' };
    expect(upgradePatchFile(junk)).toEqual({ value: junk });
    expect(() => loadPatchFile('lead-bell', junk)).toThrow(/format: expected 2, got one/);
  });
});
