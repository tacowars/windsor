/**
 * Patch format upgrades (record `2026-09-28-format-versions-refuse-never-destroy`):
 * a file with no `format` is format 1, a format the chain reaches is upgraded,
 * and any other is refused with the formats named — never half-read. Format
 * 2 retired the headroom record and `userKey` (record
 * `2026-09-28-retire-the-headroom-record`); format 3 moved the filter's drive
 * into the voice's drive stage (windsor#300, record
 * `2026-10-01-voice-drive-stage`); format 4 renamed the operators' `noiseLp`
 * and `noiseHp` to `opLp` and `opHp` (windsor#590, record
 * `2026-10-04-operator-filters-on-every-wave`).
 */
// reads-by-path: packages/engine/src/patches/**
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
/** A library file at this build's format: the LP filter at drive 1.6 before format 3. */
const real = (
  upgradePatchFile(JSON.parse(readFileSync(join(PATCHES, 'bass-digital.json'), 'utf8'))) as {
    value: Record<string, unknown>;
  }
).value;
const realPatch = real['patch'] as Patch;

/** The same file as format 2 wrote it: the drive's gain back inside the filter, after `resonance`. */
const formatTwo = (): Record<string, unknown> => {
  const { mode, cutoff, resonance, ...tail } = realPatch.filter;
  const filter = { mode, cutoff, resonance, drive: realPatch.drive.gain, ...tail };
  const patch = Object.fromEntries(
    Object.entries(realPatch)
      .filter(([key]) => key !== 'drive')
      .map(([key, value]) => [key, key === 'filter' ? filter : value]),
  );
  return { ...real, format: 2, patch };
};

/** A library file that carries the operator filters' keys, at this build's format. */
const acid = (
  upgradePatchFile(JSON.parse(readFileSync(join(PATCHES, 'acid-saw.json'), 'utf8'))) as {
    value: Record<string, unknown>;
  }
).value;

/** `acid` as format 3 wrote it: `noiseLp` and `noiseHp` where `opLp` and `opHp` stand. */
const acidFormatThree = (): Record<string, unknown> => {
  const patch = acid['patch'] as Patch;
  const ops = patch.ops.map((op) =>
    Object.fromEntries(
      Object.entries(op).map(([key, value]) => [
        key === 'opLp' ? 'noiseLp' : key === 'opHp' ? 'noiseHp' : key,
        value,
      ]),
    ),
  );
  return { ...acid, format: 3, patch: { ...patch, ops } };
};

/** The same file as format 1 wrote it: `userKey` after `userPartials` in every operator, and a headroom record. */
const formatOne = (): Record<string, unknown> => {
  const two = formatTwo();
  const patch = two['patch'] as Patch;
  const ops = patch.ops.map((op) => {
    const { wave, userPartials, ...rest } = op;
    return { wave, userPartials, userKey: '', ...rest };
  });
  return {
    ...two,
    format: 1,
    patch: { ...patch, ops },
    headroom: { worstSeed: 8808, peak: 0.7224734425544739, seedsSwept: 16384, contentHash: 'x' },
  };
};

