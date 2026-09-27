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
| The engine: FM synthesis, worklets, patches, songs, sequencers, harmony, mixer, inserts | `packages/engine/src/` (`@windsor/engine`). Read `.claude/skills/windsor-engine/SKILL.md` first, and `packages/engine/src/worklet/CLAUDE.md` before touching DSP | `npm run verify` |
| The UI: tabs, cards, knobs, the library browser, audition input | `packages/app/` (`@windsor/app`). Read `packages/app/CLAUDE.md` first | `npm run verify`, plus `npm run dev` in the browser |
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
  `npm run verify`.
