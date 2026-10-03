/**
 * The pure half of `import-patches.mjs` (#563): which downloaded files are
 * patch files, which of them the loader accepts, and the copy into
 * `patches/`. The loader is injected — the CLI bundles the audio package's
 * `loadPatchFile` with esbuild, the test imports it straight from the
 * TypeScript source — so this file needs no bundler of its own.
 */
// reads-by-path: none (reads the folder its caller passes)
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
 * Whether a parsed file claims to be a patch at all (#617). `~/Downloads` is
 * full of `.json` that has nothing to do with the console, and every one of
 * them used to land in `rejected` and take the exit code to 1 after a clean
 * import. A file the editor wrote carries `format` and `patch`; a file that
 * carries neither is somebody else's and is skipped, not failed.
 */
export function looksLikePatchFile(parsed) {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  return 'format' in parsed || 'patch' in parsed;
}

/** The CLI's exit code: a patch the loader refused is a failure, nothing else is. */
export const importExitCode = ({ rejected }) => (rejected.length > 0 ? 1 : 0);

const reasonOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * Validate every `<id>.json` in `sourceDir` with `loadFile(id, raw)` and copy
 * the accepted ones, bytes untouched, to `patchesDir/<id>.json`. When several
 * files map to one id (`kick.json`, `kick (1).json`), the newest is taken and
 * the others reported as skipped. A file that is not JSON, or is JSON that
 * claims to be no patch, is skipped rather than rejected — only a refused
 * patch is a failure.
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
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      skipped.push({ file: name, reason: `not a patch file: ${reasonOf(error)}` });
      continue;
    }
    try {
      loadFile(id, parsed);
    } catch (error) {
      const entry = { file: name, reason: reasonOf(error) };
      if (looksLikePatchFile(parsed)) rejected.push(entry);
      else skipped.push({ file: name, reason: `not a patch file: ${entry.reason}` });
      continue;
    }
    copyFileSync(path, join(patchesDir, `${id}.json`));
    copied.push({ id, file: name });
  }
  return { copied, rejected, skipped };
}
