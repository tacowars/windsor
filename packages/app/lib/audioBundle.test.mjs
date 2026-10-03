/**
 * The shared esbuild prelude's pure half (#620 decision 5): the options every
 * console script bundles with, checked without running esbuild.
 */
// reads-by-path: packages/engine/src/patch/patchLibrary.ts, packages/engine/src/__fixtures__/**
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AUDIO_DIR, audioBundleOptions } from './audioBundle.mjs';

describe('audioBundleOptions', () => {
  it('resolves the exports from the real audio directory and defines import.meta.url inside its fixtures', () => {
    const source = `export { loadPatchFile } from './patch/patchLibrary';`;
    const options = audioBundleOptions(source, 'test-import-patches');
    expect(options.stdin).toEqual({ contents: source, resolveDir: AUDIO_DIR, loader: 'ts' });
    expect(existsSync(join(AUDIO_DIR, 'patch/patchLibrary.ts'))).toBe(true);
    expect(existsSync(join(AUDIO_DIR, '__fixtures__/workletHarness.ts'))).toBe(true);
    expect(options.outfile.endsWith('node_modules/.cache-test-import-patches.mjs')).toBe(true);
    expect(options).toMatchObject({ bundle: true, platform: 'node', format: 'esm' });
    const url = JSON.parse(options.define['import.meta.url']);
    expect(url.startsWith('file://')).toBe(true);
    expect(url.endsWith('/__fixtures__/entry.ts')).toBe(true);
  });

  it('refuses a cache name that is not a slug', () => {
    expect(() => audioBundleOptions('', '../escape')).toThrow(/not a slug/);
    expect(() => audioBundleOptions('', '563 import')).toThrow(/not a slug/);
  });
});
