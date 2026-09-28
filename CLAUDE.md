# Windsor

A browser-based sequencer and DAW built on a custom four-operator FM engine.
It was forked on 2026-09-27 from the music engine and arrangement console of
the Aotearoa204 game (`tacowars/Aotearoa204`). The fork is a **hard fork**:
the two repos evolve separately and fixes are ported by hand. The reasons and
the decisions behind it are recorded in
`docs/log/2026-09-27-windsor-forked-from-aotearoa204.md`.

**`#<n>` references** in code, comments and `docs/` (for example `#562`, or
"epic #703") are **Aotearoa204 issue numbers**, kept as provenance. Windsor's
own issues are referenced as `windsor#<n>`.

Stack: TypeScript end to end, npm workspaces, Vite, Vitest, Web Audio and
AudioWorklets. The app is a static site. There is no server: `vite build`
writes `packages/app/dist/` for GitHub Pages, Cloudflare Pages or
S3 + CloudFront. User state belongs in the browser: IndexedDB for the user's
patches and the autosaved song (`docs/log/2026-09-27-user-library-in-indexeddb.md`),
the File System Access folder grant, and import/export.

## Layout

| Working on… | Go to | Verify with |
|---|---|---|
| The engine: FM synthesis, worklets, patches, songs, sequencers, harmony, mixer, inserts | `packages/engine/src/` (`@windsor/engine`). Read `.claude/skills/windsor-engine/SKILL.md` first, and `packages/engine/src/worklet/CLAUDE.md` before touching DSP | The tests beside what you touched (`npx vitest run <paths>`, the goldens for DSP), then `npm run typecheck && npm run lint`. CI runs `verify` |
| The UI: tabs, cards, knobs, the library browser, audition input | `packages/app/` (`@windsor/app`). Read `packages/app/CLAUDE.md` first | The tests beside what you touched, `npm run typecheck && npm run lint`, and `npm run dev` in the browser. CI runs `verify` |
| Generated files: the worklet bundles and the patch index | `scripts/build-worklets.mjs`, `scripts/patch-library-index.mjs` | `npm run worklets`, `npm run patch-index` |
| Design, decisions, research | `docs/design/`, `docs/log/`, `docs/research/` | — |

**The engine/app boundary.** The engine never imports the app. The app
reaches the engine through `@windsor/engine`, its `index.ts`, and nothing
else; its tests may also import `@windsor/engine/<path>` for fixtures and for
`patch/presets` (the built-in library, which the index loads on demand). ESLint
enforces both directions. When the app needs something new, extend the
engine's index. Don't build a second synth, graph or sequencer in the app:
`packages/app/src/consoleBoundary.test.ts` fails on a Web Audio node built
there.

## Invariants (do not break)

1. **The worklet bundles are generated.** `packages/engine/src/worklet/generated/*.js`
   are built from the source folders beside them. Edit the source, then
   `node scripts/build-worklets.mjs`, and commit both. `--check` fails on a
   stale or hand-edited bundle.
2. **The patch library is files.** Every patch is one
   `packages/engine/src/patches/<id>.json` carrying its own headroom record.
   A new or edited file needs `node packages/app/sweep-headroom.mjs <id>` and
   `node scripts/patch-library-index.mjs --write`, and `verify` checks both.
   Sound data never goes back into TypeScript.
3. **A song document is self-contained.** It carries a snapshot of every
   patch it plays, and a library edit never changes a saved song until that
   song is re-exported. Preserve `patches`, `returns`, strips, harmony,
   sequencers and captured patterns through every round trip.
4. **Hot paths stay allocation-free.** The worklets allocate nothing per
   block. The golden tests (`fmProcessorGolden`, `reverbGolden`) pin the DSP
   bit for bit.
5. **Performance claims are measured, never estimated.** A number names the
   machine, browser and backend it was read on, and lives in
   `docs/research/`.
6. **Secrets.** Never widen `.gitignore` without approval, and never print a
   secret. `.env` and `*.kubeconfig` are never tracked, and CI enforces it.
7. **Licence.** Windsor is AGPL-3.0. A third-party asset, preset source or
   dependency must be AGPL-compatible, and its provenance goes in the file
   or doc that uses it.

## Code structure

Enforced by ESLint (`eslint.config.js`):

- **Size limits:** `max-lines` 350, `max-lines-per-function` 60, `max-depth` 4
  and `max-params` 5, with blank lines and comments excluded.
  - The default response to a hit is to split along a real seam.
  - Don't invent an abstraction to satisfy the number. A function that reads
    as one sequential story may exceed the limit with a targeted
    `// eslint-disable-next-line <rule> -- <why this is one unit>`.
  - A reason-less or blanket disable is not acceptable.
  - A file past about 1.5× the limit gets split, not an exception.
