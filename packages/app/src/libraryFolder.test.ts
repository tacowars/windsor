/**
 * The folder reader and the handle wrapper (#563) against a fake directory
 * handle: only `<id>.json` files are read, a bad file is reported rather than
 * fatal, the unswept loader admits a fresh write, and the wrapper drives the
 * Chrome handle's file, writable and remove calls.
 */
import { describe, expect, it } from 'vitest';

import {
  PATCH_LIBRARY,
  serialisePatchFile,
} from '../../../packages/client/src/audio/index-for-editor';
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

/** The entry minus its headroom record: what a file looks like before its sweep. */
const withoutHeadroom = <T extends { headroom?: unknown }>(entry: T): Omit<T, 'headroom'> =>
  Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'headroom')) as Omit<
    T,
    'headroom'
  >;

describe('readFolderLibrary', () => {
  it('reads every <id>.json through the unswept loader and reports the rest', async () => {
    const unswept = withoutHeadroom(kick);
    const files = new Map([
      ['kick.json', serialisePatchFile(kick)],
      [
        'fresh.json',
        serialisePatchFile({ ...unswept, name: 'Fresh', patch: { ...kick.patch, name: 'Fresh' } }),
      ],
      ['broken.json', '{"format": 1}'],
      ['notes.txt', 'not a patch'],
      ['Bad Name.json', serialisePatchFile(kick)],
    ]);
    const folder = wrapDirectoryHandle(fakeHandle(files));
    const { entries, problems } = await readFolderLibrary(folder);
    expect(Object.keys(entries).sort()).toEqual(['fresh', 'kick']);
    expect(entries['kick']).toEqual(kick);
    expect(entries['fresh']?.headroom).toBeUndefined();
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
