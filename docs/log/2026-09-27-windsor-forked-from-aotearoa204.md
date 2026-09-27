# Windsor is a hard fork of Aotearoa204's music engine

- **Date:** 2026-09-27
- **Decided by:** tacowars
- **Source:** `tacowars/Aotearoa204` `main` at `153294a6`

## Context

Aotearoa204's music engine had outgrown its role as a game soundtrack. It
had four-operator FM synthesis, five sequencer kinds over a harmony
timeline, a mixer with eight insert kinds and a standalone arrangement
console. tacowars wants to keep developing it as a web-based sequencer/DAW,
without the game's constraints, under the name Windsor.

## Decisions

1. **Hard fork.** Windsor and Aotearoa204 evolve separately, and an engine
   fix is ported by hand in either direction.
   - This lets Windsor redesign the schema, the UI and the architecture
     freely.
   - The game keeps its own copy, and its console is left untouched for now.
   - Converging on one shared package was considered and deferred. It would
     tie every DAW change to game safety.
2. **Filtered history.** `git filter-repo` kept only the paths that came
   across and remapped them:
   - `packages/client/src/audio/` became `packages/engine/src/`.
   - `tools/patch-editor/` became `packages/app/`.
   - Also kept: the worklet and patch-index scripts, the three audio design
     docs, and the audio research and decision records.

   The game's soundtrack (`bed-01`) and the generated console page were
   dropped from all history. `#<n>` references stay as Aotearoa204 issue
   numbers.
3. **Scope.**
   - Came across: the engine, the console, the 159-patch library, the audio
     docs and decision records, and the Claude tooling (this repo's
     `CLAUDE.md` and the `music-engine` skill, rewritten).
   - Stayed behind: the Babylon bridge, the game's music selection and query
     options, the settings-slider mix levels and the spatial SFX.
   - `AudioSystem` and the offline renderer are engine pieces the console
     runs on, so they came across as `system/` and `render/`.
4. **Layout and build.** An npm-workspaces monorepo:
   - `@windsor/engine` is the engine; `@windsor/app` is the UI.
   - Vite builds the app, giving HMR in development and a static `dist/`
     for any static host.
   - The single-file page generator was retired. The worklets load as real
     files from the engine's own URLs.
   - The generator's assertions became a test (`consoleBoundary.test.ts`)
     and an ESLint import boundary.
5. **Process.** The code rules came across unchanged, so the code passes on
   day one:
   - the size limits, `no-magic-numbers` and tables, tests beside the code,
     and Prettier;
   - the `verify` gate and CI;
   - one-file decision records in `docs/log/`.

   Aotearoa204's board, orchestrator and handoff machinery did not come
   across and can be added if parallel agent work needs it.
6. **Licence: AGPL-3.0.** Windsor is meant to be hosted as a web app, and
   the AGPL keeps a modified hosted copy open where the GPL would not. tacowars
   wrote the imported code, so the game's rights to its own copy are
   unaffected.

## Known follow-ups

- `patch/gameplayPatches.ts` and `AudioSystem`'s SFX bus are game-flavoured.
  The fallback click and the SFX route still use them; they should become a
  neutral fallback patch and a generic auxiliary bus, or be removed.
- User state (patches, songs) still lives in the page's baked library, the
  optional folder grant and import/export. A static-hosted DAW needs a
  browser store (IndexedDB/OPFS) for both.
- The app bundle is about 626 kB, most of it the baked patch library. Code
  splitting or lazy-loading the library is a later optimisation.
