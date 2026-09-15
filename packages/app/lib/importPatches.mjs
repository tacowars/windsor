/**
 * The pure half of `import-patches.mjs` (#563): which downloaded files are
 * patch files, which of them the loader accepts, and the copy into
 * `patches/`. The loader is injected — the CLI bundles the audio package's
 * `loadUnsweptPatchFile` with esbuild, the test imports it straight from the
 * TypeScript source — so this file needs no bundler of its own.
 */
import { copyFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The id a downloaded file name carries, or null. Chrome suffixes a repeat
 * download as `kick (1).json`; the suffix is dropped. The id itself must
 * satisfy the loader's slug rule, which it re-checks.
 */
export function importIdFromName(fileName) {
  const match = /^(.+?)(?: \((\d+)\))?\.json$/.exec(fileName);
  return match ? match[1] : null;
}

/**
 * Validate every `<id>.json` in `sourceDir` with `loadFile(id, raw)` and copy
 * the accepted ones, bytes untouched, to `patchesDir/<id>.json`. When several
 * files map to one id (`kick.json`, `kick (1).json`), the newest is taken and
 * the others reported as skipped.
 */
export function importPatches({ sourceDir, patchesDir, loadFile }) {
  const copied = [];
  const rejected = [];
  const skipped = [];
  const byId = new Map();
  for (const name of readdirSync(sourceDir)) {
    const id = importIdFromName(name);
    if (id === null) continue;
    const path = join(sourceDir, name);
    const stat = statSync(path);
    if (!stat.isFile()) continue;
    const previous = byId.get(id);
    if (previous && previous.mtimeMs >= stat.mtimeMs) {
      skipped.push({ file: name, reason: `older than ${previous.name}` });
      continue;
    }
    if (previous) skipped.push({ file: previous.name, reason: `older than ${name}` });
    byId.set(id, { name, path, mtimeMs: stat.mtimeMs });
  }
  for (const [id, { name, path }] of [...byId].sort(([a], [b]) => a.localeCompare(b))) {
    try {
      loadFile(id, JSON.parse(readFileSync(path, 'utf8')));
    } catch (error) {
      rejected.push({ file: name, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    copyFileSync(path, join(patchesDir, `${id}.json`));
    copied.push({ id, file: name });
  }
  return { copied, rejected, skipped };
}