- **One concern per file.** Name files after what they own, never `utils.ts`
  or `helpers.ts`.
- **Data lives separately from logic.** Tunables go in `<area>Constants.ts` /
  `<area>Tables.ts` beside the logic, and the logic takes its table as a
  parameter defaulting to the shipped one. `no-magic-numbers` enforces this
  outside tests, fixtures and table files.
- **An options object for numeric parameters.** A new function taking four
  or more parameters, three or more of them numbers, takes an options object
  instead.
- **Composition files stay composition only.** `packages/app/src/main.ts`
  constructs and wires; the behaviour lives elsewhere.
- **Tests sit beside the code** as `<name>.test.ts`. Engine fixtures live in
  `packages/engine/src/__fixtures__/`. Tests run in Node with no DOM, so the
  testable unit is the pure model, the table or the write function, never
  the click handler.

## Commands

```bash
npm ci                     # once per checkout (Node >= 24, see .nvmrc)
npm run dev                # Vite dev server with HMR on :5173
npm run build              # static site into packages/app/dist/
npm run preview            # serve the built dist/ (e.g. -- --port 4199)
npm run verify             # the PR gate: typecheck, lint, format, test, worklets, patch index, build
npm run verify:quick       # typecheck, lint, format, test
npm run format             # prettier --write (code only; prose is hand-formatted)
bash scripts/overlap.sh <paths>   # what in-flight work touches these paths (main session, before a launch)
```

## Conventions

- **Decisions:** one file per decision in `docs/log/YYYY-MM-DD-<slug>.md`,
  cited by slug. A decision made during a change lands in the same PR, and
  the PR body names it. The records imported from Aotearoa204 are history:
  they describe the engine as it was built for the game and are never
  edited.
- **Research and measurements:** `docs/research/<date>-<slug>/`.
- **Commit style:** a sentence-case imperative subject, with a body that
  explains why.
- **Branching:** work on a branch and open a PR against `main`. CI runs
  `npm run verify`, and a ruleset on `main` requires that check and a PR.

## Working a ticket

The issue is the whole brief (`.github/ISSUE_TEMPLATE/task.md`) and the PR
is the only report (`.github/pull_request_template.md`). The rationale is
in `docs/log/2026-09-28-parallel-workflow-without-an-orchestrator.md`.

**A worker**, whether a sub-agent in a worktree or a session of its own:

1. Reads the issue, then only the docs and skill references it names.
2. Branches as `<feature|fix|docs|tech-debt>/<N>-<slug>` from `origin/main`
   and edits only the folders the issue owns.
3. Runs the checks the issue's "Verify locally" names, never the full
   `verify` and never the whole suite. CI runs the gate; a hook enforces it.
4. Commits, pushes, opens the PR from the template with `Fixes #N` and its
   class, and ends its turn. Its final message is the PR URL and one line.
5. Never merges, never watches CI, never writes the board. A question only
   Pat can answer gets the `needs-human` label and a comment, then the turn
   ends.

A code PR from this repo gets a live preview at
`https://tacowars.github.io/windsor/pr-preview/pr-<N>/`, linked in a PR
comment. A UI PR's reviewer opens it from there
(`docs/log/2026-09-28-pr-previews-on-github-pages.md`).

**PR classes.** `reviewed` waits for Pat: sound design (`patches/`, the
worklets, a golden change), the song document schema, persistence, a
deviation from the issue's decisions, or a UI/UX change to layout,
interaction or look (a new or moved control, a new gesture, a restyle).
`routine` merges on a green check plus no P0 or P1 from Codex: everything
else, including user-visible text the issue spells out word for word (a
rename, a label, a hint), a bug fix that restores intended behaviour
without changing how a control works, tests, docs and refactors. The main
session sets the class in the issue when it writes it. The worker keeps it
unless the diff crosses into a `reviewed` area, and then says so in the
PR. The main session checks the class against the diff.

**The main session** dispatches and merges. Before launching a worker it
runs `bash scripts/overlap.sh <owned paths>` against open PRs and local
worktrees; an overlap means sequence, and a hotspot (the engine index,
`partGenerators.ts`, the insert registry, the patch index, `main.ts`,
`package.json`) means a `seam` ticket lands first. At most two Claude
workers at once, one heavy test run at a time, and no new launch while two
PRs wait for Pat. It merges with `gh pr merge <N> --squash --auto` and lets
GitHub wait for the check. A Codex finding at P0 or P1 goes to a fresh
round on the same branch, at most twice, then to Pat.

**Backlog.** Issues. No label is backlog, `ready` is the queue, an open PR
is in progress, closed is done. Project #6 is a view that GitHub's own
workflows move; nothing else writes to it.
