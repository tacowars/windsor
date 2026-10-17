/* global process */
/**
 * The rack bank's scripts import the engine's own TypeScript: `bundleImport`
 * bundles an entry's exports with esbuild into one file under a throwaway
 * `/tmp/windsor-878-rack-bank-*` folder, imports it and removes the folder.
 * A file, not a `data:` URL, because the engine resolves its worklets with
 * `new URL(…, import.meta.url)`, which a `data:` URL cannot base.
 */
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The repository root: the scripts run from it (`node docs/research/…`). */
export const REPO = process.cwd();
export const ENGINE = join(REPO, 'packages/engine/src');

/** The module `contents` builds, resolved from the engine's source folder. */
export async function bundleImport(contents) {
  const { outputFiles } = buildSync({
    stdin: { contents, resolveDir: ENGINE, loader: 'ts' },
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'neutral',
    loader: { '.json': 'json' },
  });
  const folder = mkdtempSync(join(tmpdir(), 'windsor-878-rack-bank-'));
  try {
    const file = join(folder, 'engine.mjs');
    writeFileSync(file, outputFiles[0].text);
    return await import(file);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
