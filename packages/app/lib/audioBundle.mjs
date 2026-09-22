/**
 * The one esbuild prelude the console's Node scripts share (#620 decision 5):
 * bundle a handful of exports from `packages/client/src/audio` — TypeScript
 * the scripts cannot import directly — into a cache file and import that.
 * `import-patches.mjs`, `sweep-headroom.mjs` and `migrate-patches-586.mjs`
 * each used to carry their own copy of this.
 *
 * `import.meta.url` is defined as a file under `__fixtures__/` so the worklet
 * harness (which reads `../worklet/generated/fm-processor.js` relative to itself)
 * resolves from inside the bundle; a source that never reads it is unaffected.
 */
import { build } from 'esbuild';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/client/src/audio`, the directory every bundled export resolves from. */
export const AUDIO_DIR = resolve(HERE, '../../../packages/client/src/audio');

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

/**
 * The console page's own bundle (`build-editor.mjs`): `src/main.ts` with the
 * engine behind `index-for-editor.ts`, as one browser IIFE, returned as text.
 * `workletMessages.ts` builds its default URLs from `import.meta.url`, which
 * an IIFE lacks; the host always passes blob-URL overrides, so the defaults
 * only need to *construct* without throwing.
 */
export async function bundleConsoleApp(entryPoint) {
  const bundle = await build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    legalComments: 'none',
    define: { 'import.meta.url': 'self.location.href' },
  });
  const [output] = bundle.outputFiles;
  if (!output) throw new Error('the console bundle produced no output');
  return output.text;
}
