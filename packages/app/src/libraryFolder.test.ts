/**
 * The folder reader and the handle wrapper (#563) against a fake directory
 * handle: only `<id>.json` files are read, a bad file is reported rather than
 * fatal, the library loader admits a fresh write and upgrades an old one, and
 * the wrapper drives the
 * Chrome handle's file, writable and remove calls.
 */
import { describe, expect, it } from 'vitest';

import { serialisePatchFile } from '@windsor/engine';
import { PATCH_LIBRARY } from '@windsor/engine/patch/presets';
import type { ChromeDirectoryHandle } from './libraryFolder';
import { readFolderLibrary, wrapDirectoryHandle } from './libraryFolder';

/** A `FileSystemDirectoryHandle` stand-in over a map of file name → text. */
function fakeHandle(files: Map<string, string>): ChromeDirectoryHandle & { log: string[] } {
  const log: string[] = [];
  return {
    name: 'patches',
    log,
    async *values() {
      for (const name of files.keys()) yield { kind: 'file' as const, name };
      yield { kind: 'directory' as const, name: 'nested' };
    },
    getFileHandle: (name, options) => {
      if (!files.has(name) && !options?.create) return Promise.reject(new Error(`no ${name}`));
      log.push(`open ${name}${options?.create ? ' (create)' : ''}`);
      return Promise.resolve({
        getFile: () => Promise.resolve({ text: () => Promise.resolve(files.get(name) ?? '') }),
        createWritable: () => {
          let pending = '';
          return Promise.resolve({
            write: (data: string) => {
              pending += data;
              return Promise.resolve();
            },
            close: () => {
              files.set(name, pending);
              log.push(`wrote ${name}`);
              return Promise.resolve();
            },
          });
        },
      });
    },
    removeEntry: (name) => {
      files.delete(name);
      log.push(`removed ${name}`);
      return Promise.resolve();
    },
    queryPermission: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted'),
  };
}

const kick = PATCH_LIBRARY['kick']!;

/** The kick as format 1 stored it: a headroom record, and `userKey` in every operator. */
const formatOne = (): string => {
  const file = JSON.parse(serialisePatchFile(kick)) as Record<string, unknown>;
  const patch = file['patch'] as { ops: Record<string, unknown>[] };
  patch.ops = patch.ops.map((op) => ({ ...op, userKey: '' }));
  const headroom = { worstSeed: 1, peak: 0.5, seedsSwept: 16, contentHash: '0badf00d' };
  return `${JSON.stringify({ ...file, format: 1, headroom }, null, 2)}\n`;
};

describe('readFolderLibrary', () => {
  it('reads every <id>.json through the library loader and reports the rest', async () => {
    const files = new Map([
      ['kick.json', serialisePatchFile(kick)],
      [
        'fresh.json',
        serialisePatchFile({ ...kick, name: 'Fresh', patch: { ...kick.patch, name: 'Fresh' } }),
      ],
      ['old-kick.json', formatOne()],
      ['broken.json', '{"format": 1}'],
      ['notes.txt', 'not a patch'],
      ['Bad Name.json', serialisePatchFile(kick)],
    ]);
    const folder = wrapDirectoryHandle(fakeHandle(files));
    const { entries, problems } = await readFolderLibrary(folder);
    expect(Object.keys(entries).sort()).toEqual(['fresh', 'kick', 'old-kick']);
    expect(entries['kick']).toEqual(kick);
    expect(entries['fresh']?.name).toBe('Fresh');
    // A format-1 file upgrades on the read: the same entry, the retired keys gone.
    expect(entries['old-kick']).toEqual({ ...kick, id: 'old-kick' });
    expect(problems).toHaveLength(2);
    expect(problems.find((p) => p.includes('broken'))).toContain('missing field');
    expect(problems.find((p) => p.includes('Bad Name'))).toContain('not a slug');
  });
});

describe('wrapDirectoryHandle', () => {
  it('lists files only, writes through a writable it closes, and removes', async () => {
    const files = new Map([['kick.json', serialisePatchFile(kick)]]);
    const handle = fakeHandle(files);
    const folder = wrapDirectoryHandle(handle);
    expect(folder.name).toBe('patches');
    expect(await folder.list()).toEqual(['kick.json']);
    await folder.write('new.json', '{}\n');
    expect(files.get('new.json')).toBe('{}\n');
    expect(await folder.read('new.json')).toBe('{}\n');
    await folder.remove('new.json');
    expect(files.has('new.json')).toBe(false);
    expect(handle.log).toEqual([
      'open new.json (create)',
      'wrote new.json',
      'open new.json',
      'removed new.json',
    ]);
  });
});
