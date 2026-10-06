import { execFileSync } from 'node:child_process';
import { matchesGlob, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * A pull request runs only the tests its change can reach; a push to main and
 * a local `npm run verify` run them all
 * (docs/log/2026-10-02-ci-runs-affected-tests-on-prs.md). CI sets this to the
 * PR's base sha. With it, vitest runs as `--changed <sha> --passWithNoTests`:
 * a test file runs when its import graph reaches a file the PR changed.
 */
const CHANGED_SINCE = process.env.VERIFY_CHANGED_SINCE || undefined;

/** The repository root, which the trigger globs below are anchored to. */
const ROOT = fileURLToPath(new URL('.', import.meta.url));

/**
 * Files tests read by path (`readFileSync`, `readdirSync`, `existsSync`, an
 * esbuild bundle or a child process), which the import graph can't see. A
 * change to one runs the whole suite. A file that reads by path, a test or a
 * module a test imports, says what it reads in one comment line near its top,
 * `// reads-by-path: <glob>[, <glob>…]`, each glob an entry here or a glob of
 * SCANNED_BY (the one to use when the input is source the test reads as text).
 * `scripts/lib/testInputs.test.mjs` fails on a reader without that marker or
 * a glob neither list has (windsor#498). Repo-relative; anchored to ROOT for
 * vitest, which matches them against absolute paths and whose `**` never
 * crosses a dot folder such as a worktree under `.claude/`.
 */
export const READ_BY_PATH = [
  // The worklet bundles every harness, golden and allocation probe loads.
  'packages/engine/src/worklet/generated/**',
  // The patch library files, which the patch and index tests list and read.
  'packages/engine/src/patches/**',
  // Goldens, reference JSON, saved songs, and the allocation probe and its
  // scenarios, which run in a child process.
  'packages/engine/src/__fixtures__/**',
  // The goldens pin the Node major they were recorded on.
  '.nvmrc',
  'package-lock.json',
  '**/package.json',
  '**/tsconfig*.json',
  // Vitest's default `**/{vitest,vite}.config.*/**` doesn't match the config
  // file itself, so a config change would otherwise run no test.
  '**/{vitest,vite}.config.*',
];

/**
 * Source that a test reads as text to hold a convention across a whole tree.
 * A change there reruns only the tests named, not the whole suite: a full run
 * here would make every app or engine change run everything. Repo-relative.
 */
export const SCANNED_BY: readonly (readonly [string, readonly string[]])[] = [
  // No preset literal outside fallbackPatch.ts; the pure generator modules'
  // imports; each worklet bundle rebuilt from its sources.
  [
    'packages/engine/src/**/*.ts',
    [
      'packages/engine/src/patch/fallbackPatch.test.ts',
      'packages/engine/src/sequencing/generatorBoundary.test.ts',
      'scripts/lib/workletBundle.test.mjs',
    ],
  ],
  // The FM worklet's sources, scanned for the envelope fields they read,
  // and the ladder's two for the Math calls they must not make (windsor#573).
  [
    'packages/engine/src/worklet/fm/**',
    [
      'packages/engine/src/synth/fmProcessorEnvelopeEdges.test.ts',
      'packages/engine/src/synth/fmProcessorFilterLadder.test.ts',
    ],
  ],
  // The Filter insert's sources, scanned for filter arithmetic they must not
  // hold (windsor#622).
  [
    'packages/engine/src/worklet/filter/**',
    ['packages/engine/src/worklet/filter/filterBundle.test.ts'],
  ],
  // Bundled with esbuild from tapeMagneticStage.ts and run in a child process.
  [
    'packages/engine/src/worklet/tape/**',
    ['packages/engine/src/inserts/tapeMagneticIntegrationSwitch.test.ts'],
  ],
  // Bundled with esbuild and run in a child process. The test also imports it,
  // so the import graph already reaches it; named so the marker can say so.
  [
    'packages/engine/src/worklet/tape/tapeOversample.ts',
    ['packages/engine/src/inserts/tapeMagneticGolden.test.ts'],
  ],
  // The console builds no Web Audio node of its own; the transport strip's markup and wiring.
  [
    'packages/app/{index.html,src/*.ts}',
    ['packages/app/src/consoleBoundary.test.ts', 'packages/app/src/transportStrip.test.ts'],
  ],
  // The stylesheet: its brace balance, and the colours, tokens and sizes the
  // table tests pin against their copies in TypeScript.
  [
    'packages/app/src/*.css',
    [
      'packages/app/src/consoleColors.test.ts',
      'packages/app/src/consoleStylesheet.test.ts',
      'packages/app/src/harmonyCardTables.test.ts',
      'packages/app/src/masterColumnTables.test.ts',
      'packages/app/src/songViewTables.test.ts',
    ],
  ],
  // Every reads-by-path marker under vitest's include roots, checked against
  // these two lists.
  ['{packages/*/{src,lib},scripts/lib}/**', ['scripts/lib/testInputs.test.mjs']],
];

/**
 * Starts the message of every git failure the change provider rethrows, so
 * `scripts/check-vitest-provider.mjs` can tell this provider's failure from
 * any other vitest error.
 */
const PROVIDER_ERROR_PREFIX = 'windsor-change-provider:';

const git = (cwd: string, args: string[]): string[] => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${PROVIDER_ERROR_PREFIX} ${message}`, { cause: error });
  }
};

/**
 * Git's changed files, as vitest's own provider finds them, plus the tests
 * that scan any of them. Vitest's provider also returns nothing when git
 * fails (an unknown base, or a shallow clone with no merge base), which with
 * `--passWithNoTests` would pass a PR that ran no test. This one throws git's
 * error behind `PROVIDER_ERROR_PREFIX`.
 */
const changedFiles = {
  async findChangedFiles(options: { root: string; changedSince?: string | boolean }) {
    const top = git(options.root, ['rev-parse', '--show-toplevel'])[0]!;
    const since = options.changedSince;
    const changed = [
      ...(typeof since === 'string' ? git(top, ['diff', '--name-only', `${since}...HEAD`]) : []),
      ...git(top, ['diff', '--cached', '--name-only']),
      ...git(top, ['ls-files', '--other', '--modified', '--exclude-standard']),
    ];
    const scanners = SCANNED_BY.filter(([glob]) => changed.some((f) => matchesGlob(f, glob)));
    const files = [...changed, ...scanners.flatMap(([, tests]) => tests)];
    return [...new Set(files)].map((file) => resolve(top, file));
  },
};

export default defineConfig({
  test: {
    // Every package's tests run from the root in one process, in Node: the
    // engine's tests use the headless worklet harness and fake audio graph,
    // and the app's test its pure models, tables and write functions.
    include: [
      'packages/*/src/**/*.test.ts',
      // The library scripts' pure halves (import, sweep, bundle options).
      'packages/*/lib/**/*.test.mjs',
      // The worklet bundler's and the patch index's pure halves.
      'scripts/lib/**/*.test.mjs',
    ],
    environment: 'node',
    changed: CHANGED_SINCE,
    passWithNoTests: CHANGED_SINCE !== undefined,
    forceRerunTriggers: [
      ...configDefaults.forceRerunTriggers,
      ...READ_BY_PATH.map((glob) => `${ROOT}${glob}`),
    ],
    experimental: { vcsProvider: changedFiles },
  },
});
