/**
 * The one esbuild prelude the library's Node scripts share (#620 decision 5):
 * bundle a handful of exports from `packages/engine/src` — TypeScript
 * the scripts cannot import directly — into a cache file and import that.
 * The library's scripts each used to carry their own copy of this.
 *
 * `import.meta.url` is defined as a file under `__fixtures__/` so the worklet
 * harness (which reads `../worklet/generated/fm-processor.js` relative to itself)
 * resolves from inside the bundle; a source that never reads it is unaffected.
 */
import { build } from 'esbuild';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/engine/src`, the directory every bundled export resolves from. */
export const AUDIO_DIR = resolve(HERE, '../../engine/src');

/** A cache name is one slug: the file lands in `node_modules/` of the cwd (the repo root). */
export const CACHE_NAME_RULE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The esbuild options for `exportsSource` (`export { a, b } from './x';` lines,
 * resolved from `audioDir`), written to `node_modules/.cache-<cacheName>.mjs`.
 * Pure: the test checks the shape without running esbuild.
 */
export function audioBundleOptions(exportsSource, cacheName, audioDir = AUDIO_DIR) {
  if (!CACHE_NAME_RULE.test(cacheName)) {
    throw new Error(`audioBundle: cache name "${cacheName}" is not a slug`);
  }
  return {
    stdin: { contents: exportsSource, resolveDir: audioDir, loader: 'ts' },
    outfile: resolve(`node_modules/.cache-${cacheName}.mjs`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: {
      'import.meta.url': JSON.stringify(
        pathToFileURL(join(audioDir, '__fixtures__/entry.ts')).href,
      ),
    },
  };
}

/** Bundle `exportsSource` and return its module namespace. */
export async function loadAudioExports(exportsSource, cacheName) {
  const options = audioBundleOptions(exportsSource, cacheName);
  await build(options);
  return import(pathToFileURL(options.outfile).href);
}