describe('patch format upgrades', () => {
  it('reads format 4: three patch steps, and one file step for 1 → 2', () => {
    expect(PATCH_FILE_FORMAT).toBe(4);
    expect(Object.keys(PATCH_MIGRATIONS)).toEqual(['1', '2', '3']);
    expect(Object.keys(PATCH_FILE_MIGRATIONS)).toEqual(['1']);
    expect(realPatch.drive).toEqual({ gain: 1.6, shape: 0, bias: 0, tone: 1 });
  });

  it('loads a format-2 file to the same entry, the drive moved out of the filter', () => {
    const old = formatTwo();
    expect(loadPatchFile('bass-digital', old)).toEqual(loadPatchFile('bass-digital', real));
    const upgraded = upgradePatchFile(old);
    expect(upgraded).toEqual({ value: real });
    // Key order kept, so the rewrite through the serialiser moves no byte.
    const value = (upgraded as { value: { patch: object } }).value;
    expect(Object.keys(value.patch)).toEqual(Object.keys(realPatch));
    expect(Object.keys((value.patch as Patch).filter)).toEqual(Object.keys(realPatch.filter));
  });

  it('loads a format-3 file to the same entry, noiseLp and noiseHp renamed opLp and opHp (windsor#590)', () => {
    const old = acidFormatThree();
    expect(JSON.stringify(old)).toContain('"noiseLp":0');
    expect(loadPatchFile('acid-saw', old)).toEqual(loadPatchFile('acid-saw', acid));
    const upgraded = upgradePatchFile(old);
    expect(upgraded).toEqual({ value: acid });
    // Key order kept, so the rewrite through the serialiser moves no byte.
    const ops = ((upgraded as { value: { patch: Patch } }).value.patch as Patch).ops;
    expect(ops.map((op) => Object.keys(op))).toEqual(
      (acid['patch'] as Patch).ops.map((op) => Object.keys(op)),
    );
    // Values kept, opTrack left to the normaliser's 0.
    const op = { wave: 4, noiseLp: 10089.5, noiseHp: 2370.25, level: 0.8 };
    expect(upgradePatch({ ops: [op, 'junk'], volume: 1 }, 3)).toEqual({
      value: { ops: [{ wave: 4, opLp: 10089.5, opHp: 2370.25, level: 0.8 }, 'junk'], volume: 1 },
    });
    expect(loadPatchFile('acid-saw', old).patch.ops.map((o) => o.opTrack)).toEqual([0, 0, 0, 0]);
    expect(upgradePatch({ volume: 0.5 }, 3)).toEqual({ value: { volume: 0.5 } });
  });

  it('zeroes a format-3 non-Noise operator’s hidden noiseLp and noiseHp, which it never heard', () => {
    const saw = { wave: 1, noiseLp: 3000, noiseHp: 400, level: 0.8 };
    const noWave = { noiseLp: 3000 }; // the default wave, Sine
    const noise = { wave: 4, noiseLp: 3000, noiseHp: 400 };
    expect(upgradePatch({ ops: [saw, noWave, noise] }, 3)).toEqual({
      value: {
        ops: [
          { wave: 1, opLp: 0, opHp: 0, level: 0.8 },
          { opLp: 0 },
          { wave: 4, opLp: 3000, opHp: 400 },
        ],
      },
    });
  });

  it('keeps a filter-off drive silent: the stage takes unity gain (windsor#300)', () => {
    const off = { filter: { mode: 0, drive: 2.5, cutoff: 900 }, volume: 0.5 };
    expect(upgradePatch(off, 2)).toEqual({
      value: {
        filter: { mode: 0, cutoff: 900 },
        volume: 0.5,
        drive: { gain: 1, shape: 0, bias: 0, tone: 1 },
      },
    });
    // No mode is the default, Off; a fractional mode reads as the worklet's `| 0`.
    expect(upgradePatch({ filter: { drive: 2 } }, 2)).toMatchObject({
      value: { drive: { gain: 1 } },
    });
    expect(upgradePatch({ filter: { mode: 2.5, drive: 2 } }, 2)).toMatchObject({
      value: { drive: { gain: 2 } },
    });
  });

  it('leaves a partial patch with no filter drive as it is', () => {
    expect(upgradePatch({ volume: 0.5, filter: { cutoff: 500 } }, 2)).toEqual({
      value: { volume: 0.5, filter: { cutoff: 500 } },
    });
    expect(upgradePatch({ volume: 0.5 }, 2)).toEqual({ value: { volume: 0.5 } });
  });

  it('loads a format-1 file with a headroom record and userKey to the same entry', () => {
    const old = formatOne();
    expect(loadPatchFile('bass-digital', old)).toEqual(loadPatchFile('bass-digital', real));
    const upgraded = upgradePatchFile(old);
    expect(upgraded).toEqual({ value: real });
    // Key order kept, so the rewrite through the serialiser moves no byte.
    expect(Object.keys((upgraded as { value: object }).value)).toEqual(Object.keys(real));
  });

  it('loads a format-1 file with neither, and one with no format at all', () => {
    expect(loadPatchFile('bass-digital', { ...formatTwo(), format: 1 })).toEqual(
      loadPatchFile('bass-digital', real),
    );
    const unversioned = formatOne();
    delete unversioned['format'];
    expect(upgradePatchFile(unversioned)).toEqual({ value: real });
  });

  it('still refuses an unknown key in a format-1 file, naming it', () => {
    expect(() => loadPatchFile('bass-digital', { ...formatOne(), colour: 'red' })).toThrow(
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
    expect(upgradePatchFile({ ...real, format: 5 })).toEqual({
      refused: {
        format: 'patch',
        found: 5,
        reads: 4,
        message: 'saved with patch format 5, this build reads 4',
      },
    });
    expect(() => loadPatchFile('bass-digital', { ...real, format: 5 })).toThrow(PatchFormatError);
  });

  it('refuses an older format no upgrade reaches', () => {
    expect(upgradePatchFile({ ...real, format: 0 })).toMatchObject({
      refused: { found: 0, reads: 4 },
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
    expect(() => loadPatchFile('bass-digital', junk)).toThrow(/format: expected 4, got one/);
  });
});
