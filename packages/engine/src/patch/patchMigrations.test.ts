/**
 * Patch format upgrades (record `2026-09-28-format-versions-refuse-never-destroy`):
 * a file with no `format` is format 1, a format the chain reaches is upgraded,
 * and any other is refused with the formats named — never half-read.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadUnsweptPatchFile } from './patchLibrary';
import {
  PATCH_FILE_FORMAT,
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

describe('patch format upgrades', () => {
  it('ships no upgrade: format 1 is the only one there has been', () => {
    expect(PATCH_FILE_FORMAT).toBe(1);
    expect(PATCH_MIGRATIONS).toEqual({});
  });

  it('reads a file with no format as format 1 and writes the format in', () => {
    const unversioned = { ...real };
    delete unversioned['format'];
    const upgraded = upgradePatchFile(unversioned);
    expect(upgraded).toEqual({ value: { ...unversioned, format: 1 } });
  });

  it('refuses a newer format, naming both', () => {
    expect(upgradePatchFile({ ...real, format: 99 })).toEqual({
      refused: {
        format: 'patch',
        found: 99,
        reads: 1,
        message: 'saved with patch format 99, this build reads 1',
      },
    });
    expect(() => loadUnsweptPatchFile('lead-bell', { ...real, format: 99 })).toThrow(
      PatchFormatError,
    );
  });

  it('refuses an older format no upgrade reaches', () => {
    expect(upgradePatchFile({ ...real, format: 0 })).toMatchObject({
      refused: { found: 0, reads: 1 },
    });
  });

  it('upgrades a format one step behind, and chains two steps', () => {
    const table = {
      [-1]: (patch: Record<string, unknown>) => ({ ...patch, steps: ['-1→0'] }),
      0: (patch: Record<string, unknown>) => ({
        ...patch,
        steps: [...((patch['steps'] as string[] | undefined) ?? []), '0→1'],
      }),
    };
    expect(upgradePatch({ volume: 1 }, 0, table)).toEqual({
      value: { volume: 1, steps: ['0→1'] },
    });
    expect(upgradePatch({ volume: 1 }, -1, table)).toEqual({
      value: { volume: 1, steps: ['-1→0', '0→1'] },
    });
    const file = upgradePatchFile({ ...real, format: 0 }, table);
    expect(file).toEqual({
      value: { ...real, format: 1, patch: { ...(real['patch'] as object), steps: ['0→1'] } },
    });
  });

  it('leaves a format that is not an integer for the validator to report', () => {
    const junk = { ...real, format: 'one' };
    expect(upgradePatchFile(junk)).toEqual({ value: junk });
    expect(() => loadUnsweptPatchFile('lead-bell', junk)).toThrow(/format: expected 1, got one/);
  });
});
