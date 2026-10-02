# CI runs affected tests on PRs

- **Date:** 2026-10-02
- **Status:** accepted: decisions 1 to 4 are tacowars's design in
  windsor#448; 5 and 6 were added in its PR, where the design met tests that
  scan whole source trees
- **Links:** windsor#448 · `.github/workflows/ci.yml` (the `verify` job) ·
  `vitest.config.ts` · keeps `2026-09-28-parallel-workflow-without-an-orchestrator`
  (CI runs the gate, the worker runs only the tests beside its change)

## Context

On a code PR, CI's `verify` took about 6.5 minutes. About 286 s of that was
vitest running all 462 test files (run 37060970722, a GitHub-hosted Ubuntu
runner). Most of the test time is in files a typical PR never touches:

| Test file | Time |
|---|---|
| `fmProcessorAllocation.test.ts` | 198 s |
| The Tape suite, about ten files | about 250 s |
| `loadSamplerAllocation.test.ts` | 47 s |

(Vitest runs files in parallel, so these add up to more than the wall time.)
No further Tape work is planned, and the FM allocation probe guards a worklet
that few PRs change.

## Decision

1. **A PR runs the tests its change can reach.** On a `pull_request`, the
   `verify` step sets `VERIFY_CHANGED_SINCE` to the PR's base sha, and
   `vitest.config.ts` turns that into `changed: <sha>` and
   `passWithNoTests: true`. Vitest then runs a test file when its import
   graph reaches a file changed since the merge base of the base sha and
   HEAD. A change that reaches no test passes rather than failing on "No
   test files found". The step that fetches the base for the docs-only
   check now fetches the history too (`--unshallow`), since the merge base
   needs it.
2. **Everything else in `verify` is unchanged.** Typecheck, lint, the format
   check, the worklet and patch-index checks and the build run as before,
   and `npm run verify` is still the one stage list: CI calls it, with only
   the environment variable added. A docs-only PR still skips the gate.
3. **A push to `main` runs every test**, as does a local `npm run verify`:
   the variable is unset there. `main` is the safety net for whatever the
   PR's selection misses.
4. **Files read by path force a full run.** About twenty tests read inputs
   with `readFileSync`, `readdirSync` or `existsSync`, bundle a source with
   esbuild, or run a probe in a child process. The import graph sees none
   of these. `READ_BY_PATH` in `vitest.config.ts` lists each input path or
   folder, and a change to any of them runs the whole suite (vitest's
   `forceRerunTriggers`, keeping its defaults): the generated worklet
   bundles, the patch files, `__fixtures__/`, the app's CSS, the Tape
   research folders the `scripts/lib` tests read, `.nvmrc`,
   `package-lock.json`, every `package.json` and `tsconfig*.json`, and the
   vitest and Vite configs. A new test that reads a file by path adds the
   path there.
5. **Source a test scans as text reruns that test only.** A few tests hold a
   convention across a whole tree by reading its source as text: no preset
   literal in engine code, the generator modules' imports, the console
   building no Web Audio node, each worklet bundle rebuilt from its sources.
   A full-run trigger on `packages/engine/src/**` or `packages/app/src/*.ts`
   would make every engine or app change run everything, so `SCANNED_BY`
   maps each scanned glob to the tests that scan it instead. A small change
   provider in the config (vitest's `experimental.vcsProvider`) lists git's
   changed files the way vitest's own does and adds those tests.
6. **A git failure fails the run.** Vitest's own provider returns no files
   when `git diff` fails (an unknown base, or a shallow clone with no merge
   base), which with `passWithNoTests` would pass a PR that ran no test.
   The config's provider throws instead.

## Consequences

- A typical app PR runs the app's tests, and an engine PR the tests its
  imports reach, not the FM allocation probe or the Tape suite unless it
  touches them. Any change to a generated bundle, a patch or a fixture still
  runs everything.
- The blind spot is a test input the lists don't name: a new test that
  reads a file by path without adding it to `READ_BY_PATH` or `SCANNED_BY`.
  The risk accepted: a break that both the PR's selection and review miss
  turns `main` red after the merge, not the PR. The full run on `main` is
  where it shows.
- `vitest.config.ts`'s default trigger for its own file
  (`**/{vitest,vite}.config.*/**`) does not match the file itself with
  picomatch 4, and `**` in vitest's triggers never crosses a dot folder such
  as a worktree under `.claude/`. The list is anchored to the repository
  root and names the configs itself, so it works in both.
- `experimental.vcsProvider` is an experimental vitest API. If an upgrade
  drops or renames it, vitest falls back to its own provider without a
  word: the scanning tests stop being added on PRs, and a git failure passes
  again. A vitest upgrade checks it.
- `scripts/check-vitest-provider.mjs`, run in CI's `verify` job on every
  code change, guards that experimental API: it fails the run when vitest
  stops using the config's provider (windsor#456).
