/**
 * The pure half of `testInputs.test.mjs` (windsor#498). A PR runs only the
 * tests its change reaches through imports, plus the inputs `vitest.config.ts`
 * names in `READ_BY_PATH` and `SCANNED_BY`
 * (docs/log/2026-10-02-ci-runs-affected-tests-on-prs.md). A file that reads
 * by path declares what it reads in one comment line near its top:
 *
 *     // reads-by-path: <glob>[, <glob>…]
 *
 * the globs separated by a comma and a space (a brace glob keeps its bare
 * commas), each string for string a `READ_BY_PATH` entry or a `SCANNED_BY`
 * glob.
 * A file whose reads take only the paths its caller passes, or the temporary
 * files it writes itself, says `// reads-by-path: none (<why>)`.
 *
 * `checkTestInputs` takes the files as `{ path, text }` (repo-relative paths)
 * and the two tables, and returns one line per problem.
 */
import { dirname, join, normalize } from 'node:path';

/**
 * The calls that read by path, by the module that provides them. A call
 * counts only in a file that names its module, so the app's own `build`
 * methods are not esbuild's.
 */
export const READ_CALLS = [
  {
    modules: ['node:fs', 'fs', 'node:fs/promises', 'fs/promises'],
    calls: ['readFileSync', 'readFile', 'readdirSync', 'readdir', 'statSync', 'existsSync'],
  },
  {
    modules: ['node:child_process', 'child_process'],
    calls: ['spawnSync', 'execFileSync', 'execSync'],
  },
  { modules: ['esbuild'], calls: ['buildSync', 'build'] },
];

const MARKER = /^\s*\/\/ reads-by-path: (.*)$/gm;
const NONE = /^none \(.+\)$/;
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;
const TEST_FILE = /\.test\.(ts|mjs)$/;
const SOURCE_EXTENSION = /\.(ts|mjs|js)$/;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The read calls `text` makes, as `name` strings; empty when it makes none. */
export function readCallsIn(text, readCalls = READ_CALLS) {
  return readCalls.flatMap(({ modules, calls }) => {
    const named = modules.some((m) => new RegExp(`['"]${escape(m)}['"]`).test(text));
    return named ? calls.filter((call) => new RegExp(`\\b${call}\\s*\\(`).test(text)) : [];
  });
}

/**
 * The file's markers: `null` when it has none, otherwise `{ globs, problems }`.
 * `none (<why>)` declares no glob.
 */
export function parseMarker(text) {
  const lines = [...text.matchAll(MARKER)].map((m) => m[1].trim());
  if (lines.length === 0) return null;
  const problems = lines.length > 1 ? ['has more than one reads-by-path marker'] : [];
  const globs = lines.flatMap((value) => {
    if (value.startsWith('none')) {
      if (!NONE.test(value)) problems.push(`"${value}": write none as "none (<why>)"`);
      return [];
    }
    return value.split(', ').map((glob) => glob.trim());
  });
  return { globs, problems };
}

/** Repo-relative module paths, without extension, that `text` imports from `path`. */
export function importedModules(path, text) {
  return [...text.matchAll(SPECIFIER)].flatMap(([, spec]) => {
    const workspace = /^@windsor\/(engine|app)\/(.+)$/.exec(spec);
    if (workspace) return [`packages/${workspace[1]}/src/${workspace[2]}`];
    if (!spec.startsWith('.')) return [];
    return [normalize(join(dirname(path), spec)).replace(SOURCE_EXTENSION, '')];
  });
}

/** Problems with one file's marker against the tables; checks (a) to (d). */
function fileProblems(file, context) {
  const { readCalls, readByPath, scannedBy, importersOf } = context;
  const calls = readCallsIn(file.text, readCalls);
  const marker = parseMarker(file.text);
  if (marker === null) {
    return calls.length === 0
      ? []
      : [`${file.path}: reads by path (${calls.join(', ')}) but has no reads-by-path marker`];
  }
  const problems = marker.problems.map((p) => `${file.path}: ${p}`);
  const isTest = TEST_FILE.test(file.path);
  for (const glob of marker.globs) {
    const entries = scannedBy.filter(([scanned]) => scanned === glob);
    if (entries.length === 0 && !readByPath.includes(glob)) {
      problems.push(
        `${file.path}: "${glob}" is neither a READ_BY_PATH entry nor a SCANNED_BY glob`,
      );
      continue;
    }
    if (entries.length === 0) continue;
    const listed = new Set(entries.flatMap(([, tests]) => tests));
    const needed = isTest ? [file.path] : importersOf(file.path);
    for (const test of needed.filter((t) => !listed.has(t))) {
      const why = isTest ? 'reads it' : `imports ${file.path}, which reads it`;
      problems.push(`SCANNED_BY "${glob}" does not list ${test}, which ${why}`);
    }
  }
  return problems;
}

/**
 * Every problem with the declared test inputs:
 * (a) a file that makes a read call has a marker;
 * (b) each marker glob is a `READ_BY_PATH` entry or a `SCANNED_BY` glob;
 * (c) a test whose marker names a `SCANNED_BY` glob is listed by that entry;
 * (d) a module whose marker names one has every test that imports it listed;
 * (e) every test a `SCANNED_BY` entry names exists among `files`.
 */
export function checkTestInputs({ files, readByPath, scannedBy, readCalls = READ_CALLS }) {
  const tests = files.filter((f) => TEST_FILE.test(f.path));
  const imports = new Map(tests.map((t) => [t.path, importedModules(t.path, t.text)]));
  const importersOf = (path) => {
    const bare = path.replace(SOURCE_EXTENSION, '');
    return tests.filter((t) => imports.get(t.path).includes(bare)).map((t) => t.path);
  };
  const context = { readCalls, readByPath, scannedBy, importersOf };
  const known = new Set(files.map((f) => f.path));
  const missing = scannedBy.flatMap(([glob, listed]) =>
    listed
      .filter((t) => !known.has(t))
      .map((t) => `SCANNED_BY "${glob}" names ${t}, which does not exist`),
  );
  return [...files.flatMap((file) => fileProblems(file, context)), ...missing];
}
