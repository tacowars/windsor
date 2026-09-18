/**
 * The import script's pure half (#563): a valid downloaded file is copied
 * byte for byte, an invalid one is rejected with the loader's own message,
 * Chrome's ` (1)` suffix maps to the id, and non-patch files are ignored.
 *
 * Since #617 "ignored" reaches the exit code too: `~/Downloads` is full of
 * `.json` that is nothing to do with the console, and every one of those used
 * to be a rejection and take the script's exit status to 1 after a perfectly
 * clean import. Only a file that claims to be a patch — `format` or `patch` —
 * and is then refused is a failure.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PATCH_LIBRARY,
  loadUnsweptPatchFile,
  serialisePatchFile,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  importExitCode,
  importIdFromName,
  importPatches,
  looksLikePatchFile,
} from './importPatches.mjs';

const dirs = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), '563-import-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The entry minus its headroom record: what a downloaded file looks like before its sweep. */
const kickUnswept = Object.fromEntries(
  Object.entries(PATCH_LIBRARY['kick']).filter(([key]) => key !== 'headroom'),
);
const validText = serialisePatchFile(kickUnswept);

describe('importIdFromName', () => {
  it('reads the id and drops a download suffix, and ignores other files', () => {
    expect(importIdFromName('kick.json')).toBe('kick');
    expect(importIdFromName('kick (1).json')).toBe('kick');
    expect(importIdFromName('lead-bell (12).json')).toBe('lead-bell');
    expect(importIdFromName('notes.txt')).toBeNull();
    expect(importIdFromName('song.arrangement')).toBeNull();
  });
});

describe('importPatches', () => {
  it('copies a valid file byte for byte and rejects an invalid one with the loader message', () => {
    const source = temp();
    const patches = join(temp(), 'patches');
    mkdirSync(patches);
    writeFileSync(join(source, 'kick.json'), validText);
    writeFileSync(join(source, 'broken.json'), '{"format": 1, "name": "x"}\n');
    writeFileSync(join(source, 'not json.json'), '{');
    writeFileSync(join(source, 'Bad Id.json'), validText);
    writeFileSync(join(source, 'readme.txt'), 'ignored');
    const result = importPatches({
      sourceDir: source,
      patchesDir: patches,
      loadFile: loadUnsweptPatchFile,
    });
    expect(result.copied).toEqual([{ id: 'kick', file: 'kick.json' }]);
    expect(readFileSync(join(patches, 'kick.json'), 'utf8')).toBe(validText);
    // Both of these claim to be patches — one by its keys, one by its whole
    // body — so both are failures the operator has to look at.
    expect(result.rejected.map((r) => r.file).sort()).toEqual(['Bad Id.json', 'broken.json']);
    expect(result.rejected.find((r) => r.file === 'broken.json').reason).toContain('missing field');
    expect(result.rejected.find((r) => r.file === 'Bad Id.json').reason).toContain('not a slug');
    // A file that is not JSON at all never claimed to be a patch (#617).
    expect(result.skipped.find((r) => r.file === 'not json.json').reason).toMatch(/JSON/);
    expect(importExitCode(result)).toBe(1);
  });

  it('takes the newest of several downloads of one id and reports the rest as skipped', () => {
    const source = temp();
    const patches = temp();
    const older = join(source, 'kick.json');
    const newer = join(source, 'kick (1).json');
    writeFileSync(older, validText.replace('"FM Kick"', '"FM Kick"'));
    writeFileSync(newer, validText);
    const past = new Date(Date.now() - 60_000);
    utimesSync(older, past, past);
    const result = importPatches({
      sourceDir: source,
      patchesDir: patches,
      loadFile: loadUnsweptPatchFile,
    });
    expect(result.copied).toEqual([{ id: 'kick', file: 'kick (1).json' }]);
    expect(result.skipped).toEqual([{ file: 'kick.json', reason: 'older than kick (1).json' }]);
    expect(result.rejected).toEqual([]);
  });

  it('imports the patch and exits 0 when the folder also holds unrelated json (#617)', () => {
    const source = temp();
    const patches = join(temp(), 'patches');
    mkdirSync(patches);
    writeFileSync(join(source, 'kick.json'), validText);
    // The kind of thing that really sits in ~/Downloads beside a patch.
    writeFileSync(join(source, 'tsconfig.json'), '{"compilerOptions": {"strict": true}}\n');
    writeFileSync(join(source, 'export.json'), '[{"id": 1, "label": "row"}]\n');
    writeFileSync(join(source, 'bookmarks.json'), '"a string"\n');
    const result = importPatches({
      sourceDir: source,
      patchesDir: patches,
      loadFile: loadUnsweptPatchFile,
    });
    expect(result.copied).toEqual([{ id: 'kick', file: 'kick.json' }]);
    expect(result.rejected).toEqual([]);
    expect(result.skipped.map((r) => r.file).sort()).toEqual([
      'bookmarks.json',
      'export.json',
      'tsconfig.json',
    ]);
    expect(importExitCode(result)).toBe(0);
  });

  it('still exits 1 when a file that claims to be a patch fails validation (#617)', () => {
    const source = temp();
    const patches = join(temp(), 'patches');
    mkdirSync(patches);
    writeFileSync(join(source, 'kick.json'), validText);
    writeFileSync(join(source, 'half-written.json'), '{"format": 1, "name": "half"}\n');
    const result = importPatches({
      sourceDir: source,
      patchesDir: patches,
      loadFile: loadUnsweptPatchFile,
    });
    expect(result.copied).toEqual([{ id: 'kick', file: 'kick.json' }]);
    expect(result.rejected.map((r) => r.file)).toEqual(['half-written.json']);
    expect(importExitCode(result)).toBe(1);
  });
});

describe('looksLikePatchFile', () => {
  it("takes the editor's own keys and nothing else", () => {
    expect(looksLikePatchFile(JSON.parse(validText))).toBe(true);
    expect(looksLikePatchFile({ format: 1 })).toBe(true);
    expect(looksLikePatchFile({ patch: {} })).toBe(true);
    expect(looksLikePatchFile({ compilerOptions: {} })).toBe(false);
    expect(looksLikePatchFile([{ format: 1 }])).toBe(false);
    expect(looksLikePatchFile('a string')).toBe(false);
    expect(looksLikePatchFile(null)).toBe(false);
  });
});
