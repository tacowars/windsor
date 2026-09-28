# Windsor for Codex

Read `CLAUDE.md` first: the layout, the invariants and the code rules apply
to every agent. This file adds what Codex needs on top of it.

## Code Review Rules

You review one pull request written by an agent from a different model
family. Your value is that you do not think like the author: look for what
it would not have thought to check. Review the diff and the tracked sources
it touches against the invariants in `CLAUDE.md`.

### Scope

- Do not read `node_modules/`, `packages/app/dist/`, `coverage/`, `*.log`,
  or `packages/engine/src/worklet/generated/`. The generated bundles are
  built from the source folders beside them; review the source, and report
  a bundle that differs from its source as a finding.
- Expected evidence scales with the diff. A diff confined to `docs/`,
  `.github/`, `scripts/`, `.claude/` or to test files has no audio or
  rendered frame behind it: do not ask for listening notes, screenshots or
  benchmarks on such a PR. Judge the prose, the workflow, the script, the
  assertions.

### Method

- Attempt to refute each candidate finding before reporting it. Report only
  what survives, and say what you checked it against: the test that would
  fail, the source of the dependency, the fixture that contradicts it.
- For every finding give `file:line` and a concrete failure scenario: the
  inputs or state that make it bite, and the observable wrong outcome.
- Verification claims are in scope. A test that passes against a broken
  implementation, a golden updated without a decision record, or a PR
  description contradicted by the code is a finding.
- Prefer reporting nothing over reporting the speculative. At most 12
  findings. If nothing is P0 or P1, say exactly: "No P0 or P1 findings."

### Severity

- P0: data loss in a song or patch document, audio output that differs from
  the goldens without a decision record, a secret in the tree, a licence
  breach.
- P1: wrong behaviour a user can hit, an invariant in `CLAUDE.md` broken, a
  hot path that allocates per block, a patch file without its headroom
  record or index entry, a round trip that drops a field.
- P2: worth fixing, not blocking.
- Anything `npm run verify` catches on its own (types, lint, format, a
  failing test, a stale bundle or index) is P3 and not worth a comment.

### What to attack in this repository

- The worklets: a per-block allocation, a `Math.random` or `Date.now` in a
  DSP path, a change that would move the golden tests, a hand edit to a
  generated bundle.
- Patches: a new or edited `packages/engine/src/patches/<id>.json` without a
  regenerated headroom record and index; sound data moved back into
  TypeScript.
- Song documents: a save or load that does not carry `patches`, `returns`,
  strips, harmony, sequencers and captured patterns through a round trip; a
  library edit that reaches into a saved song; a change to the song or patch
  shape that makes an old file load wrong or fail without bumping
  `ARRANGEMENT_VERSION` or `PATCH_FILE_FORMAT`
  (`docs/log/2026-09-28-format-versions-refuse-never-destroy.md`).
- The engine/app boundary: the engine importing the app; the app importing
  anything but `@windsor/engine`; a Web Audio node built in the app.
- Tables: a tunable inlined where `no-magic-numbers` would not see it (a
  fixture, a test) but the design says it belongs in a `*Constants.ts` or
  `*Tables.ts` file.
- Tests: do they try the boundary the acceptance criteria name (empty note
  pool, register extremes, first and last step), or only the happy path?
  Name the missing test that would have caught each finding.
