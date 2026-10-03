# Tape research tests run on request

- **Date:** 2026-10-03
- **Status:** accepted: tacowars's direction in windsor#502
- **Links:** windsor#502 · `vitest.research.config.ts` · `scripts/research/` ·
  builds on `2026-10-02-ci-runs-affected-tests-on-prs`

## Context

Thirteen tests, `tape*.test.mjs`, re-check the saved measurements of the
finished Tape research (`docs/research/2026-09-30-tape-*` and
`docs/research/2026-10-01-tape-shipped-probe`). They sat in `scripts/lib/`,
inside the default vitest include, so they ran in every full suite on `main`
and in any PR whose change reached them, including any change to the Tape
research folders (a `READ_BY_PATH` entry that reran the whole suite) or to
`mulberry32.ts` (a `SCANNED_BY` entry).

The Tape work is done. The shipped Tape is pinned by the engine's own tests:
`tapeMagneticGolden`, `tapeMagneticIntegrationSwitch` and the insert tests.
tacowars wants the research tests kept, not deleted, but run only when
someone asks for them.

## Decision

1. **They moved, unedited.** The 13 files moved from `scripts/lib/` to
   `scripts/research/` under the same names. Their relative imports keep the
   same depth. Only their `// reads-by-path:` marker lines were removed:
   the meta-test (`scripts/lib/testInputs.test.mjs`) scans only the default
   include roots.
2. **They run on request.** `npm run test:research` runs them through
   `vitest.research.config.ts`, which includes only
   `scripts/research/**/*.test.mjs`. No other script, `verify` or CI runs
   that command, and the default `vitest.config.ts` no longer reaches them.
3. **CI selection lost two entries.** `READ_BY_PATH` no longer names
   `docs/research/*-tape-*/**`, and `SCANNED_BY` no longer maps
   `packages/engine/src/sequencing/mulberry32.ts` to
   `tapeDynamicSurvival.test.mjs`. No remaining marker names either.
4. **`tapeShippedProbe` moved too.** It holds the shipped
   `packages/engine/src/inserts/tapeConstants.ts` to the probe's saved
   evidence. A change to `tapeConstants.ts` is now checked against that
   evidence only when someone runs `npm run test:research`. The engine's
   goldens still pin the shipped DSP bit for bit on every PR that reaches
   them.
5. **The change provider's failures carry a prefix.** In the same config,
   the provider in `vitest.config.ts` rethrows a git failure as an `Error`
   whose message starts with `windsor-change-provider:` and keeps git's own
   message. `scripts/check-vitest-provider.mjs` passes only when vitest's
   output has that prefix and the probe ref, so a future vitest that fails
   on a bad ref by itself can't pass for the config's provider.

## Consequences

- A full suite and a PR's affected-test run no longer spend time on the
  Tape research.
- Anyone changing `tapeConstants.ts`, the research folders or
  `mulberry32.ts` and wanting the research evidence re-checked runs
  `npm run test:research` by hand.
- The research READMEs and some research sources still cite
  `scripts/lib/tape*.test.mjs`. They are history and were left as written;
  the files are in `scripts/research/` under the same names.
